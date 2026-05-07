# Patrones Reutilizables

Patrones SQL + TypeScript listos para copiar-pegar. Todos son idempotentes (seguros para re-ejecutar).

---

## Patrones SQL

### Patrón 1: Nueva Tabla RRHH (Plantilla Estándar)

Úsalo para: `rrhh_salarios`, `rrhh_vacaciones`, `rrhh_asistencia`, etc.

```sql
-- Migration: NNN_rrhh_[feature].sql
CREATE TABLE IF NOT EXISTS rrhh_[feature] (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  -- Columnas específicas de la funcionalidad
  [nombre_columna] [tipo_dato] [constraints],
  -- Columnas estándar auditoría
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- FKs a módulos relacionados
  creado_por UUID REFERENCES users(id),
  UNIQUE(tenant_id, empleado_id, [columnas_unicas_feature])
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

### Patrón 2: Auto-insert en Caja al Cambiar Estado

Úsalo para: "venta despachada debe crear ingreso en caja"

```sql
CREATE OR REPLACE FUNCTION public.venta_dispatch_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_efectivo DECIMAL(12,2);
  v_caja_sesion_id UUID;
  v_caja_movimiento_id UUID;
BEGIN
  -- Solo disparar en cambio estado a 'despachada'
  IF NEW.estado = 'despachada' AND (OLD.estado IS NULL OR OLD.estado != 'despachada') THEN
    -- Calcular efectivo desde JSON medio_pago
    v_efectivo := COALESCE(
      (NEW.medio_pago::jsonb -> 'efectivo')::DECIMAL(12,2),
      0
    );
    
    -- Solo crear movimiento caja si efectivo > 0
    IF v_efectivo > 0 THEN
      -- Encontrar sesión caja activa (requerida)
      SELECT id INTO v_caja_sesion_id
      FROM caja_sesiones
      WHERE tenant_id = NEW.tenant_id
        AND cerrado_at IS NULL
      LIMIT 1;
      
      -- Bloquear si no hay sesión activa
      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'No hay sesión de caja abierta. Abre una sesión antes de despachar.';
      END IF;
      
      -- Crear movimiento ingreso
      INSERT INTO caja_movimientos(
        tenant_id, caja_sesion_id, tipo, monto, concepto, venta_id
      ) VALUES (
        NEW.tenant_id, v_caja_sesion_id, 'ingreso', v_efectivo,
        'Venta #' || NEW.numero, NEW.id
      ) RETURNING id INTO v_caja_movimiento_id;
      
      -- Log del movimiento
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

-- Eliminar y recrear trigger
DROP TRIGGER IF EXISTS tr_venta_dispatch_to_caja ON ventas;
CREATE TRIGGER tr_venta_dispatch_to_caja
AFTER UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.venta_dispatch_to_caja();
```

---

### Patrón 3: Auto-insert en Inventario en Movimiento de Ingreso

Úsalo para: "movimiento ingreso debe aumentar stock_actual"

```sql
CREATE OR REPLACE FUNCTION public.movimiento_stock_update_linea()
RETURNS TRIGGER AS $$
DECLARE
  v_cantidad_cambio INTEGER;
BEGIN
  -- Determinar dirección (ingreso = +, rebaje = -)
  v_cantidad_cambio := CASE
    WHEN NEW.tipo = 'ingreso' THEN NEW.cantidad
    WHEN NEW.tipo = 'rebaje' THEN -NEW.cantidad
    ELSE 0
  END;
  
  -- Actualizar stock_actual de línea de inventario
  UPDATE inventario_lineas
  SET stock_actual = stock_actual + v_cantidad_cambio,
      updated_at = NOW()
  WHERE id = NEW.linea_id
    AND tenant_id = NEW.tenant_id;
  
  -- Log de actividad
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

### Patrón 4: Transacción Reversa (Void/Anular)

Úsalo para: "anular venta debe revertir stock + caja"

