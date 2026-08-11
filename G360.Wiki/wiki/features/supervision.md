---
title: Supervisión — Patrón "Pestaña de Supervisor" reusable
category: features
tags: [supervision, autorizaciones, permisos, aprobaciones, reasignar, trazabilidad, repositores]
sources: [migration 347, relevamiento_supervisor_tab_respuestas.md, src/components/SupervisionPanel.tsx, src/hooks/useSupervisorAutorizaciones.ts, src/pages/SupervisionPage.tsx]
updated: 2026-08-10
---

# Supervisión — Patrón "Pestaña de Supervisor" reusable

✅ **EN PROD desde v1.163.0 (2026-08-10, mig 347).** 2º de 4 relevamientos derivados hacia el módulo
Repositores (backlog Comercial de Fede, Fase E) — ver [[project_backlog_fede_comercial_25_7]] y
`relevamiento_supervisor_tab_respuestas.md` para las decisiones de negocio completas.

## Qué resuelve

Antes de esta feature, cada módulo que necesitaba un flujo de aprobación (Inventario, con
`autorizaciones_inventario`) tenía que armar su propia tabla y pantalla desde cero. El patrón
generaliza eso: una tabla, un permiso, un hook y un componente reusables por cualquier módulo futuro
(Pedidos, Gastos, RRHH...) que quiera sumar aprobaciones/reasignación/trazabilidad/KPIs sin duplicar
nada.

## Modelo de datos

- **`autorizaciones`** (antes `autorizaciones_inventario`, renombrada por la mig 347 — RENAME TABLE,
  no tabla nueva, preserva PK/FK/RLS/índices/trigger por OID) + columna **`modulo`** (NOT NULL, CHECK
  acotado al set real de módulos que escriben ahí — hoy solo `'inventario'`; se extiende con `ALTER
  TABLE` al retrofitear un módulo nuevo, mismo patrón incremental que ya usa la columna `tipo` de esta
  tabla, extendida 5 veces).
- **`asignado_a`** (uuid, nullable, FK a `users`): reasignación puntual (E1 del relevamiento) — NULL =
  disponible para cualquiera con permiso `supervisa` en ese módulo.
- Índices nuevos: `idx_autorizaciones_tenant_modulo_estado (tenant_id, modulo, estado)` y
  `idx_autorizaciones_asignado_a (asignado_a)`.

## Permiso `supervisa` (4º nivel, no `admin`)

`permisosModulo.ts` suma `'supervisa'` a `'no_ver'|'ver'|'editar'`. Se llama así y no `admin` a
propósito — ya existe un ROL fijo `ADMIN` (staff de soporte cross-tenant, ver
[[reference_rol_admin_staff_aislamiento]]) y usar el mismo nombre para el permiso hubiera sido
confuso en código y UI.

| Rol | Regla |
|---|---|
| DUEÑO / SUPER_USUARIO / ADMIN (staff) | Siempre, inmutable — no pasan por `permisos_custom`, no hay fila que editar |
| SUPERVISOR (fijo) | Heredado automático en los módulos donde ya tiene acceso hoy (mismo criterio que `supervisorOnly` en el nav) |
| Rol custom | Explícito — 4ª opción al ciclar el permiso por módulo en Usuarios → Roles personalizados |

Helper: `puedeSupervisarModulo(user, modulo)` en `src/lib/permisosModulo.ts`.

## UI — patrón híbrido (decisión B1)

1. **Tab "Supervisión" dentro de cada módulo** (contextual) — hoy solo Inventario (reemplazó al tab
   "Autorizaciones"), con 4 sub-secciones:
   - **Aprobaciones**: la lista de siempre (aprobar/rechazar), contenido específico de cada módulo —
     en Inventario cubre `ajuste_cantidad`, `eliminar_serie`, `eliminar_lpn`, `bulk_edit`,
     `ajuste_conteo`, `cambio_estado`, `kit_precio`, `repricing_margen`.
   - **Reasignar**: genérico, cualquier fila pendiente puede asignarse a un usuario puntual
     (`asignado_a`) o dejarse "disponible para cualquiera".
   - **Trazabilidad**: filtra `actividad_log` por `entidad='autorizacion'` — sin tabla nueva (decisión
     A3). Acción `'reasignar'` nueva en `AccionLog`.
   - **KPIs**: mini-dashboard — pendientes ahora + aprobadas/rechazadas por persona (últimos 30 días).
2. **Página agregada `/supervision`** (cross-módulo) + nav item con badge — "¿qué tengo pendiente en
   TODO el negocio?" de un vistazo, sin entrar módulo por módulo. Reusa el mismo mecanismo de badge que
   ya usa Alertas. Gateado por `requiereSupervisarModulo` en `navVisibility.ts` (visible solo si el
   usuario puede supervisar al menos un módulo).

Capa de datos reusable: hook `useSupervisorAutorizaciones(modulo, selectExtra, autEstado)` (fetch +
`marcarAprobada`/`rechazar`/`reasignar` genéricos) y componente `SupervisionPanel` (las 4 sub-secciones,
recibe el contenido de Aprobaciones como `children` porque eso sí es específico de cada módulo).

## Retrofit de Inventario (decisión D1)

El tab "Autorizaciones" ya existente se migró al patrón nuevo sin duplicar UI: mismo componente de
lista para Aprobaciones (sin cambios de lógica), pero ahora dentro de `SupervisionPanel` con las 3
sub-secciones nuevas al lado. La RPC `aprobar_cambio_estado_inventario` (REGLA #0, guard anti-fraude
server-side del cambio de estado con foto) se redefinió (mismo nombre, misma lógica) para apuntar a la
tabla renombrada — verificada end-to-end con un usuario real impersonado antes de deployar.

## Verificación

- **SQL real contra DEV**: `aprobar_cambio_estado_inventario` ejecutada con `SET request.jwt.claims`
  impersonando un DUEÑO real — el `estado_id` de la línea cambió de verdad, la autorización quedó
  `aprobada`, cleanup sin residuo.
- **Navegador real** (Playwright ad-hoc contra `localhost:5173`, storageState de usuarios reales): tab
  Supervisión + 4 sub-tabs, badge cross-módulo, reasignación real (con revert), página `/supervision`
  agregada, gating de permisos (CAJERO no ve el nav item nuevo). Encontró y corrigió un bug propio:
  `permisos_custom` NO es una columna de `users` — se resuelve vía `rol_custom_id → roles_custom.permisos`
  (mismo join que ya hace `authStore.ts` al cargar la sesión), no una columna directa.
- **Bundle real de PROD** verificado por `curl` (no solo `list_deployments`): el chunk de Inventario
  contiene el texto "Supervisión" y la queryKey `usuarios-supervisa`.

## Pendiente real

Ningún otro módulo usa el patrón todavía — Pedidos/WMS sigue con su propia UI de asignación de tareas
(`wms_tareas.usuario_asignado_id`, construida en v1.161.0/v1.162.0), un concepto distinto (tareas
operativas, no solicitudes de aprobación) que no se unificó a propósito en esta tanda (fuera del
alcance de D1, que solo pedía retrofitear Inventario).

**Próximo paso de la secuencia hacia Repositores**: con este relevamiento cerrado (3 de 4), el
siguiente es diseñar y construir el módulo Repositores en sí — ver
`relevamiento_repositores_respuestas.md`.
