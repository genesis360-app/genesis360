---
title: Supervisión — Patrón "Pestaña de Supervisor" reusable
category: features
tags: [supervision, autorizaciones, permisos, aprobaciones, reasignar, trazabilidad, repositores, paginacion]
sources: [migration 347, migration 348, migration 386, migration 388, migration 389, relevamiento_supervisor_tab_respuestas.md, relevamiento-supervision-retrofit-reglas-negocio.html, src/components/SupervisionPanel.tsx, src/hooks/useSupervisorAutorizaciones.ts, src/pages/SupervisionPage.tsx, src/pages/ClientesPage.tsx, src/pages/EnviosPage.tsx, src/pages/ProveedoresPage.tsx, src/pages/PedidosPage.tsx, src/pages/RrhhPage.tsx, src/pages/ProductosPage.tsx, src/pages/InventarioPage.tsx, src/pages/UsuariosPage.tsx, src/pages/GastosPage.tsx, src/components/layout/AppLayout.tsx, src/components/AvisarSupervisorButton.tsx, src/components/SolicitarAutorizacionGastoModal.tsx, src/components/BandejaAutorizacionesGasto.tsx]
updated: 2026-09-01
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

1. **Tab "Supervisión" dentro de cada módulo** (contextual) — originalmente solo Inventario (reemplazó al
   tab "Autorizaciones"); **desde 2026-08-31/2026-09-01 también Clientes/Envíos/Proveedores/Pedidos/RRHH/
   Productos** (ver "Retrofit a más módulos" más abajo para el detalle de cada uno), con 4 sub-secciones:
   - **Aprobaciones**: la lista de siempre (aprobar/rechazar), contenido específico de cada módulo — en
     Inventario cubre `ajuste_cantidad`, `eliminar_serie`, `eliminar_lpn`, `bulk_edit`, `ajuste_conteo`,
     `cambio_estado` (`kit_precio`/`repricing_margen` vivieron acá hasta el 2026-09-01, mig 388 — ver
     "Retrofit a más módulos" → "Productos (A4)" — ahora viven en `modulo='productos'`).
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

## Retrofit a más módulos — relevamiento de Fede (2026-08-20) ✅ TODO CONSTRUIDO, INCLUIDO A1, 🚀 EN PROD desde v1.195.0 (2026-09-01, PR #335) (Nivel 1 completo + A4 + C1 + A1, v1.189.0-v1.194.0) — solo queda diferido Nivel 2 (sin delegar, a propósito)

