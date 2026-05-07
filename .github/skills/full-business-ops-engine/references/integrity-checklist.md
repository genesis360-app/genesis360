# Pre-Commit Integrity Checklist

Use this checklist **before pushing any migration or feature branch** to ensure data integrity across modules.

---

## Schema Design Checklist

### Every New Table
- [ ] `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- [ ] `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [ ] `created_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] `updated_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] `activo BOOLEAN DEFAULT TRUE` (for soft-delete if needed)
- [ ] Index on `tenant_id`: `CREATE INDEX idx_tablename_tenant ON tablename(tenant_id)`
- [ ] Unique constraint includes `tenant_id` (e.g., `UNIQUE(tenant_id, dni_rut)`)
- [ ] No hardcoded values in defaults (use NULLs or trigger-computed)
- [ ] All FK references have `ON DELETE CASCADE` or `ON DELETE RESTRICT` (never `SET NULL` unless intentional)

### RLS Policy
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` present
- [ ] Policy uses subquery: `WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- [ ] Policy name is descriptive: `policy_name_tenant` or `policy_name_action`
- [ ] DO NOT use functions inside WHERE clause of policy (use subquery)
- [ ] All four operations have policies if exposed to API: SELECT, INSERT, UPDATE, DELETE

### Trigger for Audit
- [ ] `logActividad()` called on INSERT/UPDATE/DELETE
- [ ] Trigger uses `SECURITY DEFINER` if calling functions
- [ ] Trigger wrapped in `CREATE OR REPLACE FUNCTION` (idempotent)
- [ ] Trigger name: `tr_tablename_action` (e.g., `tr_venta_dispatch`)
- [ ] Trigger has `AFTER` (not BEFORE) for audit logging

---

## Migration Syntax Checklist

```sql
-- DO NOT use CREATE POLICY IF NOT EXISTS
-- ❌ NOT SUPPORTED IN PostgreSQL

-- USE: DO $$ BEGIN IF NOT EXISTS ...
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tablename' AND policyname='policy_name') THEN
    CREATE POLICY "policy_name" ON tablename
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- All comments must describe business logic, not just code
-- ❌ BAD: -- this creates a table
-- ✅ GOOD: -- Audit log: immutable record of all transactional changes

-- Use IF NOT EXISTS for all CREATE statements
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE FUNCTION IF NOT EXISTS ...
```

### Idempotency
- [ ] File is safe to run twice without errors
- [ ] All `CREATE ... IF NOT EXISTS`
- [ ] All `DO $$ BEGIN IF NOT EXISTS ...` for policies
- [ ] All `ALTER TABLE IF NOT EXISTS` for column additions
- [ ] No DROP statements (use soft-delete or backward-compatible schema)

---

## Cross-Module Integrity Checklist

### Venta → Stock → Cash
- [ ] Venta `estado` enum: draft, cotizada, confirmada, despachada, anulada
- [ ] Trigger `tr_venta_dispatch_to_stock` fires on `estado='despachada'`
- [ ] Trigger `tr_venta_dispatch_to_caja` fires on `estado='despachada'` with `tipo_pago='Efectivo'`
- [ ] Stock decrease uses `getRebajeSort()` (FIFO/LEFO/etc.) to select correct linea
- [ ] `logActividad` called for venta chage AND for movimiento_stock AND for caja_movimiento (3 entries total)
- [ ] Cannot dispatch if no `caja_sesion_id` active (applies if venta.tipo_pago has efectivo)

