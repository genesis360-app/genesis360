# Reusable Patterns

Copy-paste-ready SQL + TypeScript patterns for each module. All patterns are idempotent (safe to re-run).

---

## SQL Patterns

### Pattern 1: New RRHH Table (Standard Template)

Use for: `rrhh_salarios`, `rrhh_vacaciones`, `rrhh_asistencia`, etc.

```sql
-- Migration: NNN_rrhh_[feature].sql
CREATE TABLE IF NOT EXISTS rrhh_[feature] (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  -- Feature-specific columns
  [column_name] [data_type] [constraints],
  -- Standard audit columns
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Foreign keys for related modules
  creado_por UUID REFERENCES users(id),
  UNIQUE(tenant_id, empleado_id, [feature-specific unique columns])
);

ALTER TABLE rrhh_[feature] ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_[feature]' AND policyname='rrhh_[feature]_tenant') THEN
    CREATE POLICY "rrhh_[feature]_tenant" ON rrhh_[feature]
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrhh_[feature]_tenant ON rrhh_[feature](tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_[feature]_empleado ON rrhh_[feature](empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_[feature]_activo ON rrhh_[feature](activo) WHERE activo = TRUE;

-- Trigger: set updated_at
DROP TRIGGER IF EXISTS tr_rrhh_[feature]_updated_at ON rrhh_[feature];
CREATE TRIGGER tr_rrhh_[feature]_updated_at
BEFORE UPDATE ON rrhh_[feature]
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Trigger: audit log on insert
DROP TRIGGER IF EXISTS tr_rrhh_[feature]_log_insert ON rrhh_[feature];
CREATE TRIGGER tr_rrhh_[feature]_log_insert
AFTER INSERT ON rrhh_[feature]
FOR EACH ROW
EXECUTE FUNCTION public.log_actividad_insert('rrhh_[feature]', 'id');

-- Trigger: audit log on update
DROP TRIGGER IF EXISTS tr_rrhh_[feature]_log_update ON rrhh_[feature];
CREATE TRIGGER tr_rrhh_[feature]_log_update
AFTER UPDATE ON rrhh_[feature]
FOR EACH ROW
EXECUTE FUNCTION public.log_actividad_update('rrhh_[feature]', 'id');
```

---

### Pattern 2: Auto-insert into Caja on Status Change

Use for: "venta despachada debe crear ingreso en caja"

```sql
CREATE OR REPLACE FUNCTION public.vente_dispatch_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_efectivo DECIMAL(12,2);
  v_caja_sesion_id UUID;
  v_caja_movimiento_id UUID;
BEGIN
  -- Only trigger on estado change to 'despachada'
  IF NEW.estado = 'despachada' AND (OLD.estado IS NULL OR OLD.estado != 'despachada') THEN
    -- Calculate efectivo from medio_pago JSON
    v_efectivo := COALESCE(
      (NEW.medio_pago::jsonb -> 'efectivo')::DECIMAL(12,2),
      0
    );
    
    -- Only create caja movement if efectivo > 0
    IF v_efectivo > 0 THEN
      -- Find active caja session (required)
      SELECT id INTO v_caja_sesion_id
      FROM caja_sesiones
      WHERE tenant_id = NEW.tenant_id
        AND cerrado_at IS NULL
      LIMIT 1;
      
      -- Block if no active session
      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'No hay sesión de caja abierta. Abre una sesión antes de despachar.';
      END IF;
      
      -- Create ingreso movement
      INSERT INTO caja_movimientos(
        tenant_id, caja_sesion_id, tipo, monto, concepto, venta_id
      ) VALUES (
        NEW.tenant_id, v_caja_sesion_id, 'ingreso', v_efectivo,
        'Venta #' || NEW.numero, NEW.id
      ) RETURNING id INTO v_caja_movimiento_id;
      
      -- Log the movement
      PERFORM logActividad(
        'caja_movimientos',
        'INSERT',
        v_caja_movimiento_id,
        json_build_object('monto', v_efectivo, 'tipo', 'ingreso'),
        'caja_movimiento_id'
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS tr_venta_dispatch_to_caja ON ventas;
CREATE TRIGGER tr_venta_dispatch_to_caja
AFTER UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.venta_dispatch_to_caja();
```

---

### Pattern 3: Auto-insert into Inventario on Ingreso Movimiento

Use for: "movimiento de ingreso debe aumentar stock_actual"

