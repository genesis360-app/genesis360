# Impact Assessment Matrix

Use this matrix **before writing any code** to evaluate how a new feature affects the entire system.

## Template: Feature Impact Analysis

| Dimension | Assessment | Risk |
|-----------|-----------|------|
| **Tables Modified** | List all tables touched (INSERT/UPDATE/DELETE) | ⚠️ More tables = higher complexity |
| **Triggers That Fire** | Enumerate triggers and their order | ⚠️ Circular dependencies? |
| **RLS Policies Affected** | Do existing policies need updates? | 🔴 Cross-tenant data leak if missed |
| **Audit Trail** | Is logActividad() called? | 🔴 Compliance loss if missed |
| **Cash Impact** | Does this affect caja_movimientos? | 🔴 Reconciliation failure |
| **Stock Impact** | Does this affect inventario_lineas? | 🔴 Picking errors, overselling |
| **User Roles** | Which roles can perform this? RLS screening? | ⚠️ CAJERO shouldn't create gastos |
| **Atomic Transaction** | Can this roll back cleanly? | 🔴 Data corruption risk |
| **Edge Cases** | No active caja? Negative values? Soft-delete? | ⚠️ Silent failures in production |

---

## Feature Examples

### ✅ Feature: Add Producto from Scan (Barcode)
```
Tables Modified:     productos (INSERT) + inventario_lineas (INSERT)
Triggers:            trigger_set_updated_at + logActividad
RLS Affected:        NO (standard tenant_id check)
Audit Trail:         YES (logActividad on insertions)
Cash Impact:         NO
Stock Impact:        YES (new linea with stock_inicial)
User Roles:          OWNER + SUPERVISOR only (RLS screening)
Atomic Trans:        YES (both INSERTs in same transaction or rollback)
Edge Cases:          • Empty barcode? → validation in UI + DB constraint
                     • Duplicate barcode? → UNIQUE index prevents
                     • User from competing tenant? → RLS blocks INSERT
Risk Level:          🟢 LOW
```

### ⚠️ Feature: Venta Anulación (Reverse)
```
Tables Modified:     ventas (UPDATE) + venta_items (status markedanulada)
                     + caja_movimientos (INSERT reversal entry)
                     + inventario_lineas (stock_actual restored)
Triggers:            tr_venta_anular_to_caja + tr_venta_anular_to_stock
RLS Affected:        YES (venta → debe devolver si era despachada)
Audit Trail:         YES (multiple logActividad calls)
Cash Impact:         YES (caja_movimiento reversal if was despachada)
Stock Impact:        YES (stock_actual+cantidad_reservada restored)
User Roles:          OWNER + SUPERVISOR (not CAJERO)
Atomic Trans:        YES (all or nothing)
Edge Cases:          • If venta has multiple cajas? → reverse each ingreso
                     • If inventory scrapped before anulación? → user input
                     • If venta partially picked for other orders? → error + manual intervention
Risk Level:          🔴 CRITICAL (affects caja + inventory reconciliation)
```

### 🔴 Feature: Modify Producto Precio (retroactive)
```
Tables Modified:     productos (UPDATE precio_venta)
                     venta_items (DO NOT MODIFY — historical)
Triggers:            trigger_set_updated_at ONLY (NOT price history)
RLS Affected:        NO
Audit Trail:         YES (logActividad on precio change, not on old venta_items)
Cash Impact:         NO (venta_items.precio_unitario is immutable)
Stock Impact:        NO
User Roles:          OWNER only (not SUPERVISOR!)
Atomic Trans:        YES (single UPDATE)
Edge Cases:          • What if precio_costo also changes? → affects margins
                     • Dashboard using cached margins? → invalidate cache
Risk Level:          🟡 MEDIUM (doesn't affect completed sales, but future margins)
DECISION:            Precio change is FORWARD-looking; old ventas keep their precio_unitario
```

---

## RLS Risk Checklist

🔴 **CRITICAL — Stop and review if:**
- Inserting/updating `tenant_id` field in a trigger
- Policy uses `OR` clause (easy to accidentally open data)
- Function inside RLS policy (can be exploited; use subquery instead)
- Hard-deleting user or tenant records

🟡 **MEDIUM — Test thoroughly if:**
- Adding new user role (RRHH, SUPERVISOR_AREA, etc.)
- Changing RLS scope (e.g., "show invoice to customer")
- Cross-tenant data sharing feature (e.g., shared product catalog)

🟢 **LOW — Standard if:**
- Simple `tenant_id IN (SELECT ...)` policy
- Only adding new field to existing table with RLS

---

## Cash Reconciliation Checklist

**After any feature touching `caja_movimientos`:**

1. ✅ `tipo IN ('ingreso','egreso','ingreso_informativo')`
2. ✅ `Efectivo venta despachada → ingreso created? YES`
3. ✅ `Non-efectivo venta → NO caja_movimiento (or ingreso_informativo only)`
4. ✅ `monto > 0 always`
5. ✅ `caja_sesion_id not null` (except informativo)
6. ✅ `SUM(movimientos) = saldo_actual`
7. ✅ logActividad entry for cada movimiento creado

Query to verify:
```sql
SELECT caja_sesion_id, 
  SUM(CASE WHEN tipo='ingreso' THEN monto 
           WHEN tipo='egreso' THEN -monto 
           ELSE 0 END) as net_change
FROM caja_movimientos 
WHERE caja_sesion_id = $1
GROUP BY caja_sesion_id;

-- Compare net_change to caja_sesiones.saldo_actual - saldo_inicial
```

---

## Stock Reconciliation Checklist

**After any feature touching `inventario_lineas.stock_actual`:**

1. ✅ Trigger fires only on `estado='despachada'` transition
2. ✅ `stock_actual ONLY decreases` at venta dispatch (no manual UPDATEs)
3. ✅ Ingreso movimiento increases stock_actual
4. ✅ Rebaje movimiento decreases stock_actual
5. ✅ Anulada venta restores stock_actual
6. ✅ logActividad entry for cada movimiento_stock

Query to verify:
```sql
SELECT p.nombre, p.sku, 
  COALESCE(SUM(il.stock_actual), 0) as total_stock,
  (SELECT COUNT(*) FROM venta_items vi WHERE vi.producto_id = p.id AND vi.venta_id IN 
    (SELECT id FROM ventas WHERE estado='confirmada')) as reserved
FROM productos p
LEFT JOIN inventario_lineas il ON p.id = il.producto_id AND il.tenant_id = p.tenant_id
WHERE p.tenant_id = $1
GROUP BY p.id, p.nombre, p.sku;
```

