---
title: Supervisión — Patrón "Pestaña de Supervisor" reusable
category: features
tags: [supervision, autorizaciones, permisos, aprobaciones, reasignar, trazabilidad, repositores, paginacion]
sources: [migration 347, migration 348, relevamiento_supervisor_tab_respuestas.md, src/components/SupervisionPanel.tsx, src/hooks/useSupervisorAutorizaciones.ts, src/pages/SupervisionPage.tsx, src/components/AvisarSupervisorButton.tsx]
updated: 2026-08-13
---

# Supervisión — Patrón "Pestaña de Supervisor" reusable

✅ **100% COMPLETO Y EN PROD desde v1.164.0 (2026-08-11, migs 347+348).** 2º de 4 relevamientos
derivados hacia el módulo Repositores (backlog Comercial de Fede, Fase E) — ver
[[project_backlog_fede_comercial_25_7]] y `relevamiento_supervisor_tab_respuestas.md` para las
decisiones de negocio completas. v1.163.0 dejó construido el núcleo (A1/A3/B1/C2/D1/E1/E2); v1.164.0
cerró las 2 piezas que habían quedado pendientes de esa primera pasada (F1 y A2 — ver abajo).

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

## F1 — "Avisar al supervisor" (v1.164.0)

Requisito confirmado en el relevamiento ("se construye genérico desde el día uno, cualquier módulo
puede usar el botón") que había quedado sin construir en la primera pasada — GO lo marcó como gap real
al pedir verificación exhaustiva. `avisarSupervisor(tenantId, modulo, remitenteId, titulo, mensaje,
actionUrl)` en `useSupervisorAutorizaciones.ts`: notifica (tabla `notificaciones`, tipo
`aviso_supervisor`) a TODOS los que `puedeSupervisarModulo` en ese módulo, excepto quien avisa.
Componente reusable `AvisarSupervisorButton` (nota opcional vía `usePrompt()`) wireado en
`LpnAccionesModal.tsx` (header del detalle de LPN) — el mensaje ya trae identificado LPN/producto/
ubicación, igual que pedía el relevamiento original de Repositores (C1). Verificado end-to-end en el
navegador contra DEV real: 4 supervisores notificados correctamente.

## A2 — Auto-asignación por reglas o carga (v1.164.0, mig 348)

Requisito de negocio cerrado en el relevamiento ("asignación automática por prioridad como default" +
"reglas predefinidas de enrutamiento") cuya implementación concreta se dejó a propósito para la etapa
de diseño técnico — definida recién con GO el 2026-08-11:

1. **Regla de enrutamiento explícita** (tabla nueva `autorizaciones_reglas_enrutamiento`: tenant+modulo
   +tipo → usuario fijo, `UNIQUE(tenant_id, modulo, tipo)`) — configurable en Config → Inventario →
   Zonas y picking → card "Reglas de asignación — Supervisión".
2. **Si no hay regla, reparto por CARGA**: se asigna a quien, entre los elegibles
   (`fn_usuarios_supervisan_modulo`, espejo SQL de `puedeSupervisarModulo`), tenga MENOS pendientes
   asignadas ahora mismo en ese módulo — empate desempatado al azar (no siempre el mismo UUID).

Trigger `trg_autorizaciones_auto_asignar` (`BEFORE INSERT ON autorizaciones`) — corre para CUALQUIER
INSERT a la tabla, sin importar si lo hace un usuario real o `fn_evaluar_repricing_margen` con
`service_role`. RLS de la tabla de reglas: SELECT tenant-wide (necesario para que el trigger, que corre
`SECURITY INVOKER`, pueda leer la regla bajo el rol de CUALQUIER usuario que cree una autorización, no
solo DUEÑO/ADMIN) + escritura (INSERT/UPDATE/DELETE) acotada a DUEÑO/ADMIN.

**`migration-reviewer` en 2 rondas**: la primera encontró 2 bloqueantes de idempotencia (falta
`IF NOT EXISTS` en la tabla y en la policy) + 5 mejoras (`ON DELETE CASCADE`, restricción de escritura
por rol, guard de tenant en `usuario_id`, `REVOKE FROM PUBLIC/anon`, desempate justo por `random()`
en vez de siempre el mismo UUID) — todas aplicadas antes de la segunda pasada, que confirmó "APTA".

**Gotcha real encontrado al verificar la RLS**: `execute_sql` conecta como `postgres` con
`rolbypassrls=true` — probar la restricción de escritura (DUEÑO/ADMIN) con ese canal siempre "pasa",
sin importar qué rol se simule en `request.jwt.claims`. Hubo que probarlo con un JWT real de un usuario
CAJERO (extraído de una sesión de navegador ya autenticada) vía `fetch()` directo a PostgREST — recién
ahí se confirmó el 403 real. Técnica a reusar cada vez que una migración nueva agregue una policy RLS
que restrinja por rol: `execute_sql`/`SET request.jwt.claims` alcanza para probar lógica de negocio
dentro de una función (`get_user_role()` explícito), pero NO para probar RLS en sí.

## Verificación

- **SQL real contra DEV**: `aprobar_cambio_estado_inventario` ejecutada con `SET request.jwt.claims`
  impersonando un DUEÑO real — el `estado_id` de la línea cambió de verdad, la autorización quedó
  `aprobada`, cleanup sin residuo.
- **Navegador real** (Playwright ad-hoc contra `localhost:5173`, storageState de usuarios reales): tab
  Supervisión + 4 sub-tabs, badge cross-módulo, reasignación real (con revert), página `/supervision`
  agregada, gating de permisos (CAJERO no ve el nav item nuevo). Encontró y corrigió un bug propio:
  `permisos_custom` NO es una columna de `users` — se resuelve vía `rol_custom_id → roles_custom.permisos`
  (mismo join que ya hace `authStore.ts` al cargar la sesión), no una columna directa.
- **Bundle real de PROD** verificado por `curl`/Vercel API (no solo que el deployment esté READY): en
  v1.163.0 el chunk de Inventario tenía "Supervisión" + `usuarios-supervisa`; en v1.164.0 se confirmó
  además `"Avisar al supervisor"` (x2) en el chunk de Inventario y `reglas_enrutamiento` +
  "Reglas de asignación — Supervisión" en el chunk de Config.
- **Ronda de verificación adicional (2026-08-11), a pedido explícito de GO ("verifica todo")**: rol
  SUPERVISOR (nav+tab visibles, navegador real) · flujo Rechazar en vivo (DB confirma
  estado/motivo_rechazo/aprobado_por, luego revertido) · rol custom con `supervisa` explícito — cubierto
  con tests unitarios dedicados en vez de un hack de sesión de navegador (más riguroso para lógica
  pura), que **encontraron y corrigieron un bug real**: el nav item "Supervisión" quedaba oculto para
  CAJERO/DEPOSITO/CONTADOR/RRHH aunque tuvieran `supervisa` vía rol custom, porque el allowlist de
  operador de `navVisibility.ts` corría ANTES de chequear `requiereSupervisarModulo` — corregido para
  que ese flag bypasee el allowlist de rol (se gobierna 100% por permiso real, no por rol).

## Paginación de Aprobaciones/Reasignar — footer estilo Historial (2026-08-12, ✅ EN PROD desde v1.169.0)

Mismo pedido de GO que en [[wiki/features/alertas]] ("agregá el footer 'Mostrando X de Y' que tiene
Historial"), pero acá SÍ encaja literal: a diferencia de Alertas (11 secciones chicas), la lista de
Aprobaciones/Reasignar de `useSupervisorAutorizaciones` **es una lista única homogénea** que puede
crecer sin límite con el uso — mismo caso que Historial.

- `useSupervisorAutorizaciones` ahora maneja `page`/`pageSize` (default 20, `AUT_PAGE_SIZES = [20, 50,
  75, 100]`) internamente, usa `.range()` + `{ count: 'exact' }` en la query (mismo mecanismo que
  Historial), y expone `totalCount` además del array de la página actual.
- Cambiar de tab (Pendientes/Aprobadas/Rechazadas) resetea `page` a 0 automáticamente (`useEffect`
  sobre `autEstado`) — si no, podías quedar en "página 3 de Pendientes" y saltar a Aprobadas con solo
  1 página, viendo un estado roto.
- El footer se renderiza dentro de `SupervisionPanel.tsx` (no en cada módulo que lo consume) — así
  cualquier módulo futuro que se sume al patrón lo hereda gratis. Se muestra tanto en la sub-pestaña
  **Aprobaciones** como en **Reasignar** (ambas iteran el mismo array ya paginado).
- Verificado en navegador real contra "Almacén Jorgito" (24 autorizaciones pendientes reales): footer
  mostró "Mostrar 20 [20] 50 75 100 · « ← 1/2 (24 en total) → »"; clickear "50" recalculó a "1/1 (24
  en total)" en vivo. Sin errores de consola.

**Estado real: ✅ EN PROD desde v1.169.0** (deploy real 2026-08-13, PR #329; construido y verificado en
DEV el 2026-08-12).

## Fix de bug real + rediseño de `/supervision` (2026-08-12, ronda 2 de feedback, ✅ EN PROD desde v1.169.0)

GO revisó en el navegador la paginación de arriba y encontró 2 problemas reales en `/supervision` (la
página agregada cross-módulo):

- **Bug: el link "Ver y resolver en Inventario" no aterrizaba donde decía.** Armaba la URL
  `/inventario?tab=autorizaciones`, pero `InventarioPage.tsx` **nunca leía ese query param** — el tab
  siempre arrancaba en `'inventario'` sin importar qué dijera la URL, así que el link terminaba en el
  tab equivocado. **Fix**: nuevo `useEffect` en `InventarioPage.tsx` que lee `?tab=` al montar y lo
  aplica (mismo patrón que ya existía para `?search=`).
- **Rediseño: desglose por tipo en vez de lista cruda de 5.** `SupervisionPage.tsx` mostraba una lista
  de 5 solicitudes pendientes al azar sin explicar por qué esas 5 ni qué eran las otras — GO: "no me
  agrega valor esa info que veo, solo sé que hay más por ver". Se reemplazó por un **desglose por
  tipo/categoría** (cuántas de "Ajuste de cantidad", "Cambio de estado", "Diferencia de conteo", etc.)
  reusando los mismos labels que ya usa `resumenDeAutorizacion` en `InventarioPage.tsx`, en vez de
  listar ítems individuales sin contexto.

Ver también [[wiki/features/alertas]] (sección "Deep-links específicos por sección") — mismo pedido de
GO de revisar que TODOS los links de la página lleven a donde dicen, aplicado a las 12 secciones de
AlertasPage.

**Verificación**: typecheck + build verdes. Verificado EN EL NAVEGADOR (Playwright ad-hoc) contra el
tenant real "Almacén Jorgito" en DEV. Sin errores de consola nuevos.

**Estado real: ✅ EN PROD desde v1.169.0** (deploy real 2026-08-13, PR #329; mismo commit que la
paginación de arriba).

## Pendiente real

Ningún otro módulo usa el patrón todavía — Pedidos/WMS sigue con su propia UI de asignación de tareas
(`wms_tareas.usuario_asignado_id`, construida en v1.161.0/v1.162.0), un concepto distinto (tareas
operativas, no solicitudes de aprobación) que no se unificó a propósito en esta tanda (fuera del
alcance de D1, que solo pedía retrofitear Inventario).

**Actualización 2026-08-11 — el módulo Repositores en sí ya se construyó (Fase 1, mig 352+353, y Fase
2, mig 354)**: el criterio de reparto por carga/reasignación de este patrón (`fn_autorizaciones_auto_asignar`/
`fn_regla_enrutamiento_valida_tenant`, mig 348) se reusó directo en `fn_repositor_elegir_asignado`/
`fn_tarea_repositor_asignado_valido_tenant` de la Fase 2 — no como una integración con `autorizaciones`
en sí (Repositores tiene su propia tabla `tareas_repositor`, no pasa por la Pestaña de Supervisor
genérica), sino como el mismo diseño aplicado a un módulo nuevo. Detalle completo en
[[wiki/features/repositores]]. **✅ Módulo Repositores 100% COMPLETO y EN PROD** — las 4 fases
operativas (núcleo, asignación/reasignación, reposición física, etiquetas+impresión) desde v1.168.0
(2026-08-12, PR #328) y Notificaciones (J) + Reportes (K) desde v1.169.0 (2026-08-13, PR #329) — ver
[[wiki/features/repositores]] para el estado actual. Ya no quedan puntos del relevamiento original sin
construir.
