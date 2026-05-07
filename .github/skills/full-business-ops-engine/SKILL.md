---
name: full-business-ops-engine
description: 'Actúa como Arquitecto de Software Senior y Consultor de Operaciones. Úsalo para: diseñar/revisar sistemas multi-módulo (WMS↔Ventas↔Caja↔Gastos↔RRHH); evaluar impacto antes de implementar; debuguear integridad de datos; crear schema, triggers, RLS en sistemas multi-tenant.'
argument-hint: 'Describe la funcionalidad, módulo o problema (ej: "Agregar gastos a caja"; "Diseñar RRHH nómina"; "Debuguear mismatch inventario-ventas")'
---

# Motor Integral de Operaciones del Negocio

Metodología exhaustiva para diseñar, implementar y mantener sistemas de comercio integrados donde **múltiples módulos (WMS, Ventas, Caja, Gastos, RRHH) operan como un ecosistema holístico y auditado**.

---

## Cuándo Usarla

✅ **Fase de Diseño/Revisión**
- Arquitectar funcionalidades que abarquen múltiples módulos
- Evaluar impacto: "Si agrego esto a Gastos, ¿qué se rompe en Caja/RRHH?"
- Asegurar que el audit trail (actividad_log) capture todos los cambios

✅ **Fase de Implementación**
- Escribir migraciones, triggers, políticas RLS
- Crear endpoints API o Edge Functions
- Cablear flujos complejos (venta despachada → stock disminuye → ingreso en caja se registra automáticamente)

✅ **Fase de Debugging**
- Mismatch de stock: venta marcada despachada pero stock_actual no cambia
- Discrepancias en caja: egreso registrado pero saldo_actual inconsistente
- Gaps en auditoría: transacción no logged en actividad_log

---

## Core Principles

### 1. Single Source of Truth per Domain
- **Inventory**: `inventario_lineas.stock_actual` ← ONLY updated by triggers on movimientos_stock
- **Cash**: `caja_sesiones.saldo_actual` ← ONLY updated by triggers on caja_movimientos
- **Expenses**: `gastos.monto` ← immutable once created; can be marked `anulado=true`
- **HR**: `empleados.*` ← canonical employee record; NEVER duplicate in users

### 2. Atomic Transactions
```
Each operation is ONE of:
  [A] INSERT into primary table (ventas, caja_movimientos, gastos, etc.)
  [B] Trigger(s) fire to cascade updates (stock, saldo, audit log)
  [C] Transaction completes or rolls back entirely
```
**Never** POST to API, wait for callback, then UPDATE elsewhere. Everything is **trigger-driven**.

### 3. Multi-Tenant Isolation with RLS
```
Every table has tenant_id + RLS policy:
  SELECT/INSERT/UPDATE/DELETE allowed
  WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
```
**No exceptions.** No "skip RLS for admin." Admin sees ONE tenant's data.

### 4. Immutable Audit Trail
```
Every transaction type (venta, movimiento_stock, caja_movimiento, gasto, rrhh_*)
  → logActividad(table, action, record_id, changes, table_primary_key_value)
  → NO manual deletes in actividad_log (app-level soft-delete via `anulado` flag)
```

### 5. Schema Order (Migrations)
```
1. Helper tables (no FK): tenants, planes, cotizaciones
2. Auth tables: users
3. Master data: productos, categorias, ubicaciones, clientes, proveedores
4. Transactional: movimientos_stock, ventas, caja_sesiones, caja_movimientos, gastos
5. HR: empleados, rrhh_puestos, rrhh_departamentos
6. Views & functions
7. Triggers
8. RLS policies last
```

---

## The Four Modules + Integration Points

### 📦 WMS & Inventory
**Tables:** `productos`, `inventario_lineas`, `inventario_series`, `movimientos_stock`, `ubicaciones`

**Key Logic:**
- `stock_actual` = SUM(cantidad) per SKU across all lineas
- Trigger `on INSERT movimientos_stock`: updates `inventario_lineas.stock_actual`
- `disponible_surtido=true` ← required for venta picking (ubicaciones con `disponible_surtido=false` excluded)
- Reglas: FIFO/FEFO/LEFO/LIFO/Manual per product (override per SKU or fallback to tenant default)