```sql
CREATE OR REPLACE FUNCTION public.venta_anular_reverse()
RETURNS TRIGGER AS $$
DECLARE
  v_venta_item RECORD;
  v_efectivo DECIMAL(12,2);
  v_caja_reversal_id UUID;
BEGIN
  -- Solo en cambio estado a 'anulada'
  IF NEW.estado = 'anulada' AND OLD.estado != 'anulada' THEN
    -- Restaurar stock para cada venta_item
    FOR v_venta_item IN
      SELECT * FROM venta_items WHERE venta_id = NEW.id
    LOOP
      -- Insertar movimiento rebaje para reversar stock decrease
      INSERT INTO movimientos_stock(
        tenant_id, linea_id, tipo, cantidad, motivo, concepto, venta_id
      ) VALUES (
        NEW.tenant_id, v_venta_item.linea_id, 'rebaje', -v_venta_item.cantidad,
        'ANULACION', 'Anulación venta #' || NEW.numero, NEW.id
      );
    END LOOP;
    
    -- Reversar movimiento caja si fue despachada con efectivo
    IF OLD.estado = 'despachada' THEN
      v_efectivo := COALESCE(
        (NEW.medio_pago::jsonb -> 'efectivo')::DECIMAL(12,2),
        0
      );
      
      IF v_efectivo > 0 THEN
        -- Encontrar ingreso correspondiente y marcarlo anulado
        UPDATE caja_movimientos
        SET anulado = TRUE, updated_at = NOW()
        WHERE venta_id = NEW.id AND tipo = 'ingreso';
        
        -- Crear egreso reversal (movimiento negativo)
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

### Patrón 5: Soft-Delete con Auditoría

Úsalo para: Marcar registros como inactivos preserva historial

```sql
-- En cualquier tabla, agregar:
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado BOOLEAN DEFAULT FALSE;
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES users(id);
ALTER TABLE [tablename] ADD COLUMN IF NOT EXISTS anulado_razon TEXT;

-- Función para soft-delete seguro
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

-- Siempre consultar con:
SELECT * FROM [tablename] WHERE tenant_id = ... AND (anulado = FALSE OR anulado IS FALSE)
```

---

## Patrones TypeScript

### Patrón 1: useQuery para Datos Multi-Tenant

```typescript
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useRrhhSalarios() {
  const { tenant } = useAuthStore()
  
  return useQuery({
    queryKey: ['rrhh-salarios', tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error('Sin tenant')
      
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

### Patrón 2: Mutation con RLS + Auditoría

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
      if (!tenant) throw new Error('Sin tenant')
      
      const { data, error } = await supabase
        .from('gastos')
        .insert([{
          tenant_id: tenant.id,
          ...gasto,
        }])
        .select()
        .single()
      
      if (error) throw error
      
      // Fire-and-forget audit (sin await)
      logActividad('gastos', 'INSERT', data.id, gasto, 'gasto_id')
      
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gastos', tenant?.id] })
    },
  })
}
```

### Patrón 3: Verificación de Impacto Cross-Module (Pre-POST)

```typescript
// Verificar antes de despachar venta
async function checkCanDispatchVenta(venta: Venta) {
  const { tenant } = useAuthStore()
  if (!tenant) throw new Error('Sin tenant')
  
  // 1. Verificar caja_sesion activa
  const { data: cajaActiva } = await supabase
    .from('caja_sesiones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .is('cerrado_at', null)
    .single()
  
  if (venta.tipo_pago === 'Efectivo' && !cajaActiva) {
    throw new Error('Sin caja abierta. Abre una sesión de caja.')
  }
  
  // 2. Verificar inventario disponible (si picking por FIFO)
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

### Patrón 4: Form con Flag Soft-Delete

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
  
  // Mostrar estado anulado
  if (gasto?.anulado) {
    return (
      <div className="p-4 bg-red-100 border border-red-400 rounded">
        <strong>Anulado</strong> por {gasto.anulado_por} el {formatDate(gasto.anulado_at)}
        <p className="text-sm text-gray-600">{gasto.anulado_razon}</p>
      </div>
    )
  }
  
  // Formulario edición para registros activos
  return (
    <form onSubmit={handleSubmit}>
      {/* ... campos del form ... */}
    </form>
  )
}
```

---

## Snippets de Testing (SQL)

### Verificar Reconciliación de Caja
```sql
-- Ejecutar después de despachar venta:
SELECT 
  cs.id,
  cs.saldo_inicial,
  cs.saldo_actual,
  SUM(CASE WHEN cm.tipo='ingreso' THEN cm.monto ELSE -cm.monto END) as calculado,
  cs.saldo_inicial + SUM(CASE WHEN cm.tipo='ingreso' THEN cm.monto ELSE -cm.monto END) as saldo_esperado
FROM caja_sesiones cs
LEFT JOIN caja_movimientos cm ON cs.id = cm.caja_sesion_id
WHERE cs.id = '[session-id]'
GROUP BY cs.id, cs.saldo_inicial, cs.saldo_actual;

-- saldo_actual debe coincidir con saldo_esperado
```

### Verificar Reconciliación de Stock
```sql
-- Ejecutar después de despachar venta:
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

-- Verificar sin stocks negativos, valores razonables
```

### Verificar Pista de Auditoría
```sql
-- Después de POST venta + despachar:
SELECT 
  tabla,
  accion,
  COUNT(*) as entradas
FROM actividad_log
WHERE registro_id = '[venta-id]' OR venta_id = '[venta-id]'
GROUP BY tabla, accion
ORDER BY tabla;

-- Esperar: ventas UPDATE, movimientos_stock INSERT, caja_movimientos INSERT, actividad_log entries
```

---
