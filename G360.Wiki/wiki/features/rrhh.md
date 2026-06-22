---
title: Módulo RRHH
category: features
tags: [rrhh, empleados, nomina, vacaciones, asistencia, capacitaciones, aportes, sac, fichado, recibo-sueldo]
sources: [CLAUDE.md, ROADMAP.md, relevamiento_rrhh_respuestas.md]
updated: 2026-06-09
---

# Módulo RRHH

Módulo completo de recursos humanos. 5 fases base + **RRHH 2.0 (RH1+RH2+RH3+RH6) en PROD** (v1.46.0, mig 195-198).

**Página:** `src/pages/RrhhPage.tsx`  
**Acceso:** Roles OWNER y RRHH (via `is_rrhh()` SECURITY DEFINER)

---

## RRHH 2.0 — relevamiento RH1-RH8 (respondido 2026-06-09)

Respuestas + diseño + modelo de datos + plan en `sources/raw/relevamiento_rrhh_respuestas.md`. **🎉 RH1-RH8 COMPLETO ✅ PROD (v1.46.0-v1.48.0, mig 195-202).**

- **RH7 — Documentos/evaluación/portal (mig 201):** **catálogo de documentos obligatorios** (E1, `rrhh_documentos_catalogo`) + alerta de **faltantes** (`documentosFaltantes`) y **próximos a vencer** (E2, `rrhh_documentos.fecha_vencimiento` + `documentosPorVencer`, umbral `tenants.rrhh_doc_alerta_dias`) · **capacitación obligatoria** (E3, `rrhh_capacitaciones.obligatoria`) · **evaluación de desempeño** 1-10 + tipo auto/supervisor/par (F4, `rrhh_evaluaciones`, panel en Reportes) · config **portal del empleado** (F2) + **notificaciones del ciclo** (F3). E4 (costo) = no. Lib `src/lib/rrhhDocumentos.ts`.
- **RH8 — Reportes + liquidación final (mig 202):** nuevo **tab Reportes** (`RrhhReportesPanel`): costo laboral por departamento · asistencia consolidada · vacaciones gozadas/pendientes · antigüedad/rotación · recibos (G1) + export Excel/CSV/PDF (G2) · **liquidación final** al egreso (A2-c, `src/lib/liquidacionFinal.ts`): indemnización LCT 245 + SAC proporcional + vacaciones no gozadas (sueldo/25 × días), **editable**, genera gasto en Gastos + persiste en `rrhh_liquidaciones_finales` (botón en empleados dados de baja). Lib `src/lib/rrhhReportes.ts`.

