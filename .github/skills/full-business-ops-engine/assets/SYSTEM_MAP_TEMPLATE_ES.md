# SYSTEM_MAP.md — Plantilla

**Documentación viva de todas las conexiones cross-módulo en Stokio.**

Copia esta plantilla a la raíz de tu proyecto y actualiza conforme se Agregan funcionalidades. Este es la **fuente única de verdad** de cómo WMS, Ventas, Caja, Gastos y RRHH se comunican.

---

## Estructura del Documento

```
SYSTEM_MAP.md
├── Descripción General Módulos
├── Diagramas Flujo de Datos (Mermaid)
├── Inventario de Funcionalidades (con puntos integración)
├── Triggers & Automatización
├── RLS & Límites de Seguridad
├── Limitaciones Conocidas & Deuda Técnica
└── Changelog
```

---

## Plantilla

```markdown
# Stokio — Mapa del Sistema

**Última actualización:** [FECHA] · **Versión:** v0.X.0

---

## 1. Descripción General de Módulos

### 📦 WMS e Inventario
- **Propósito:** Rastreo multi-almacén, gestión ubicaciones, trazabilidad lotes/vencimientos
- **Tablas Core:** `productos`, `inventario_lineas`, `inventario_series`, `movimientos_stock`, `ubicaciones`
- **Restricciones Clave:**
  - `stock_actual` = SUM entre todas las líneas por SKU
  - `disponible_surtido=true` requerido para picking en venta
  - Soft-delete: `activo=false` para productos

### 💳 Ventas (POS)
- **Propósito:** Cotización, confirmación orden, despacho, facturación
- **Tablas Core:** `ventas`, `venta_items`, `venta_series`
- **Restricciones Clave:**
  - Estados: borrador → cotizada → confirmada → despachada (o anulada)
  - Stock disminuye solo en `estado='despachada'`
  - Múltiples venta_items de diferentes líneas (picking FIFO)

### 💰 Gestión de Caja
- **Propósito:** Rastrear flujo físico de efectivo, sesiones, reconciliación
- **Tablas Core:** `caja_sesiones`, `caja_movimientos`
- **Restricciones Clave:**
  - `saldo_actual = saldo_inicial + SUM(ingreso - egreso)` por sesión
  - `tipo IN ('ingreso','egreso','ingreso_informativo')`
  - Informativo NO contado en balance

### 💸 Gastos y Contabilidad
- **Propósito:** Gastos no-inventario, tracking P&L
- **Tablas Core:** `gastos`, `caja_movimientos` (entradas egreso)
- **Restricciones Clave:**
  - `medio_pago='Efectivo'` → auto-egreso en caja
  - Soft-delete: `anulado=true` (inmutable una vez creado)
  - `ganancia_neta = total_ventas - costo_ventas - total_gastos`

### 👥 RRHH y Nómina
- **Propósito:** Maestro empleados, roles, estructura org, futuro: nómina, asistencia
- **Tablas Core:** `empleados`, `rrhh_puestos`, `rrhh_departamentos`
- **Restricciones Clave:**
  - UNIQUE(tenant_id, dni_rut) — sin empleados duplicados
  - Soft-delete: `activo=false` (nunca hard-delete)
  - Phase 1 implementada; Phases 2–5 en queue

---

## 2. Diagramas Flujo de Datos

### 2.1 Flujo Despacho Venta (Happy Path)
\`\`\`mermaid
graph TD
    A["Usuario: Click 'Despachar Venta'"] --> B["Verificar: ¿Caja activa?"]
    B -->|NO| C["Error: Abre caja primero"]
    B -->|SÍ| D["UPDATE ventas: estado='despachada'"]
    D --> E["Trigger: verificar medio_pago"]
    E -->|Efectivo| F["INSERT caja_movimientos: ingreso"]
    E -->|Otro| G["Sin movimiento caja"]
    F --> H["Trigger: disminuir stock"]
    G --> H
    H --> I["INSERT movimientos_stock: rebaje"]
    I --> J["Trigger: audit log 3 entradas"]
    J --> K["Éxito: Venta completada"]
\`\`\`

### 2.2 Flujo Gasto Efectivo
\`\`\`mermaid
graph TD
    A["Usuario: Crear Gasto + efectivo"] --> B["Verificar: ¿monto > saldo actual?"]
    B -->|SÍ| C["Error: Saldo insuficiente"]
    B -->|NO| D["INSERT gastos"]
    D --> E["Trigger: verificar medio_pago"]
    E -->|Efectivo| F["INSERT caja_movimientos: egreso"]
    E -->|No efectivo| G["Sin movimiento caja"]
    F --> H["Trigger: UPDATE saldo caja"]
    G --> H
    H --> I["Trigger: audit log 2 entradas"]
    I --> J["Éxito"]
\`\`\`

---

## 3. Inventario de Funcionalidades

### Integración Venta + Stock + Caja (v0.27.0)
- **Triggers:**
  - `tr_venta_dispatch_to_stock` — disminuye inventario_lineas.stock_actual
  - `tr_venta_dispatch_to_caja` — crea ingreso si efectivo > 0
- **RLS:** SELECT/INSERT/UPDATE/DELETE venta por tenant_id
- **Auditoría:** 3 entradas logActividad (venta, movimientos_stock, caja_movimientos)
- **Edge cases:**
  - Sin caja activa → despacho venta BLOQUEADO
  - Múltiples tipos medio_pago mezclados → foreach array JSON

### Integración Gasto + Caja (v0.27.0)
- **Triggers:**
  - `tr_gasto_insert_to_caja` — auto-crea egreso si tipo='Efectivo'
- **RLS:** SELECT/INSERT gasto por owner+RRHH, UPDATE/DELETE solo owner
- **Auditoría:** 2 entradas logActividad (gasto INSERT, caja_movimientos INSERT)
- **Edge cases:**
  - Sin caja activa → gasto.efectivo BLOQUEADO
  - monto > saldo_actual → bloqueado validación form

### Aging Profiles (v0.25.0)
- **Triggers:** `tr_process_aging_profiles` — ejecución diaria/manual
- **Flujo:** Scanear todas las líneas → comparar dias_restantes vs reglas → actualizar estado → logActividad
- **Config:** Override por SKU en ProductoFormPage

### RRHH Phase 1 (v0.26.0)
- **Tablas:** empleados, rrhh_puestos, rrhh_departamentos (readline-only hasta Phase 2)
- **Triggers:** Audit logs estándar
- **Relación:** Aún no linked a ventas (futuro: comisiones)

---

## 4. Triggers & Automatización

### Triggers Relacionados a Stock
\`\`\`
TABLE: inventario_lineas
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: movimientos_stock
  ├─ AFTER INSERT: tr_movimiento_stock_update_linea (actualiza linea.stock_actual)
  └─ AFTER INSERT: tr_log_movimientos_stock (auditoría)

TABLE: ventas
  ├─ AFTER UPDATE: tr_venta_dispatch_to_stock (en estado='despachada')
  └─ AFTER UPDATE: tr_venta_dispatch_logs (auditoría)
\`\`\`

### Triggers Relacionados a Caja
\`\`\`
TABLE: caja_sesiones
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: caja_movimientos
  ├─ BEFORE INSERT: tr_validate_caja_movimiento (verificar saldo, tipo)
  ├─ AFTER INSERT: tr_caja_movimiento_update_saldo (actualiza caja_sesiones.saldo_actual)
  └─ AFTER INSERT: tr_log_caja_movimientos (auditoría)

TABLE: ventas
  ├─ AFTER UPDATE: tr_venta_dispatch_to_caja (en estado='despachada', si efectivo>0)
  └─ AFTER UPDATE: tr_venta_anular_reverse (en estado='anulada')

TABLE: gastos
  ├─ AFTER INSERT: tr_gasto_insert_to_caja (si medio_pago='Efectivo')
  └─ AFTER INSERT: tr_log_gastos (auditoría)
\`\`\`

### Triggers Relacionados a RRHH
\`\`\`
TABLE: empleados
  └─ BEFORE UPDATE: tr_set_updated_at

TABLE: rrhh_salarios [FUTURO Phase 2A]
  ├─ AFTER UPDATE: tr_rrhh_salarios_pay_to_caja (en estado='pagada')
  └─ AFTER UPDATE: tr_log_rrhh_salarios (auditoría)
\`\`\`

---

## 5. RLS & Límites de Seguridad

### Aislamiento Multi-Tenant
Todas las tablas usan política RLS estándar:
\`\`\`sql
WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
\`\`\`

### Acceso por Rol
| Rol | Tablas Accesibles | Acciones |
|-----|------------------|----------|
| OWNER | Todas | SELECT, INSERT, UPDATE, DELETE |
| SUPERVISOR | Productos, Inventario, Movimientos | SELECT, INSERT (sin config) |
| CAJERO | Caja, Ventas (list/edit), Gasto (list solo) | SELECT, INSERT (limitado) |
| RRHH | Empleados, Puestos, Deptos | SELECT, INSERT, UPDATE |
| ADMIN | Todas las tablas (VIEW UN tenant solo) | SELECT |

**Política de seguridad:** RRHH NO ve Ventas. CAJERO NO crea Gastos.

---

## 6. Limitaciones Conocidas & Deuda Técnica

### Deuda Técnica
- [ ] `linea_id` en `venta_items` nunca se escribe (columna existe sin usar)
  - **Impacto:** No puede rastrear LPN en venta_items viejos
  - **Fix:** Backfill + mandatory en código futuro
- [ ] Aging profiles no se ejecutan con schedule (solo manual)
  - **Impacto:** Usuario debe clickear botón diariamente
  - **Fix:** Implementar pg_cron o cron Vercel
- [ ] Comisiones aún no linked a rrhh_empleados
  - **Impacto:** No auto-pagar comisiones en Phase 2A
  - **Fix:** Agregar rrhh_salarios.comisiones_calculadas trigger

### Issues Conocidas
- [ ] UX multi-caja: poco claro cuál cerrar si 2+ abiertas
  - **Workaround:** OWNER debe especificar manualmente
- [ ] Cierre caja manual vs automatic: confuso para CAJERO
  - **Workaround:** Agregar validación timestamp (más de 24h = auto-flag)

---

## 7. Changelog

| Versión | Fecha | Funcionalidad | Módulos Afectados | Notas |
|---------|-------|---------------|------------------|-------|
| v0.27.0 | 2026-03-15 | Integración Venta→Stock→Caja | WMS, Ventas, Caja | Todo efectivo auto-posts a caja |
| v0.26.0 | 2026-03-10 | RRHH Phase 1 | RRHH | Empleados, Puestos, Deptos |
| v0.25.0 | 2026-03-05 | Aging Profiles | WMS | Reglas FIFO/LEFO/LIFO/FEFO |

---

## Cómo Actualizar Este Documento

Cuando agregas una funcionalidad:
1. Agregar entrada a sección Feature Inventory con tablas + triggers
2. Actualizar RLS & Access si cambiaron roles
3. Agregar diagrama Mermaid si flujo datos es complejo
4. Log en Changelog
5. Commit a git con rama de feature

\`\`\`bash
git add SYSTEM_MAP.md CLAUDE.md
git commit -m "docs: actualizar SYSTEM_MAP para vX.Y.Z — [descripción feature]"
git push origin dev
\`\`\`

---
\`\`\`

---

## Cómo Usar Esta Plantilla

1. **Copiar este contenido** a raíz proyecto como `SYSTEM_MAP.md`
2. **Rellenar secciones** conforme implementas funcionalidades
3. **Mantenerlo actualizado** cada release (parte checklist PR)
4. **Referenciar en debugging** (ej: "Stock no disminuye, verifica diagrama Venta→Stock trigger")
5. **Linkear desde README** para que todo el equipo lo encuentre

**Beneficios:**
- 🎯 Onboarda nuevos dev (entienden flujo en 10 min)
- 🐛 Debugging más rápido (ve todos triggers en una ojeada)
- 🚨 Previene errores (antes agregar feature, verifica matriz impacto)
- 📋 Doc viva (siempre actualizado o está mal)