### Gasto → Cash
- [ ] Gasto with `medio_pago='Efectivo'`[→ caja_movimiento egreso created
- [ ] Gasto `monto > caja_saldo_actual` → blocked in UI (validation before POST)
- [ ] Gasto with `medio_pago != 'Efectivo'` → NO caja_movimiento
- [ ] logActividad called for gasto INSERT AND for caja_movimiento egreso (2 entries)
- [ ] Cannot create gasto.efectivo if no caja_sesion active

### Inventory Reconciliation
- [ ] `stock_actual` **only** modified by trigger on `movimientos_stock`
- [ ] No manual UPDATEs to `inventario_lineas.stock_actual` allowed (except migrations to backfill)
- [ ] `cantidad_reservada` tracks unpicked confirmadas (future feature validation)
- [ ] `disponible_surtido=false` ubicaciones excluded from venta picking
- [ ] All inventory movements have `linea_id` FK (trazabilidad)

### Cash Reconciliation
- [ ] `caja_sesiones.saldo_actual = saldo_inicial + SUM(caja_movimientos WHERE tipo IN ('ingreso','egreso'))`
- [ ] `tipo='ingreso_informativo'` NOT counted in saldo (informational only)
- [ ] Only `tipo='ingreso'` and `tipo='egreso'` affect `saldo_actual`
- [ ] Cannot close caja if `saldo_actual != saldo_conteo` (diff > 0.01)
- [ ] All caja_movimientos have corresponding logActividad entries

### Audit Trail
- [ ] `actividad_log` **never** has manual INSERTs (trigger-only)
- [ ] `logActividad()` called with correct params: `(tabla, accion, registro_id, cambios, pk_field)`
- [ ] `actividad_log` SELECT works for all roles (readable by OWNER at minimum)
- [ ] Cannot delete in actividad_log (only set `anulado=true` in source table)

---

## Testing Checklist

### Before PR Submission

#### Functional Tests (UI + Database)
- [ ] Create venta + dispatch with efectivo → stock decreased + caja ingreso created
- [ ] Create venta + dispatch with tarjeta → stock decreased + NO caja ingreso
- [ ] Create gasto.efectivo → caja egreso + saldo decreased
- [ ] Create gasto.no_especificado → NO caja movement
- [ ] Anular venta con estado={'despachada'} → stock restored + caja reversal
- [ ] Add product from scan → inventario_lineas created + logActividad 2 entries

#### Edge Case Tests
- [ ] Dispatch venta with NO active caja_sesion → error message (not silent crash)
- [ ] Create gasto.efectivo with monto > caja_saldo → blocked at UI (form validation)
- [ ] Dispatch venta from other tenant (X) while logged in as tenant Y → blocked by RLS
- [ ] Modify producto.precio_costo → old venta_items.costo immutable (verify in Histórico)
- [ ] Soft-delete employee + create nómina → use `WHERE activo=true` (omit deleted)

#### Audit Tests
```sql
-- After completing a venta:
SELECT * FROM actividad_log WHERE tabla IN ('ventas','movimientos_stock','caja_movimientos')
  AND registro_id = $venta_id ORDER BY created_at;
  
-- Expect exactly 3 entries: venta UPDATE, movimientos_stock INSERT, caja_movimientos INSERT
-- If any missing → audit log trigger failed
```

#### RLS Tests
- [ ] User from tenant_A cannot see products/inventory from tenant_B
- [ ] CAJERO cannot create gastos (only view) — check in UsuariosPage permissions
- [ ] RRHH cannot see ventas (only see with SUPERVISOR role) — check RLS policies

#### Reconciliation Tests
```sql
-- Cash balance test:
SELECT caja_sesion_id, saldo_inicial, saldo_actual,
  SUM(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END) as calculated_balance
FROM caja_movimientos 
WHERE caja_sesion_id = $1
GROUP BY caja_sesion_id;
-- saldo_actual should equal saldo_inicial + calculated_balance

-- Stock balance test:
SELECT producto_id, SUM(stock_actual) as total_stock
FROM inventario_lineas
WHERE tenant_id = $1 AND producto_id = $2
GROUP BY producto_id;
-- Verify reasonable number (not negative, not physically impossible)
```

---

## Deploy Checklist (PROD)

**Before applying migration to PROD:**

1. ✅ Migration applied to DEV and tested 48+ hours
2. ✅ V2.0 applied in this order:
   - Create new tables
   - Add columns to existing tables
   - Create functions
   - Create/update triggers
   - Create/update indexes
   - Add RLS policies
3. ✅ Rollback plan documented (previous version SOP)
4. ✅ SYSTEM_MAP.md updated with feature description
5. ✅ Release notes include "breaking changes" if any
6. ✅ Team notified of any downtime needed (usually 0)

**During deployment:**
- [ ] Monitor `actividad_log` for errors (unexpected entries)
- [ ] Monitor Vercel logs for API errors
- [ ] Check Supabase metrics for slow queries (from new indexes)
- [ ] Spot-check: venta dispatch creates caja ingreso
- [ ] Spot-check: gasto.efectivo creates caja egreso

**After deployment:**
- [ ] Run reconciliation queries (cash + stock)
- [ ] User acceptance test on 3–5 sample transactions
- [ ] Create GitHub issue if any issues (do not hide)

---

## Common Pitfalls (Pre-Commit)

| Issue | How to Avoid | Impact |
|-------|------------|--------|
| Circular trigger dependencies | Draw flow diagram before writing | Silent infinite loops or crashes |
| RLS blocks legitimate data | Test with multiple roles before PR | CAJERO cannot open caja, oops |
| Audit log missing | Call logActividad() at END of trigger | Compliance failure + debugging hell |
| Cash mismatch | Write reconciliation query IN migration | Users lose trust in app |
| Stock overcount | Manual UPDATEs instead of triggers | Overselling + negative stock |
| Soft-delete not queried | Always `WHERE activo=true` | Deleted employees in nómina |
| Wrong RLS formula | Use subquery, never functions | Data leak to competing tenant |

---