- **RH1 — Empleados 2.0 (mig 195):** alta con obligatorios (email/tel/puesto/depto) · **motivo de egreso** (modal de baja: renuncia/despido con o sin causa/fin contrato) + **reactivar** · **tipo de contrato configurable** (tabla `rrhh_tipos_contrato` + seed base AR; se eliminó la CHECK rígida; select con "+" inline; `es_relacion_dependencia` dispara los auto-aportes) · **datos bancarios** (`empleados.cbu/alias_cbu/banco/tipo_cuenta/titular_cuenta`).
- **RH2 — Aportes AR + SAC (mig 196):** `rrhh_conceptos` += `tipo_calculo` (fijo/porcentaje/sobre_bruto) / `default_pct` / `default_monto` / `es_aporte`; seed base AR (Jubilación 11% · Obra Social 3% · Ley 19.032 3% · Antigüedad · Presentismo · Sindicato) · **aportes configurables por empleado** (`empleados.config_aportes` JSONB, checkboxes en el form; el % vive en el concepto/Config — togglear no lo toca; "en negro" = sin checkboxes) + **beneficios extra** ($/%, `empleados.beneficios_extra`) · `crearLiquidacion` inyecta básico+beneficios+aportes vía `src/lib/rrhhNomina.ts` · **SAC = 50% del mejor sueldo del semestre** (botones SAC 1°/2° semestre).
- **RH3 — Nómina contable (mig 197):** **"Generar gasto"** por salario → inserta gasto en el módulo **Gastos** (categoría **Sueldos**, `estado_pago=pendiente`, link `rrhh_salarios.gasto_id`) · **"Cargas sociales → Gastos"** acumula los aportes del período por concepto (categoría **Cargas sociales**) · **recibo de sueldo PDF** (`src/lib/reciboSueldoPDF.ts`, con líneas de firma) · **comprobante firmado** opcional (bucket `empleados`, `rrhh_salarios.comprobante_firmado_url`) · **doble validación** configurable (`tenants.rrhh_nomina_doble_validacion`/`_supervisor_aprueba`; gate `puedeAprobarNomina`; toggle owner-only). Categorías Sueldos/Cargas sociales seedeadas idempotentes.
- **RH4 — Frecuencia + anticipos (mig 199):** `empleados.frecuencia_liquidacion` (+`frecuencia_dias`) **prorratea el básico** al generar la liquidación (mensual=1 / quincenal=½ / semanal=¼ / personalizado=días/30, lib `src/lib/rrhhLiquidacion.ts`) · **anticipos** (`rrhh_anticipos`, panel colapsable en Nómina): registra + opcional genera gasto "Adelantos al personal" (pendiente) y **se descuentan automáticamente en la próxima liquidación** (`anticiposADescontar`, sin neto negativo; descuento parcial deja el resto pendiente).
- **RH5 — Vacaciones 2.0 (mig 200):** **días por antigüedad LCT** 14/21/28/35 (botón "Sugerir LCT" en el saldo, `diasVacacionesLCT`+`antiguedadAnios`) + override · aprobación con **alerta de plazo de aviso** (`tenants.rrhh_vacaciones_aviso` sin/alerta/bloquea, `evaluarAviso`) + **solapamiento** (`solapamientos`, confirm) · **remanente auto** desde el año anterior con límite (`remanenteSiguiente`, `tenants.rrhh_vacaciones_remanente_max`) · panel de config en el tab (aviso + remanente máx) · C7 vacaciones pagas dentro del sueldo. Base C2/C5: `rrhh_vacaciones_solicitud` += estado `preaprobada` + `preaprobado_por/at`, `tenants.rrhh_vacaciones_flujo`/`_min_bloque`/`_max_bloques`. Lib pura `src/lib/rrhhVacaciones.ts`.
- **RH6 — Asistencia 2.0 (mig 198):** **fichado** clock-in/out (`rrhh_fichadas` con origen manual/celular/qr; el check-in rápido ya escribe el ledger) · **horario por empleado** (`horario_entrada/salida`, `dias_laborales`) · **licencias subdivididas** (`rrhh_asistencia.tipo_licencia` + catálogo `LICENCIA_TIPOS`) + `comprobante_url` · **horas extra** (`rrhh_horas_extra`, multiplicador 50/100 + aprobación; panel con monto vía `montoHorasExtra`) · **feriados con regla de pago** (`rrhh_feriados.regla_pago` simple/doble/triple). Lib pura `src/lib/rrhhAsistencia.ts`.

**🎉 RRHH 2.0 (RH1-RH8) COMPLETO.** Confirmado por GO: % de aportes editables en Config, categorías Sueldos/Cargas sociales, prorrateo del básico por frecuencia, indemnización LCT 245 editable.

### Diferidos cerrados — v1.51.0 (PROD ✅, mig 204)