**Integrations:**
- ❌ Venta created → stock stays reserved in `inventario_lineas.cantidad_reservada`
- ✅ Venta despachada → stock decreases in `stock_actual`; RLS prevents cross-tenant picking

### 💳 Sales & Cash (POS)
**Tables:** `ventas`, `venta_items`, `venta_series`, `caja_sesiones`, `caja_movimientos`

**Key Logic:**
- Venta flow: draft → cotizada → confirmada → despachada (or anulada)
- Only `estado='despachada'` triggers cash ingreso + stock decrease
- `medio_pago` is JSON: `[{"tipo":"Efectivo","monto":1500},{"tipo":"Tarjeta","monto":500}]`
- **Efectivo** → auto-insert `caja_movimientos.ingreso` at dispatch + update `caja_sesiones.saldo_actual`
- **Tarjeta/Transferencia/MP** → informational (no caja impact, recorded as `tipo='ingreso_informativo'`)

**Integrations:**
- ✅ Link venta → stock via `linea_id` in `venta_items` (trazabilidad WMS→Venta)
- ✅ Link venta → caja via auto-ingreso when `tipo_pago='Efectivo'` at despachada

### 💰 Expenses & Financials
**Tables:** `gastos`, `caja_movimientos` (tipo='egreso')

**Key Logic:**
- Gasto created + `medio_pago='Efectivo'` → auto-insert `caja_movimiento.egreso` + update saldo
- Gasto with `medio_pago='No Especificado'` → informational (no caja impact)
- P&L: `ganancia_neta = ventas_total - costo_ventas - gastos_total`
- `costoVentas = SUM(producto.precio_costo * cantidad)` per period

**Integrations:**
- ✅ Gasto efectivo → caja egreso
- ✅ Gasto monto > caja.saldo_actual → blocked (UI error before POST)

### 👥 HR & Payroll
**Tables:** `empleados`, `rrhh_puestos`, `rrhh_departamentos` (Phase 1)  
**Future:** `rrhh_salarios`, `rrhh_vacaciones`, `rrhh_asistencia` (Phases 2–5)

**Key Logic:**
- `empleados` is immutable master record (DNI unique per tenant)
- Soft delete: `activo=false` (never hard-delete employee records)
- Phase 2: `rrhh_salarios.estado='pagada'` → auto-insert `caja_movimiento.egreso` + logActividad

**Integrations:**
- 🟡 Phase 2A: Nómina payed → auto-caja egreso (future)
- 🟡 Phase 3A: Asistencia + comisiones by venta (future)

---

## Procedure: Implement a New Feature

### Step 1: Impact Assessment (Before Code)
**Ask:**
- Which tables am I modifying? (Products? Inventory? Cash? E-receipts?)
- What triggers will fire? (Auto-stock decrease? Auto-caja ingreso?)
- Who reads this data? (OWNER? RRHH? CAJERO?) → RLS implications
- How is this audited? (actividad_log entry required?)
- Edge case: what if no active caja_session? → block or allow?

**Output:** Reference [./references/impact-matrix.md](./references/impact-matrix.md) to map feature → tables → triggers → RLS

### Step 2: Schema Design (migrations/NNN_*.sql)
**Checklist:**
1. ✅ Table has `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
2. ✅ Table has `created_at` and `updated_at` TIMESTAMPTZ
3. ✅ Soft-delete pattern: `activo BOOLEAN DEFAULT TRUE` (or status enum)
4. ✅ Indexes on `tenant_id` + frequently queried columns
5. ✅ RLS enabled: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
6. ✅ RLS policy uses **subquery**, never functions in policy WHERE clauses
7. ✅ Trigger to `set_updated_at()` on every UPDATE
8. ✅ Trigger to `logActividad()` on INSERT/UPDATE/DELETE where audit needed

### Step 3: Implement Triggers
**Pattern:**
```sql
-- Trigger: venta → auto-caja ingreso
CREATE OR REPLACE FUNCTION public.venta_dispatch_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_efectivo DECIMAL(12,2);
  v_caja_sesion_id UUID;