> Relevamiento `relevamiento-supervision-retrofit-reglas-negocio.html` (raíz del repo), generado
> 2026-08-20 sobre código real (`SupervisionPage.tsx` con `MODULOS=['inventario']` solamente, el CHECK de
> `autorizaciones.modulo` acotado a `'inventario'` en la mig 347, los 2 sistemas paralelos de Gastos —
> `autorizaciones_gasto`/`autorizaciones_cc`—, la "clave maestra" síncrona de Ventas/Caja). **Respondido
> por Fede el mismo día, 100% CERRADO** — continuación directa de
> `relevamiento_supervisor_tab_respuestas.md` (esa ya había cerrado "sí, construir el patrón"; esta
> responde "a qué módulos y con qué alcance").
>
> **Decisiones cerradas:**
> - **Ventas**: solo "anular venta despachada" pasa a cola de aprobación de Supervisión — con una regla
>   nueva: si la venta ya fue facturada, primero hay que emitir NC antes de poder eliminarla. **✅
>   CONSTRUIDO 2026-09-01 (sin migración nueva, `v1.194.0`) — ver sección "Ventas (A1)" más abajo y
>   [[wiki/features/ventas-pos]] § VF6.**
> - **Caja**: sigue con clave maestra síncrona, **nunca** pasa a cola de aprobación asincrónica.
> - **Productos**: `kit_precio`/`repricing_margen` (vivían en el tab de Inventario) se reclasifican a
>   `modulo='productos'`. **✅ CONSTRUIDO 2026-09-01 (mig 388, v1.192.0) — ver sección dedicada abajo.**
> - **Clientes / Envíos / Proveedores / Pedidos / RRHH**: 2 niveles de sensibilidad — eliminaciones
>   delegables a supervisores vía el patrón (Nivel 1, **✅ los 5 CONSTRUIDOS**, ver secciones abajo), y un
>   puñado de acciones más sensibles que quedan solo-Dueño sin pasar por cola (Nivel 2, **diferido, sin
>   arrancar**).
>
> **Bloqueante técnico común**: `productos`, `envios`, `proveedores`, `pedidos` y `rrhh` (el relevamiento
> original de esta fecha lo escribía como "`recursos`" — **resuelto el 2026-08-31, ver sección RRHH abajo:
> era una falsa ambigüedad, el código siempre usó `'rrhh'` consistentemente, `'recursos'` es una tabla
> distinta de flota/vehículos**) no están hoy en la lista `MODULOS` de `UsuariosPage.tsx` (la pantalla de
> permisos por rol) — hay que sumarlos ahí antes de poder delegar cualquier acción de esos módulos. **✅
> 2026-08-31 (mig 386, APLICADA Y VERIFICADA EN DEV,
> commit `deef2fc2`, `v1.188.0`): el CHECK `autorizaciones.modulo` (antes fijo a `'inventario'`) ya admite
> `productos/ventas/clientes/envios/proveedores/pedidos/rrhh`**, y se eliminó el CHECK rígido de `tipo` (se
> valida en la app) — prerequisito técnico de SCHEMA despejado. `migration-reviewer`: APTA (2ª pasada, la
> 1ª de la migración hermana 387 —Portal de Proveedores, no relacionada con esta tabla— encontró 4
> hallazgos bloqueantes reales, corregidos). **🔁 Corrección (2026-09-01)**: esto NO alcanzaba para
> resolver el bloqueante completo — la mig 386 solo amplió el CHECK de la DB, pero la lista `MODULOS` de
> `UsuariosPage.tsx` (la UI de permisos por rol, el bloqueante literal descripto arriba) **siguió sin
> `productos`/`envios`/`proveedores`/`pedidos` hasta el 2026-09-01 (v1.192.0)** — un gap real que sobrevivió
> sin detectarse durante toda la construcción de Envíos/Proveedores/Pedidos/RRHH (ver sección A4 abajo,
> "2 gaps reales"). **✅ C1 (migrar `autorizaciones_gasto` a esta tabla genérica) también CONSTRUIDO —
> ver sección "Gastos (C1)" más abajo (2026-09-01, `v1.193.0`), cierra TODO el relevamiento.**
>
> ### ✅ Clientes — PRIMER módulo real retrofiteado (2026-08-31, commit `27d740e8`, `v1.189.0`)
>
> Decisión A5 Nivel 1 de la tabla de arriba ("eliminaciones delegables a supervisores vía el patrón")
> construida de punta a punta para Clientes — **es la PRIMERA vez que un segundo módulo consume el patrón
> genérico** además de Inventario, sin migración nueva (usa el CHECK ya ampliado por la mig 386). Sirve de
> **plantilla real** para retrofitear Envíos/Proveedores/Pedidos/RRHH (mismo nivel de sensibilidad) más
> adelante.
>
> **Qué cambia**: la baja de cliente (soft-delete, `activo=false`, ya existía como feature) ya NO se ejecuta
> directo — `confirmarBaja()` en `ClientesPage.tsx` ahora hace un `INSERT` en `autorizaciones`
> (`modulo='clientes'`, `tipo='eliminar'`, `datos_cambio: {cliente_id, cliente_nombre, motivo}`,
> `estado='pendiente'`) + `avisarSupervisor(...)`, en vez de tocar `clientes` directo. Cualquiera con
> permiso `supervisa` en Clientes (DUEÑO/SUPER_USUARIO/ADMIN siempre; SUPERVISOR por herencia; rol custom
> con `'supervisa'` explícito vía `puedeSupervisarModulo(user, 'clientes')`) ve un tab nuevo
> **"Autorizaciones"** en `ClientesPage.tsx` (mismo componente `SupervisionPanel` que usa Inventario,
> badge de pendientes vía `useSupervisionBadge`). Al aprobar, recién ahí se ejecuta el `UPDATE` real
> (`activo=false`, `motivo_baja`, `baja_at`, `baja_por`) y se llama `marcarAprobada()`.
>
> **Patrón reusable para los próximos módulos** (usado tal cual para Envíos/Proveedores/Pedidos, ver abajo):
> (1) en el flujo que hoy ejecuta la acción sensible directo, reemplazarlo por un `INSERT` en
> `autorizaciones` con `modulo='<módulo>'`, `tipo='eliminar'` (o el que corresponda) y `datos_cambio` con
> lo mínimo necesario para reconstruir la acción al aprobar; (2) sumar un tab "Autorizaciones" gateado por
> `puedeSupervisarModulo(user, '<módulo>')`, reusando `useSupervisorAutorizaciones('<módulo>', selectExtra,
> autEstado)` + `<SupervisionPanel>`; (3) la función de aprobación ejecuta la acción real diferida y llama
> `marcarAprobada`; (4) sumar `'<módulo>'` a la lista `MODULOS` de `UsuariosPage.tsx` si ese módulo no
> estaba ahí todavía.
>
> **2 bugs REALES encontrados y corregidos al verificar end-to-end contra DEV** (no solo "el test pasó" —
> beneficia a los módulos futuros que reusen el mismo hook):
> 1. `src/hooks/useSupervisorAutorizaciones.ts`: el `.select()` de PostgREST interpolaba `selectExtra` sin
>    filtrar — con `selectExtra=''` (caso de Clientes, que no necesita ningún join extra) quedaba una coma
>    doble inválida (`"*, , solicitante:..."`) que PostgREST rechazaba, y el error quedaba **silenciado**
>    por el fallback `data ?? []` (la UI mostraba "no hay solicitudes pendientes" en vez de un error real).
>    Fix genérico: `['*', selectExtra, ...].filter(Boolean).join(', ')` — no-op matemático para cualquier
>    `selectExtra` no vacío (sin regresión en Inventario). De paso se expone `isError` del hook.
> 2. `ClientesPage.tsx`: `confirmarBaja` invalidaba `['supervision-badge']` pero no
>    `['autorizaciones','clientes']` — la lista del tab Autorizaciones seguía sirviendo caché de ANTES de
>    crear la solicitud hasta el próximo refetch espontáneo.
>
> **Verificación real**: Playwright contra DEV real (no mockeado) — crear cliente → dar de baja (confirmado
> por SQL directo: sigue `activo=true`, aparece la fila `pendiente`) → aprobar desde el tab → confirmado por
> SQL directo: `estado='aprobada'`, `activo=false`. Test permanente en `tests/e2e/08_clientes.spec.ts`.
> Suite de regresión de Inventario (7 specs de autorizaciones) sin regresión.
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`).
>
> ### ✅ Envíos + Proveedores + Pedidos — resto de Nivel 1 completado (2026-08-31, commit `452f3c93`, `v1.190.0`)
>
> Mismo patrón exacto de Clientes (arriba), replicado a los 3 módulos restantes que el relevamiento
> clasificó "delegable a cualquiera con `supervisa`, modelo genérico estándar" (Nivel 1) — **con esto los 4
> módulos de Nivel 1 (Clientes+Envíos+Proveedores+Pedidos) quedan 100% CERRADOS**. Sin migración nueva (usa
> el mismo CHECK de la mig 386).
>
> - **Envíos**: "Eliminar envío" (**hard delete real**, a diferencia del soft-delete de Clientes) pasa por
>   cola de aprobación. Tab "Autorizaciones" nuevo en `EnviosPage.tsx`. Ver [[wiki/features/envios]] →
>   "Pestañas".
> - **Proveedores**: "Eliminar proveedor/servicio" (hard delete, misma tabla `proveedores` para ambos
>   tipos) ídem. `deleteProveedor.mutate` cambió de firma `id` → `{id, nombre}` (necesita el nombre para el
>   snapshot en `datos_cambio`, mismo criterio que `cliente_nombre` en Clientes). Ver
>   [[wiki/features/clientes-proveedores]] → "Módulo Proveedores" → "Tabs".
> - **Pedidos**: "Cancelar pedido" pasa por cola de aprobación. **Importante**: la lógica real de negocio
>   (liberar reservas de stock, solo si nada se pickeó todavía) sigue viviendo 100% en el RPC
>   `fn_cancelar_pedido` ya existente, sin tocar — la aprobación solo difiere CUÁNDO se llama, nunca
>   reimplementa lógica de stock (REGLA #0). El tab bar de Pedidos (antes gateado solo por `modoAvanzado`)
>   ahora también aparece en modo básico si el usuario puede supervisar Pedidos — Supervisión no es una
>   feature exclusiva de WMS. Ver [[wiki/features/pedidos]].
>
> **Nivel de verificación — distinto al de Clientes, a propósito**: NO se agregó un test e2e de Playwright
> nuevo por cada uno de estos 3 módulos (Clientes sí tuvo verificación end-to-end completa con navegador
> real). Acá: build+typecheck+lint limpios en los 3 archivos, y los 3 `INSERT` a `autorizaciones` (uno por
> módulo) probados con **impersonación real de rol** (`SET LOCAL ROLE authenticated` + JWT claims del
> usuario de prueba) contra la DB real de DEV — confirma que el CHECK ampliado en la mig 386 y la RLS
> genérica aceptan los 3 módulos nuevos sin error. Justificación: el hook compartido y el patrón de
> invalidación de caché (los 2 bugs reales de arriba) ya quedaron probados y corregidos con Clientes — acá
> es un mirror exacto del mismo código ya validado, no lógica nueva.
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`).
>
> ### ✅ RRHH — 5to y ÚLTIMO módulo de Nivel 1, CIERRA el Nivel 1 completo (2026-08-31, commit `f337ca62`, `v1.191.0`)
>
> **🔁 Resuelve la ambigüedad de naming `'recursos'` vs `'rrhh'`** que había quedado anotada como pendiente
> (ver versión anterior de esta sección, y la memoria `project_supervision_tab_extension_pendiente`):
> investigado a fondo, `permisosModulo.ts` (`SUPERVISOR_MODULOS_PROHIBIDOS`) y `UsuariosPage.tsx`
> (`MODULOS`) ya usan `'rrhh'` **consistentemente en todos lados** — no había ningún lugar usando
> `'recursos'` para este módulo. `'recursos'` resultó ser una tabla completamente DISTINTA (flota/
> vehículos, usada en Gastos/Envíos, ver [[wiki/features/recursos]]) sin ninguna relación con RRHH. **La
> ambigüedad no era real** — no hizo falta ningún cambio de naming en el código.
>
> **Decisión de scope, importante — investigada ANTES de codear**: `RrhhPage.tsx` tiene **9 acciones de
> "eliminar" distintas** (empleados, puestos, departamentos, `salario_items`, `vacaciones_solicitud`,
> asistencia, feriados, documentos, capacitaciones). Se acotó el retrofit **solo a la baja de empleado**
> (soft-delete, `activo=false`) — es el único registro central de PERSONA, mismo criterio que "eliminar
> cliente". Las otras 8 son registros administrativos/de configuración, no lo que motiva la regla del
> relevamiento ("evita que un empleado que se va borre cosas [de otros]") — **quedan sin gatear a
> propósito**, no son un olvido.
>
> **Qué cambia**: la baja de empleado (modal de baja: motivo de egreso → `toggleEmpleadoActivo`,
> `activo=false`, ya existía como RH1) ya NO se ejecuta directo — mismo patrón que los 4 módulos
> anteriores: `INSERT` en `autorizaciones` (`modulo='rrhh'`, `tipo='eliminar'`), tab nuevo "Autorizaciones"
> en `RrhhPage.tsx`. Al aprobar, se reutiliza la mutación `toggleEmpleadoActivo` ya existente — nunca
> reimplementa la lógica de baja. **Reactivar un empleado sigue siendo directo** (activo:false→true no es
> una eliminación, el relevamiento no lo pide).
>
> **Con esto, TODOS los módulos de Nivel 1 del relevamiento quedan construidos: Clientes (v1.189.0), Envíos
> + Proveedores + Pedidos (v1.190.0), RRHH (v1.191.0) — Nivel 1 100% CERRADO.**
>
> **Verificación**: mismo nivel que Envíos/Proveedores/Pedidos — build/typecheck/lint limpios, `INSERT` a
> `autorizaciones` probado con impersonación real de rol contra DEV (confirma el CHECK ampliado en la mig
> 386 + RLS genérica); sin test e2e nuevo de Playwright (mirror del patrón ya probado con Clientes).
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`).
>
> ### ✅ Productos (A4) — CIERRA el relevamiento ENTERO de Supervisión (2026-09-01, commit `0e2bb29d`, `v1.192.0`)
>
> Último ítem pendiente del relevamiento completo. `kit_precio` (Motor de Rotación, `InventarioPage.tsx`) y
> `repricing_margen` (D3, sweep automático `fn_evaluar_repricing_margen`, mig 346) estaban mal clasificados
> en `modulo='inventario'` pese a ser cambios de PRECIO de producto, no de inventario.
>
> **Qué cambia**: migración **388** (`migration-reviewer`: APTA — diff línea por línea de
> `fn_evaluar_repricing_margen` contra la función original confirmado, sin efectos colaterales de
> triggers) reclasifica las filas EXISTENTES (`UPDATE autorizaciones SET modulo='productos' WHERE
> modulo='inventario' AND tipo IN ('kit_precio','repricing_margen')`) — **2 pendientes REALES en DEV** (no
> datos de prueba) más 6 aprobadas históricas — y actualiza `fn_evaluar_repricing_margen` para insertar ahí
> en vez de en `'inventario'` (mismo cuerpo, solo cambia el `modulo` del `INSERT` y la `action_url` de la
> notificación, de `/inventario` a `/productos`). Se sacó la lógica de aprobación/render de estos 2 tipos
> de `InventarioPage.tsx` (nunca más van a matchear `modulo==='inventario'`; `aplicarPrecioSugeridoKit`
> ahora inserta con `modulo:'productos'`) y se agregó una tab "Autorizaciones" nueva en `ProductosPage.tsx`
> con el mismo hook genérico `useSupervisorAutorizaciones`.
>
> **🐛 2 gaps REALES encontrados y corregidos, de la propia sesión anterior (Envíos/Proveedores/Pedidos,
> v1.190.0)** — afectaban a los módulos YA construidos, no solo a Productos:
> 1. `UsuariosPage.tsx` (la lista `MODULOS` de módulos asignables a roles custom en la pantalla de
>    permisos) nunca tenía `'productos'`, `'envios'`, `'proveedores'` ni `'pedidos'` — un tenant con roles
>    custom **JAMÁS podía otorgar el permiso `supervisa`** en esos módulos (solo funcionaba para DUEÑO/
>    SUPER_USUARIO/ADMIN, y donde no está prohibido, SUPERVISOR). Agregados los 4 (`'clientes'` y `'rrhh'`
>    ya estaban en la lista de antes).
> 2. El badge de navegación global "Supervisión" (`AppLayout.tsx`, `MODULOS_SUPERVISION`) y la vista
>    agregada cross-módulo (`SupervisionPage.tsx`, constante `MODULOS`) seguían hardcodeados a
>    `['inventario']` — **nunca se habían actualizado al construir Clientes/Envíos/Proveedores/Pedidos/
>    RRHH**. El badge del nav y la página `/supervision` **nunca mostraron nada de esos 5 módulos hasta
>    ahora**, pese a que sus tabs "Autorizaciones" individuales sí funcionaban. Agregados los 6 módulos
>    nuevos (incluido `productos`) en ambos lugares — `SupervisionPage.tsx` también ganó una ruta
>    `/productos?tab=autorizaciones` en su tabla de módulos y el label genérico `'eliminar': 'Eliminar'`
>    para los tipos de Nivel 1 (antes solo tenía labels de `kit_precio`/`repricing_margen`/`eliminar_lpn`).
>
> **Verificación end-to-end real** con Playwright contra DEV (spec 133, ya existente de antes, actualizado
> para navegar a Productos en vez de Inventario y ajustar el texto del toast): crear KIT → DEPOSITO pide
> cambio de precio → pendiente en `modulo='productos'` (confirmado por REST) → DUEÑO aprueba desde
> Productos→Autorizaciones → `precio_venta` actualizado + autorización `aprobada` (confirmado por REST).
> Suite de regresión de autorizaciones de Inventario (5 specs) sin regresión. `schema_full.sql` parcheado a
> mano (solo cambió 1 función, no ameritó regeneración completa).
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`, mig 388).
>
> ### ✅ Gastos (C1) — ÚLTIMA pieza, cierra TODO el relevamiento de Supervisión (2026-09-01, commit `2c4470c1`, `v1.193.0`)
>
> `autorizaciones_gasto` (tabla separada, propia de Gastos desde v1.8.43, **0 filas reales en DEV —
> confirmado dos veces con queries directas antes del `DROP TABLE`**) se elimina. Gastos ahora usa la
> tabla genérica `autorizaciones` (`modulo='gastos'`, ya admitido por el CHECK — se amplía una vez más
> para incluir `'gastos'`), consolidando TODAS las colas de aprobación del proyecto en un solo lugar.
>
> **Pero Gastos NO se migró al patrón genérico completo** (`useSupervisorAutorizaciones`/
> `SupervisionPanel`, el que sí usan los otros 7 módulos) — a propósito: Gastos tiene su PROPIO modelo de
> **jerarquía de ROL** (CAJERO→SUPERVISOR/DUEÑO/ADMIN; SUPERVISOR→DUEÑO/ADMIN, función `puedeAprobar()` en
> `umbralGasto.ts`), completamente distinto del permiso `supervisa` fijo que asume ese hook. Se conservan
> los componentes propios de Gastos (`SolicitarAutorizacionGastoModal.tsx`,
> `BandejaAutorizacionesGasto.tsx`, con su tab "Autorizaciones" ya existente) — **solo cambia la tabla
> destino**. Los campos específicos (`monto`, `descripcion`, `payload`, `sucursal_id`, `gasto_id`,
> `solicitante_rol`) pasan a `datos_cambio` jsonb (mismo criterio que Clientes/Envíos/Proveedores/Pedidos/
> RRHH); `motivo`→`notas` y `motivo_rechazo` se reusan tal cual (ya eran columnas de la tabla genérica).
> Detalle completo de columnas y flujo: [[wiki/features/gastos]] → "Umbrales y Autorizaciones".
>
> **🐛 Hallazgo real de esta sesión (documentado, NO un bug arreglado — es una decisión de producto
> existente, no de código, descubierta al escribir el test)**: `/gastos` **NO está en `CAJERO_ALLOWED`**
> (`AppLayout.tsx`) — un CAJERO real que navega ahí es redirigido a `/ventas` antes de poder cargar nada.
> Esto significa que **TODO el código de `esCajero`/umbral-para-CAJERO en `GastosPage.tsx`** (filtrado de
> "mis gastos", chequeo de `umbral_gasto_cajero`) **es HOY código muerto en producción** — nunca se
> ejecuta porque CAJERO nunca llega a esa página. No se cambió (es una decisión de acceso existente, no
> algo a decidir sin más) — la verificación usó SUPERVISOR→DUEÑO en su lugar, que sí es un camino real y
> ejercita exactamente el mismo código migrado.
>
> **Verificación**: Playwright real contra DEV (spec 136 nuevo) — solicitud sembrada con el TOKEN REAL de
> SUPERVISOR (mismo shape exacto que inserta el modal real, pasando por RLS real, no simulado) →
> confirmado que el gasto NO existe todavía → DUEÑO aprueba desde Gastos→Autorizaciones con un click real
> en la UI → gasto creado de verdad + autorización queda aprobada con `datos_cambio.gasto_id` apuntando al
> gasto real. La migración pasó por `migration-reviewer` **dos rondas** (la 1ª pidió `IF EXISTS` en el
> `DROP` y confirmación independiente del conteo de 0 filas antes de aplicar — ambos resueltos, APTA en la
> 2ª). Suite de regresión de Gastos (3 specs: efectivo/caja, cheque/rechazo, comprobante obligatorio) sin
> regresión.
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`, mig 389).
>
> Con esto quedaba construido todo salvo Ventas (A1) — ver sección siguiente, que lo cierra.
>
> Detalle completo: `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ", cont. 39),
> [[project_supervision_tab_extension_pendiente]] (memoria), [[wiki/features/gastos]].
>
> ### ✅ Ventas (A1) — ÚLTIMA pieza real, cierra TODO el relevamiento de Supervisión de verdad (2026-09-01, `v1.194.0`)
>
> Continuación directa de la sesión de Gastos/C1 (arriba) — quedaba solo A1, la única pieza "sin diseñar
> todavía" del relevamiento. Se investigó el código real ANTES de diseñar nada (REGLA #0): hoy existían
> **2 mecanismos separados** que ya hacían todo lo que A1 necesitaba, para casos distintos —
> `cambiarEstado→'cancelada'` (venta sin CAE: reincorpora stock + revierte caja, automático) y "Devolver"
> con devolución completa (venta con CAE: reincorpora stock + revierte caja + **emite la NC automática ya
> existente, A10** — pero el reembolso lo elige un humano en un modal). El botón "Anular" viejo ni se
> ofrecía si había CAE (mandaba a usar "Devolver" a mano).
>
> **Decisión de diseño confirmada con GO** (única pregunta real abierta: quién elige el medio de reembolso
> de una venta facturada al aprobar la anulación): el supervisor lo elige al aprobar, abriendo "Devolver"
> ya precargada — nunca se automatiza un reembolso fiscal sin intervención humana.
>
> **Qué se construyó** (sin migración nueva — `autorizaciones.modulo` ya incluía `'ventas'` desde la mig
> 386, que además ya anticipaba el `tipo='eliminar_venta_despachada'` en su propio comentario):
> "Solicitar anulación" (tab "Autorizaciones" nuevo en `VentasPage`, mismo patrón genérico que los otros 7
> módulos) reemplaza al botón "Anular" con clave maestra. Al **aprobar**, dos ramas según el estado FRESCO
> de la venta (nunca el de cuando se pidió): **sin CAE** → mismo `cambiarEstado→'cancelada'` de siempre,
> directo; **con CAE** → abre "Devolver" precargada a devolución TOTAL (`abrirModalDevolucion(venta,
> {anulacionTotal:true})`, 2º parámetro opcional nuevo, sin tocar los 2 call-sites existentes) — el
> supervisor elige el reembolso, y al confirmar la NC automática (A10) sale sola. La autorización queda
> `aprobada` recién cuando la devolución cierra al 100%, nunca antes.
>
> **Verificación**: Playwright real contra DEV (spec 137, 2 escenarios, ambos con datos propios —
> producto/venta creados por el propio test, verificados por REST en cada paso, no solo por el toast). Sin
> CAE: stock restaurado exacto + caja revertida por el monto exacto cobrado. Con CAE (**sintético — sin
> llamar a AFIP real**, mismo criterio defensivo que el spec 22 ya usa para el "happy path monetario" de
> devoluciones): confirmado que la solicitud ahora SÍ se ofrece (antes bloqueaba del todo), que "Cambiar
> cliente" sigue oculto, que la precarga es total (cantidad = máximo, total = el de la venta), y que
> cancelar sin confirmar deja la autorización `pendiente` y la venta sin cambios. Suite de regresión de
> Ventas (04, 19_flujo_venta, 22_devolución) sin regresión — corridas en paralelo con este spec nuevo
> mostraron fallas cruzadas por la conocida no-determinismo de la suite compartiendo el tenant DEV (ver
> [[reference_e2e_suite_no_deterministica]]), pero cada spec en AISLAMIENTO pasó 100% limpio.
>
> **🚀 DEPLOYADO A PROD el 2026-09-01** (PR #335, `v1.195.0`).
>
> **✅✅✅ Con esto, TODO el relevamiento de Supervisión de Fede queda construido de verdad: Nivel 1
> completo (Clientes+Envíos+Proveedores+Pedidos+RRHH) + A4 (Productos) + C1 (Gastos) + A1 (Ventas).** Ya no
> queda NADA del relevamiento en sí sin construir. Lo único que sigue pendiente es aparte, explícitamente
> diferido desde el origen (no es "trabajo que falta", es la decisión de diseño final):
> - **Nivel 2** (sin delegar, solo Dueño, fuera del modelo genérico — mismo criterio que
>   `autorizaciones_cc`): Clientes→modificar límite de CC/habilitar CC/perdonar deuda; RRHH→cambio de
>   sueldo/aprobación de licencias con goce de sueldo. **Ya funcionan con clave maestra síncrona — no
>   necesitan cola, no es trabajo pendiente de construir.**
> - **Caja** — decisión cerrada, sigue con clave maestra síncrona para siempre, nunca pasa a cola.
>
> Detalle completo: `G360.Wiki/log.md` (2026-09-01), [[wiki/features/ventas-pos]] § VF6,
> [[project_nc_afip_automatica]] (A10, reusada sin cambios), [[tests/specs/uat-modo-basico]] VEN-24/VEN-49.

## Pendiente real

**✅✅✅ 2026-09-01: TODO el relevamiento de Supervisión de Fede queda construido, sin excepción** —
Clientes (v1.189.0), Envíos/Proveedores/Pedidos (v1.190.0), RRHH (v1.191.0), Productos/A4 (v1.192.0),
Gastos/C1 (v1.193.0) y Ventas/A1 (v1.194.0) ya usan la tabla genérica `autorizaciones` (ver "Retrofit a
más módulos" arriba) — **Nivel 1 completo (5 módulos) + A4 + C1 + A1**, además de Inventario. Gastos es un
caso especial a propósito: usa la tabla genérica pero NO el hook/componente genérico
(`useSupervisorAutorizaciones`/`SupervisionPanel`), porque su modelo es jerarquía de rol relativa, no el
permiso `supervisa` fijo — conserva sus componentes propios. De paso se corrigieron 2 gaps reales que
habían sobrevivido desde Envíos/Proveedores/Pedidos: `UsuariosPage.tsx` sin esos 4 módulos en la lista de
roles custom, y el badge de nav + `/supervision` sin actualizar a los 5 módulos de Nivel 1. La ambigüedad
de naming `'recursos'` vs `'rrhh'` quedó **resuelta** (no era real — `'recursos'` es una tabla de
flota/vehículos sin relación). También se documentó un hallazgo real (no un bug corregido): `/gastos` no
está en `CAJERO_ALLOWED`, así que la rama CAJERO de la jerarquía de Gastos es código muerto hoy. **Ya no
queda NADA del relevamiento en sí sin construir** — solo diferido desde el origen, a propósito: **Nivel 2**
(sin delegar, solo Dueño — ya funciona con clave maestra, no necesita cola). Repositores
reusó el mismo diseño de reparto/reasignación sin integrarse a la tabla `autorizaciones` en sí (ver abajo) —
Pedidos/WMS sigue con su propia UI de asignación de tareas (`wms_tareas.usuario_asignado_id`, construida en
v1.161.0/v1.162.0), un concepto distinto (tareas operativas, no solicitudes de aprobación) que no se
unificó a propósito en esa tanda (fuera del alcance de D1, que solo pedía retrofitear Inventario).

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