Los 3 pendientes que habían quedado fuera de RRHH 2.0 se implementaron (PROD, PR #179):
- **Auto-descuento de tardanza en nómina:** `crearLiquidacion` junta las fichadas de **entrada** del período (`rrhh_fichadas`), calcula los minutos de atraso vs `empleados.horario_entrada` (primera entrada de cada día, tolerancia por día) con `minutosTardeFacturables` (lib `rrhhAsistencia.ts`) y descuenta con `descuentoTardanza` según `tenants.rrhh_tardanza_modo` (registrar/proporcional/umbral) + `rrhh_horas_mes_base`. Aparece como ítem "Descuento por tardanza (N min)". **(Desde H4, 2026-06-22, estos flags + `rrhh_tardanza_tolerancia_min`, `rrhh_horas_extra_requiere_aprobacion`, `rrhh_doc_alerta_dias`, `rrhh_nomina_supervisor_aprueba` se configuran en `Config → RRHH`; antes el tab era placeholder. Ver [[configuracion]].)**
- **Fichado por QR público** (`/fichar/:token`, `FicharPage.tsx`): kiosco sin login. `tenants.fichado_token` + RPCs `get_fichado_info`/`fichar_qr` (SECURITY DEFINER anon; auto-toggle entrada/salida según el último fichaje del día, `origen='qr'`). Config en **RRHH → Asistencia**: generar/rotar el QR + link + descargar PNG (owner-only).
- **Portal del empleado** (`/mi-portal`, `MiPortalPage.tsx`): el usuario vinculado a un legajo (`empleados.user_id`) ve **sus** recibos (PDF), vacaciones (saldo + solicitudes) y documentos, según `tenants.rrhh_portal_capacidades`. Gateado por `tenants.rrhh_portal_empleado`; nav "Mi Portal". Read-only (scoping client-side por `empleado_id`; el aislamiento server-side queda atado a la deuda de RLS por sucursal).

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

## Organigrama basado en empleados (ISS-185 · migration 147)

Desde migration 147, `empleados.supervisor_id` es **FK a `empleados(id)`** (antes apuntaba a `users(id)`). El árbol organizacional se arma 100% con empleados de RRHH, tengan o no usuario del sistema. El selector de supervisor en la ficha del empleado lista empleados activos (excluye al propio empleado para evitar auto-supervisión).

Para que el **self-service del SUPERVISOR** funcione, su empleado debe estar vinculado a su usuario vía `empleados.user_id`. `get_supervisor_team_ids()` mapea `auth.uid()` → `empleados.user_id` → `supervisor_id`. Sin esa vinculación, "Mi Equipo" aparece vacío.

### Vinculación empleado ↔ usuario del sistema (RRHH-A5 · migration 151)

El formulario de empleado (tab Empleados) incluye un selector **"Usuario del sistema (opcional)"** debajo del selector de supervisor. Lista los users del tenant ordenados por `nombre_display`, deshabilita los ya vinculados a otro empleado (con leyenda "ya vinculado a …") y permite "Sin vincular". La tabla de empleados muestra un badge azul `UserCheck + nombre_display` en la columna **Usuario** cuando hay vinculación.

Validaciones:
- **Cliente** (`handleGuardarEmpleado` en `src/pages/RrhhPage.tsx`): rechaza guardar si el `user_id` elegido ya pertenece a otro empleado del mismo tenant.
- **BD** (migration 151): índice UNIQUE parcial `empleados(tenant_id, user_id) WHERE user_id IS NOT NULL` (no bloquea N empleados sin usuario, que es el caso default).

> Decisión de diseño A5(b): `empleados.user_id` queda opcional. Se relaciona solo cuando aplica (DUEÑO/SUPERVISOR/CAJERO/CONTADOR/RRHH/DEPÓSITO usan el sistema). Empleados que no usan la app (operarios) quedan sin vincular.

> [!NOTE] ISS-184: el alta de empleado hace optimistic update (`setQueryData`) + `.select()` con joins, así el nuevo empleado aparece al instante sin recargar.

## Phase 5 — Supervisor Self-Service (v0.35.0 · migration 024 · actualizado migration 147)

**Función SQL:**
```sql
get_supervisor_team_ids() SECURITY DEFINER STABLE
-- v147: retorna empleados donde supervisor_id = (empleado vinculado a auth.uid() via user_id)
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
