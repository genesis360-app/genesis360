# SYSTEM_MAP.md Template

**Living documentation of all cross-module connections in Stokio.**

Copy this template to your project root and update as features are added. This is the **single source of truth** for how WMS, Ventas, Caja, Gastos, and RRHH communicate.

---

## Document Structure

```
SYSTEM_MAP.md
├── Modules Overview
├── Data Flow Diagrams (Mermaid)
├── Feature Inventory (with integration points)
├── Triggers & Automation
├── RLS & Security Boundaries
├── Known Limitations & Debt
└── Changelog
```

---

## Template

```markdown
# Stokio — System Map

**Last updated:** [DATE] · **Version:** v0.X.0

---

## 1. Modules Overview

### 📦 WMS & Inventory
- **Purpose:** Multi-warehouse stock tracking, location management, batch/lot tracing
- **Core Tables:** `productos`, `inventario_lineas`, `inventario_series`, `movimientos_stock`, `ubicaciones`
- **Key Constraints:**
  - `stock_actual` = SUM across all lineas per SKU
  - `disponible_surtido=true` required for venta picking
  - Soft-delete: `activo=false` for productos

### 💳 Sales (POS)
- **Purpose:** Quotation, order confirmation, dispatch, invoicing
- **Core Tables:** `ventas`, `venta_items`, `venta_series`
- **Key Constraints:**
  - Estados: draft → cotizada → confirmada → despachada (or anulada)
  - Stock decrease on `estado='despachada'` only
  - Multiple venta_items can come from different lineas (FIFO picking)

### 💰 Cash Management
- **Purpose:** Track physical cash flow, sessions, reconciliation
- **Core Tables:** `caja_sesiones`, `caja_movimientos`
- **Key Constraints:**
  - `saldo_actual = saldo_inicial + SUM(ingreso - egreso)` per session
  - `tipo IN ('ingreso','egreso','ingreso_informativo')`
  - Informativo NOT counted in balance

### 💸 Expenses & Accounting
- **Purpose:** Non-inventory expenses, P&L tracking
- **Core Tables:** `gastos`, `caja_movimientos` (egreso entries)
- **Key Constraints:**
  - `medio_pago='Efectivo'` → auto-egreso in caja
  - Soft-delete: `anulado=true` (immutable once created)
  - `ganancia_neta = ventas_total - costo_ventas - gastos_total`

### 👥 HR & Payroll
- **Purpose:** Employee master, roles, organizational structure, future: payroll, attendance
- **Core Tables:** `empleados`, `rrhh_puestos`, `rrhh_departamentos`
- **Key Constraints:**
  - UNIQUE(tenant_id, dni_rut) — no duplicate employees
  - Soft-delete: `activo=false` (never hard-delete)
  - Phase 1 implemented; Phases 2–5 queued

---

## 2. Data Flow Diagrams

### 2.1 Venta Dispatch Flow (Happy Path)
\`\`\`mermaid
graph TD
    A["User: Click 'Despachar Venta'"] --> B["Check: Caja activa?"]
    B -->|NO| C["Error: Abre caja first"]
    B -->|SÍ| D["UPDATE ventas: estado='despachada'"]
    D --> E["Trigger: check medio_pago"]
    E -->|Efectivo| F["INSERT caja_movimientos: ingreso"]
    E -->|Otra| G["No caja movement"]
    F --> H["Trigger: stock decrease"]
    G --> H
    H --> I["INSERT movimientos_stock: rebaje"]
    I --> J["Trigger: audit log 3 entries"]
    J --> K["Success: Venta completada"]
\`\`\`

### 2.2 Gasto Efectivo Flow
\`\`\`mermaid
graph TD
    A["User: Crear Gasto + efectivo"] --> B["Check: monto > saldo actual?"]
    B -->|SÍ| C["Error: Insuficiente saldo"]
    B -->|NO| D["INSERT gastos"]
    D --> E["Trigger: check medio_pago"]
    E -->|Efectivo| F["INSERT caja_movimientos: egreso"]
    E -->|No efectivo| G["No caja movement"]
    F --> H["Trigger: UPDATE caja saldo"]
    G --> H
    H --> I["Trigger: audit log 2 entries"]
    I --> J["Success"]
\`\`\`

---

## 3. Feature Inventory

### Venta + Stock + Caja Integration (v0.27.0)
- **Triggers:**
  - `tr_venta_dispatch_to_stock` — decreases inventory_lineas.stock_actual
  - `tr_venta_dispatch_to_caja` — creates ingreso if efectivo > 0
- **RLS:** Venta SELECT/INSERT/UPDATE/DELETE per tenant_id
- **Audit:** 3 logActividad entries (venta, movimientos_stock, caja_movimientos)
- **Edge cases:**
  - No active caja → venta dispatch BLOCKED
  - Multiple medio_pago types mixed → foreach in JSON array

### Gasto + Caja Integration (v0.27.0)
- **Triggers:**
  - `tr_gasto_insert_to_caja` — auto-creates egreso if tipo='Efectivo'
- **RLS:** Gasto SELECT/INSERT by owner+RRHH, UPDATE/DELETE by owner only
- **Audit:** 2 logActividad entries (gasto INSERT, caja_movimientos INSERT)
- **Edge cases:**
  - No active caja → gasto.efectivo BLOCKED
  - monto > saldo_actual → blocked at form validation

### Aging Profiles (v0.25.0)
- **Triggers:** `tr_process_aging_profiles` — daily/manual execution
- **Flow:** Scan all lineas → compare dias_restantes to rules → update estado → logActividad
- **Config:** Per SKU override in ProductoFormPage

### RRHH Phase 1 (v0.26.0)
- **Tables:** empleados, rrhh_puestos, rrhh_departamentos (readonly until Phase 2)
- **Triggers:** Standard audit logs
- **Relation:** No yet linked to ventas (future: comisiones)

---

## 4. Triggers & Automation

### Stock-Related Triggers
\`\`\`
TABLE: inventario_lineas
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: movimientos_stock
  ├─ AFTER INSERT: tr_movimiento_stock_update_linea (updates linea.stock_actual)
  └─ AFTER INSERT: tr_log_movimientos_stock (audit)

TABLE: ventas
  ├─ AFTER UPDATE: tr_venta_dispatch_to_stock (on estado='despachada')
  └─ AFTER UPDATE: tr_venta_dispatch_logs (audit)
\`\`\`

### Cash-Related Triggers
\`\`\`
TABLE: caja_sesiones
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: caja_movimientos
  ├─ BEFORE INSERT: tr_validate_caja_movimiento (check saldo, tipo)
  ├─ AFTER INSERT: tr_caja_movimiento_update_saldo (updates caja_sesiones.saldo_actual)
  └─ AFTER INSERT: tr_log_caja_movimientos (audit)

TABLE: ventas
  ├─ AFTER UPDATE: tr_venta_dispatch_to_caja (on estado='despachada', if efectivo>0)
  └─ AFTER UPDATE: tr_venta_anular_reverse (on estado='anulada')

TABLE: gastos
  ├─ AFTER INSERT: tr_gasto_insert_to_caja (if medio_pago='Efectivo')
  └─ AFTER INSERT: tr_log_gastos (audit)
\`\`\`

### HR-Related Triggers
\`\`\`
TABLE: empleados
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: rrhh_salarios [FUTURE Phase 2A]
  ├─ AFTER UPDATE: tr_rrhh_salarios_pay_to_caja (on estado='pagada')
  └─ AFTER UPDATE: tr_log_rrhh_salarios (audit)
\`\`\`

---

## 5. RLS & Security Boundaries

### Multi-Tenant Isolation
All tables use standard RLS policy:
\`\`\`sql
WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
\`\`\`

### Role-Based Access
| Role | Tables Accessible | Actions |
|------|------------------|---------|
| OWNER | All | SELECT, INSERT, UPDATE, DELETE |
| SUPERVISOR | Productos, Inventario, Movimientos | SELECT, INSERT (no config) |
| CAJERO | Caja, Ventas (list/edit), Gasto (list only) | SELECT, INSERT (limited) |
| RRHH | Empleados, Puestos, Deptos | SELECT, INSERT, UPDATE |
| ADMIN | All tables (single tenant VIEW only) | SELECT |

**Security Policy:** RRHH CANNOT see Ventas. CAJERO CANNOT create Gastos.

---

## 6. Known Limitations & Debt

### Technical Debt
- [ ] `linea_id` in `venta_items` never written (column exists but unused)
  - **Impact:** Cannot trace LPN in old venta_items
  - **Fix:** Backfill + mandatory in future code
- [ ] Aging profiles not run on schedule (manual only)
  - **Impact:** User must click button daily
  - **Fix:** Implement pg_cron or Vercel cron
- [ ] Comisiones not linked to rrhh_empleados yet
  - **Impact:** Cannot auto-pay sales commissions in Phase 2A
  - **Fix:** Add rrhh_salarios.comisiones_calculadas trigger

### Known Issues
- [ ] Multiple cajas UX: unclear which caja to close if 2+ open
  - **Workaround:** OWNER must manually specify
- [ ] Caja cierre manual vs automatic: confusing for CAJERO
  - **Workaround:** Add timestamp validation (older than 24h = auto-flag)

---

## 7. Changelog

| Version | Date | Feature | Modules Affected | Notes |
|---------|------|---------|------------------|-------|
| v0.27.0 | 2026-03-15 | Venta→Stock→Caja integration | WMS, Ventas, Cash | All efectivo auto-posts to caja |
| v0.26.0 | 2026-03-10 | RRHH Phase 1 | HR | Empleados, Puestos, Deptos |
| v0.25.0 | 2026-03-05 | Aging Profiles | WMS | FIFO/LEFO/LIFO/FEFO rules |

---

## How to Update This Document

When adding a feature:
1. Add entry to Feature Inventory section with tables + triggers
2. Update RLS & Access if roles changed
3. Add Mermaid diagram if data flow is complex
4. Log in Changelog
5. Commit to git with feature branch

```
git add SYSTEM_MAP.md CLAUDE.md
git commit -m "docs: update SYSTEM_MAP for vX.Y.Z — [feature description]"
git push origin dev
```

---
```

---

## How to Use This Template

1. **Copy this content** to your project root as `SYSTEM_MAP.md`
2. **Fill in sections** as you implement features
3. **Keep it updated** every release (part of PR checklist)
4. **Reference it** in debugging (e.g., "Customer stock not decreasing, check Venta→Stock trigger diagram")
5. **Link from README** so all team members know it exists

**Benefits:**
- 🎯 Onboards new team members (understand flow in 10 min)
- 🐛 Debugging faster (see all triggers at a glance)
- 🚨 Prevents mistakes (before adding feature, check impact matrix)
- 📋 Living documentation (always up-to-date or it's wrong)