```sql
CREATE OR REPLACE FUNCTION public.movimiento_stock_update_linea()
RETURNS TRIGGER AS $$
DECLARE
  v_cantidad_cambio INTEGER;
BEGIN
  -- Determine direction (ingreso = +, rebaje = -)
  v_cantidad_cambio := CASE
    WHEN NEW.tipo = 'ingreso' THEN NEW.cantidad
    WHEN NEW.tipo = 'rebaje' THEN -NEW.cantidad
    ELSE 0
  END;
  
  -- Update inventory line's stock_actual
  UPDATE inventario_lineas
  SET stock_actual = stock_actual + v_cantidad_cambio,
      updated_at = NOW()
  WHERE id = NEW.linea_id
    AND tenant_id = NEW.tenant_id;
  
  -- Log activity
  PERFORM logActividad(
    'inventario_lineas',
    'UPDATE',
    NEW.linea_id,
    json_build_object('stock_actual', v_cantidad_cambio, 'movimiento_tipo', NEW.tipo),
    'linea_id'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_movimiento_stock_update_linea ON movimientos_stock;
CREATE TRIGGER tr_movimiento_stock_update_linea
AFTER INSERT ON movimientos_stock
FOR EACH ROW
EXECUTE FUNCTION public.movimiento_stock_update_linea();
```

---

### Pattern 4: Reverse Transaction (Void/Anular)

Use for: "anular venta debe revert stock + caja"

```sql
CREATE OR REPLACE FUNCTION public.venta_anular_reverse()
RETURNS TRIGGER AS $$
DECLARE
  v_venta_item RECORD;
  v_efectivo DECIMAL(12,2);
  v_caja_reversal_id UUID;
BEGIN
  -- Only on estado change to 'anulada'
  IF NEW.estado = 'anulada' AND OLD.estado != 'anulada' THEN
    -- Restore stock for each venta_item
    FOR v_venta_item IN
      SELECT * FROM venta_items WHERE venta_id = NEW.id
    LOOP
      -- Insert rebaje movimiento to reverse stock decrease
      INSERT INTO movimientos_stock(
        tenant_id, linea_id, tipo, cantidad, motivo, concepto, venta_id
      ) VALUES (
        NEW.tenant_id, v_venta_item.linea_id, 'rebaje', -v_venta_item.cantidad,
        'ANULACION', 'Anulación venta #' || NEW.numero, NEW.id
      );
    END LOOP;
    
    -- Reverse caja movement if fue despachada con efectivo
    IF OLD.estado = 'despachada' THEN
      v_efectivo := COALESCE(
        (NEW.medio_pago::jsonb -> 'efectivo')::DECIMAL(12,2),
        0
      );
      
      IF v_efectivo > 0 THEN
        -- Find corresponding ingreso and mark as anulada
        UPDATE caja_movimientos
        SET anulado = TRUE, updated_at = NOW()
        WHERE venta_id = NEW.id AND tipo = 'ingreso';
        
        -- Create reversal egreso (negative movement)
        INSERT INTO caja_movimientos(
          tenant_id, caja_sesion_id, tipo, monto, concepto, venta_id
        ) SELECT
          NEW.tenant_id, caja_sesion_id, 'egreso', v_efectivo,
          'Reversión venta #' || NEW.numero, NEW.id
        FROM caja_movimientos
        WHERE venta_id = NEW.id AND tipo = 'ingreso' LIMIT 1;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_venta_anular_reverse ON ventas;
CREATE TRIGGER tr_venta_anular_reverse
AFTER UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.venta_anular_reverse();
```

---

### Pattern 5: Soft-Delete with Audit

Use for: Marking records as inactive preserves history

```sql
-- In any table, add:
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado BOOLEAN DEFAULT FALSE;
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES users(id);
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_razon TEXT;

-- Function to soft-delete safely
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_tablename TEXT,
  p_record_id UUID,
  p_tenant_id UUID,
  p_razon TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I SET anulado = TRUE, anulado_at = NOW(), anulado_por = auth.uid(), anulado_razon = %L WHERE id = %L AND tenant_id = %L',
    p_tablename,
    p_razon,
    p_record_id,
    p_tenant_id
  );
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Always query with:
SELECT * FROM [tablename] WHERE tenant_id = ... AND (anulado = FALSE OR anulado IS FALSE)
```

---

## TypeScript Patterns

### Pattern 1: useQuery for Multi-Tenant Data

```typescript
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useRrhhSalarios() {
  const { tenant } = useAuthStore()
  
  return useQuery({
    queryKey: ['rrhh-salarios', tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error('No tenant')
      
      const { data, error } = await supabase
        .from('rrhh_salarios')
        .select('*, empleados(nombre, apellido)')
        .eq('tenant_id', tenant.id)
        .eq('activo', true)
        .order('periodo_desde', { ascending: false })
      
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })
}
```

