---
title: Módulo RRHH
category: features
tags: [rrhh, empleados, nomina, vacaciones, asistencia, capacitaciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# Módulo RRHH

Módulo completo de recursos humanos. 5 fases implementadas en producción.

**Página:** `src/pages/RrhhPage.tsx`  
**Acceso:** Roles OWNER y RRHH (via `is_rrhh()` SECURITY DEFINER)

---

## Roles con acceso

```
OWNER  → acceso completo a todo
RRHH   → gestión delegada (empleados, nómina, vacaciones, asistencia)
SUPERVISOR → solo "Mi Equipo" (tab equipo/asistencia/vacaciones/cumpleaños)
```

---

## Phase 1 — RRHH Básico (v0.26.0 · migration 014)

**Tablas:**
- `empleados`: DNI/RUT, contacto, datos personales, datos laborales, supervisor_id, salario_bruto, activo (soft delete)
- `rrhh_puestos`: nombre, salario_base_sugerido
- `rrhh_departamentos`: nombre, descripción

**UI:**
- Tab **Empleados**: CRUD completo, soft delete (`activo=false`)
- Tab **Puestos**: gestión de puestos con salario sugerido
- Tab **Departamentos**: gestión de departamentos
- Tab **Cumpleaños**: próximos cumpleaños con edad, feriados AR

**Decisiones:**
- Tabla `empleados` separada de `users` (auth vs RRHH data)
- UNIQUE(tenant_id, dni_rut)
- Soft delete siempre, nunca hard delete
- Nómina semi-automática (cada país tiene reglas distintas)

---

## Phase 2A — Nómina (v0.32.0 · migration 017)

**Tablas:**
- `rrhh_conceptos`: catálogo de haberes/descuentos reutilizables por tenant
- `rrhh_salarios`: liquidación por empleado × periodo (DATE YYYY-MM-01). UNIQUE(tenant+empleado+periodo). Campos: basico, total_haberes, total_descuentos, neto, pagado, medio_pago, fecha_pago, caja_movimiento_id
- `rrhh_salario_items`: líneas de detalle → trigger `fn_recalcular_salario` recalcula totales en padre

**Función SQL:**
```sql
pagar_nomina_empleado(p_salario_id, p_sesion_id, p_medio_pago DEFAULT 'efectivo')
SECURITY DEFINER
-- Verifica saldo caja si medio='efectivo'
-- Inserta egreso en caja_movimientos
-- Marca pagado=TRUE
```

**Medios de pago nómina:** `efectivo` / `transferencia_banco` / `mp`

**UI:**
- Tab "Nómina": selector mes/año, generar nómina mes (crea borradores para todos los activos)
- Tabla expandible por empleado con ítems
- Catálogo de conceptos CRUD colapsable
- Selector caja + medio de pago al pagar
- Historial de sueldos por empleado (tabla evolutiva)

---

## Phase 2B — Vacaciones (v0.33.0 · migration 018)

**Tablas:**
- `rrhh_vacaciones_solicitud`: estado pendiente/aprobada/rechazada, dias_habiles calculados, aprobado_por, aprobado_at
- `rrhh_vacaciones_saldo`: días_totales, remanente_anterior, dias_usados. UNIQUE(tenant+empleado+año)

**Funciones SQL:**
```sql
aprobar_vacacion(p_solicitud_id, p_user_id) SECURITY DEFINER
  -- Upsert saldo + marca aprobada
rechazar_vacacion(p_solicitud_id, p_user_id) SECURITY DEFINER
  -- Marca rechazada
calcular_dias_habiles(desde, hasta) SQL
  -- Usa generate_series excluyendo DOW 0 (domingo) y 6 (sábado)
```

**UI:**
- Tab "Vacaciones": selector año, nueva solicitud con preview días hábiles, lista con aprobar/rechazar, saldos colapsables por empleado

---

## Phase 3A — Asistencia (v0.33.0 · migration 019)

**Tabla `rrhh_asistencia`:**
- UNIQUE(tenant+empleado+fecha)
- Estados: `presente` / `ausente` / `tardanza` / `licencia`
- Campos: hora_entrada, hora_salida, motivo

**UI:** filtro mes + empleado, tabla con badges por estado, CRUD completo

---

## Phase 3B — Dashboard RRHH (v0.35.0)

**KPIs:**
- Total empleados activos, nuevos este mes
- Cumpleaños del mes
- Cantidad de departamentos
- % presencia mensual (presentes/tardanzas/ausentes/licencias)
- Vacaciones pendientes de aprobación
- Nómina: total liquidaciones/pagadas/pendientes + monto

**Funciones:**
- Breakdown por departamento (barra proporcional + count)
- Exportar Excel: asistencia mensual (`asistencia_YYYY-MM.xlsx`) + nómina histórica

---

## Phase 4A — Documentos (v0.34.0 · migration 022)

**Tabla `rrhh_documentos`:**
- tenant_id, empleado_id, nombre, tipo (contrato/cert/cv/foto/otro)
- storage_path, tamanio, mime_type, created_by
- Bucket privado `empleados` (10 MB max)
- Path: `{empleado_id}/{timestamp}.{ext}`
- URL firmada temporal (300s) para descarga

**UI:** Tab "Documentos" — filtro por empleado, form upload, lista con Ver y Eliminar

---

## Phase 4B — Capacitaciones (v0.34.0 · migration 023)

**Tabla `rrhh_capacitaciones`:**
- empleado_id, nombre, descripcion, fecha_inicio, fecha_fin, horas
- proveedor, estado (planificada/en_curso/completada/cancelada)
- resultado, certificado_path
- Certificado reutiliza bucket `empleados`: `{empleado_id}/cap_{timestamp}.{ext}`

**UI:** Tab "Capacitaciones" — filtro por empleado + estado, badges de estado, Ver cert, edit, delete

---

## Phase 5 — Supervisor Self-Service (v0.35.0 · migration 024)

**Función SQL:**
```sql
get_supervisor_team_ids() SECURITY DEFINER STABLE
-- Retorna IDs de empleados donde supervisor_id = auth.uid()
```

**RLS SUPERVISOR** (políticas PERMISSIVE, se suman a las existentes):
- `rrhh_asistencia`, `rrhh_vacaciones_solicitud`, `rrhh_vacaciones_saldo`, `empleados` (FOR SELECT)
- Solo acceden a su equipo

**UI Tab "Mi Equipo":**
- Visible para SUPERVISOR (default tab) y OWNER/RRHH
- KPIs asistencia hoy: presentes/ausentes/sin registrar
- Vacaciones pendientes del equipo con botones Aprobar/Rechazar
- Árbol organizacional con indentación por supervisor

**Tabs por rol:**
- SUPERVISOR: solo `equipo / asistencia / vacaciones / cumpleaños`
- OWNER/RRHH: todos los tabs

---

## Funcionalidades adicionales

### Feriados nacionales (migration 036)
- Tabla `rrhh_feriados` (nacional/provincial/personalizado/no_laborable)
- Botón "🇦🇷 AR 2026" en tab Cumpleaños → carga 16 feriados bulk (solo los faltantes)
- Widget "Próximos feriados" en Dashboard RRHH

### Birthday Notifications (EF)
- Edge Function `birthday-notifications` (GET/POST)
- Filtra empleados activos con cumpleaños hoy
- Inserta en `actividad_log`
- GitHub Actions: cron `0 8 * * *` (8 AM UTC diario)

### Sueldo sugerido al crear empleado
- Al seleccionar puesto → autocompleta `salario_bruto` con `puesto.salario_base_sugerido`
- Select muestra: `Repositor — $350.000`

### Restricción menú RRHH
- Rol RRHH: ve solo `/rrhh`. Cualquier otra ruta → redirect `/rrhh`
- Flag `rrhhVisible: true` en navItem para bypass de `ownerOnly`

---

## Links relacionados

- [[wiki/features/caja]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/database/schema-overview]]