BEGIN
  -- Only on estado='despachada' transition
  IF NEW.estado = 'despachada' AND OLD.estado != 'despachada' THEN
    -- Extract efectivo from medio_pago JSON
    v_efectivo := COALESCE(
      (NEW.medio_pago::jsonb ->> 'efectivo')::DECIMAL(12,2), 0
    );
    
    IF v_efectivo > 0 THEN
      -- Get active caja sesion
      SELECT id INTO v_caja_sesion_id
      FROM caja_sesiones
      WHERE tenant_id = NEW.tenant_id AND cerrado_at IS NULL
      LIMIT 1;
      
      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'No hay sesión de caja abierta';
      END IF;
      
      -- Insert caja_movimiento
      INSERT INTO caja_movimientos(tenant_id, caja_sesion_id, tipo, monto, concepto, venta_id)
      VALUES(NEW.tenant_id, v_caja_sesion_id, 'ingreso', v_efectivo, 'Venta#'||NEW.numero, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_venta_dispatch_to_caja
AFTER UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.venta_dispatch_to_caja();
```

### Step 4: Test Data Integrity
Use [./scripts/integrity-check.sql](./scripts/integrity-check.sql) to validate:
```sql
-- After dispatch venta with efectivo:
-- 1. caja_movimientos has ingreso entry
-- 2. caja_sesiones.saldo_actual increased
-- 3. inventario_lineas.stock_actual decreased
-- 4. actividad_log has entries for venta, caja_movimiento, movimiento_stock
```

### Step 5: Update SYSTEM_MAP.md
Document in [./assets/SYSTEM_MAP.md](./assets/SYSTEM_MAP.md):
```
## Feature: [Feature Name]
- **Trigger:** [SQL function that fires]
- **Tables affected:** [table_1, table_2, ...]
- **RLS impact:** [Any policy changes?]
- **Audit:** [logActividad call details]
- **User flow:** [Step-by-step from UI]
```

---

## Procedure: Debug Data Integrity Issue

### Issue: Venta Despachada but Stock Unchanged
**Diagnosis:**
1. Check `actividad_log` for venta + movimientos_stock entries
2. Run: `SELECT stock_actual FROM inventario_lineas WHERE producto_id=X AND tenant_id=Y`
3. Check if `caja_sesiones` has an open session (required for efectivo)
4. Verify RLS: user belongs to correct tenant_id

**Common Causes:**
- ❌ Venta has `tipo_pago='Tarjeta'` (not auto-decreasing, intentional)
- ❌ `estado='confirmada'` not `'despachada'` (trigger only fires on dispatch)
- ❌ Trigger `venta_dispatch_to_stock` missing or disabled
- ❌ RLS policy blocks inventory write (cross-tenant data) → check `tenant_id`

**Fix:**
```sql
-- Force re-apply trigger (if stuck in draft):
UPDATE ventas SET estado='despachada' WHERE id=... AND estado='confirmada';

-- Check audit trail:
SELECT * FROM actividad_log 
WHERE tabla='ventas' AND registro_id=... 
ORDER BY created_at DESC LIMIT 5;
```

### Issue: Cash Mismatch (saldo_actual ≠ expected)
**Diagnosis:**
1. Get caja_sesion_id from open session
2. Run: `SELECT SUM(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END) FROM caja_movimientos WHERE caja_sesion_id=X`
3. Compare to `caja_sesiones.saldo_actual`
4. Check `saldo_inicial` (is it 0? should session have been reset?)

**Common Causes:**
- ❌ `caja_movimiento` inserted manually without trigger
- ❌ Gasto egreso not linked to any caja_sesion (missing INSERT)
- ❌ tipo='ingreso_informativo' counted in saldo (should NOT be)

### Issue: Audit Trail Missing (actividad_log empty)
**Diagnosis:**
1. Check if table has trigger `tr_log_...` attached
2. Confirm RLS allows user to read `actividad_log.venta_id`
3. Verify `logActividad()` function is not being rate-limited

**Common Causes:**
- ❌ Trigger never created for table
- ❌ logActividad() fires before transaction commits → timing issue
- ❌ Type mismatch in function call (e.g., passing INT to UUID param)

---

## Procedure: Wire a New RRHH Phase

### Example: Phase 2A — Nómina (Payroll)

**1. Schema** (`migrations/015_rrhh_nomina.sql`)
```sql
CREATE TABLE IF NOT EXISTS rrhh_salarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  salario_basico DECIMAL(12,2) NOT NULL,
  descuentos DECIMAL(12,2) DEFAULT 0,
  comisiones DECIMAL(12,2) DEFAULT 0,
  salario_neto DECIMAL(12,2) GENERATED ALWAYS AS (salario_basico + comisiones - descuentos) STORED,
  estado TEXT CHECK (estado IN ('borrador','procesada','pagada')) DEFAULT 'borrador',
  creado_por UUID REFERENCES users(id),
  pagado_at TIMESTAMPTZ,
  caja_movimiento_id UUID REFERENCES caja_movimientos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_salarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_salarios_tenant" ON rrhh_salarios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_tenant ON rrhh_salarios(tenant_id);
```

**2. Trigger: Pagar nómina → caja egreso**
```sql
CREATE OR REPLACE FUNCTION public.rrhh_salarios_pay_to_caja()
RETURNS TRIGGER AS $$
DECLARE
  v_caja_sesion_id UUID;
  v_caja_movimiento_id UUID;
BEGIN
  IF NEW.estado = 'pagada' AND OLD.estado != 'pagada' THEN
    SELECT id INTO v_caja_sesion_id
    FROM caja_sesiones
    WHERE tenant_id = NEW.tenant_id AND cerrado_at IS NULL
    LIMIT 1;
    
    IF v_caja_sesion_id IS NULL THEN
      RAISE EXCEPTION 'No session activa para registrar pago de nómina';
    END IF;
    
    INSERT INTO caja_movimientos(tenant_id, caja_sesion_id, tipo, monto, concepto, rrhh_salario_id)
    VALUES(NEW.tenant_id, v_caja_sesion_id, 'egreso', NEW.salario_neto, 
           'Nómina ' || (SELECT email FROM empleados WHERE id = NEW.empleado_id), NEW.id)
    RETURNING id INTO v_caja_movimiento_id;
    
    UPDATE rrhh_salarios SET caja_movimiento_id = v_caja_movimiento_id, pagado_at = NOW()
    WHERE id = NEW.id;
    
    PERFORM logActividad('rrhh_salarios', 'UPDATE', NEW.id, 
      json_build_object('estado', NEW.estado, 'salario_neto', NEW.salario_neto),
      'rrhh_salario_id');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**3. UI Component** (`src/pages/RrhhPage.tsx`)
- Tab "Nómina": form para crear `rrhh_salarios` en estado 'borrador'
- Editable: descuentos, comisiones
- Botón "Procesar nómina" → batch update estado='procesada'
- Botón "Pagar" → UPDATE estado='pagada' (triggers caja egreso)

**4. Test & Verify**
```sql
-- After clicking "Pagar":
SELECT * FROM rrhh_salarios WHERE estado='pagada' AND tenant_id=... ORDER BY pagado_at DESC;
SELECT * FROM caja_movimientos WHERE tipo='egreso' AND concepto LIKE 'Nómina%' AND tenant_id=...;
SELECT * FROM actividad_log WHERE tabla='rrhh_salarios' AND tenant_id=... ORDER BY created_at DESC;
```

---

## Reference Documents

- [./references/impact-matrix.md](./references/impact-matrix.md) — Feature → Tables → Triggers → RLS impact
- [./references/integrity-checklist.md](./references/integrity-checklist.md) — Pre-commit verification
- [./references/patterns.md](./references/patterns.md) — Reusable SQL patterns for each module
- [./assets/SYSTEM_MAP.md](./assets/SYSTEM_MAP.md) — Living doc of all cross-module connections

---

## Use This Skill When

✅ Designing multi-table features (e.g., "Add discounts to venta items and sync to margins")  
✅ Reviewing migrations before applying to PROD  
✅ Debugging stock/cash/audit discrepancies  
✅ Implementing new RRHH phases  
✅ Evaluating impact: "What breaks if I change this table?"

---