### Pattern 2: Mutation with RLS + Audit

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logActividad } from '@/lib/actividadLog'
import { useAuthStore } from '@/store/authStore'

export function useCreateGasto() {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  
  return useMutation({
    mutationFn: async (gasto: CreateGastoInput) => {
      if (!tenant) throw new Error('No tenant')
      
      const { data, error } = await supabase
        .from('gastos')
        .insert([{
          tenant_id: tenant.id,
          ...gasto,
        }])
        .select()
        .single()
      
      if (error) throw error
      
      // Fire-and-forget audit (no await)
      logActividad('gastos', 'INSERT', data.id, gasto, 'gasto_id')
      
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gastos', tenant?.id] })
    },
  })
}
```

### Pattern 3: Cross-Module Impact Check (Pre-POST)

```typescript
// Check before dispatching venta
async function checkCanDispatchVenta(venta: Venta) {
  const { tenant } = useAuthStore()
  if (!tenant) throw new Error('No tenant')
  
  // 1. Check caja_sesion active
  const { data: cajaActiva } = await supabase
    .from('caja_sesiones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .is('cerrado_at', null)
    .single()
  
  if (venta.tipo_pago === 'Efectivo' && !cajaActiva) {
    throw new Error('No hay caja abierta. Abre una sesión de caja.')
  }
  
  // 2. Check inventory available (if picking by FIFO)
  const stockNeeded = venta.venta_items.reduce((sum, item) => sum + item.cantidad, 0)
  const { data: inventario } = await supabase
    .from('inventario_lineas')
    .select('stock_actual')
    .eq('producto_id', venta.venta_items[0]?.producto_id)
    .eq('tenant_id', tenant.id)
  
  const stockAvailable = inventario?.reduce((sum, l) => sum + l.stock_actual, 0) ?? 0
  
  if (stockAvailable < stockNeeded) {
    throw new Error(`Inventario insuficiente (disponible: ${stockAvailable}, necesario: ${stockNeeded})`)
  }
  
  return true
}
```

### Pattern 4: Form with Soft-Delete Flag

```typescript
export function GastoForm({ gastoId }: { gastoId?: UUID }) {
  const { data: gasto } = useQuery({
    queryKey: ['gasto', gastoId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gastos')
        .select('*')
        .eq('id', gastoId)
        .single()
      return data
    },
    enabled: !!gastoId,
  })
  
  // Show anulado state
  if (gasto?.anulado) {
    return (
      <div className="p-4 bg-red-100 border border-red-400 rounded">
        <strong>Anulado</strong> por {gasto.anulado_por} el {formatDate(gasto.anulado_at)}
        <p className="text-sm text-gray-600">{gasto.anulado_razon}</p>
      </div>
    )
  }
  
  // Edit form for active records
  return (
    <form onSubmit={handleSubmit}>
      {/* ... form fields ... */}
    </form>
  )
}
```

---

## Testing Snippets (SQL)

### Verify Cash Reconciliation
```sql
-- Run this after venta dispatch:
SELECT 
  cs.id,
  cs.saldo_inicial,
  cs.saldo_actual,
  SUM(CASE WHEN cm.tipo='ingreso' THEN cm.monto ELSE -cm.monto END) as calculated,
  cs.saldo_inicial + SUM(CASE WHEN cm.tipo='ingreso' THEN cm.monto ELSE -cm.monto END) as expected_saldo
FROM caja_sesiones cs
LEFT JOIN caja_movimientos cm ON cs.id = cm.caja_sesion_id
WHERE cs.id = '[session-id]'
GROUP BY cs.id, cs.saldo_inicial, cs.saldo_actual;

-- saldo_actual should match expected_saldo
```

### Verify Stock Reconciliation
```sql
-- Run this after venta dispatch:
SELECT 
  p.id,
  p.nombre,
  p.sku,
  SUM(il.stock_actual) as total_stock,
  COUNT(DISTINCT il.id) as lineas
FROM productos p
LEFT JOIN inventario_lineas il ON p.id = il.producto_id
WHERE p.tenant_id = '[tenant-id]'
GROUP BY p.id, p.nombre, p.sku
ORDER BY p.nombre;

-- Verify no negative stocks, reasonable values
```

### Verify Audit Trail
```sql
-- After POST venta + dispatch:
SELECT 
  tabla,
  accion,
  COUNT(*) as entries
FROM actividad_log
WHERE registro_id = '[venta-id]' OR venta_id = '[venta-id]'
GROUP BY tabla, accion
ORDER BY tabla;

-- Expect: ventas UPDATE, movimientos_stock INSERT, caja_movimientos INSERT, actividad_log entries
```

---

