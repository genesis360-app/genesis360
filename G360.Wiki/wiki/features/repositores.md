---
title: Módulo Repositores
category: features
tags: [repositores, precios, etiquetas, gondola, prioridad, roles-custom, modo-avanzado]
sources: [migration 352, migration 353, migration 354, migration 355, migration 356, migration 357, relevamiento_repositores_respuestas.md, project_backlog_fede_comercial_25_7.md, src/pages/RepositoresPage.tsx, src/pages/ProductoFormPage.tsx, src/pages/UsuariosPage.tsx, src/pages/ConfigPage.tsx, src/pages/PickingPage.tsx, src/pages/PedidosPage.tsx, src/components/layout/AppLayout.tsx, src/lib/actividadLog.ts, src/lib/etiquetasPreciosPDF.ts, src/lib/unidadMedidaFisica.ts]
updated: 2026-08-12
---

# Módulo Repositores

> ✅ **Módulo 100% COMPLETO Y EN PROD (v1.168.0, deploy real 2026-08-12, PR #328) — Fase 1 (núcleo +
> disparadores + prioridad, mig 352 + fix de seguridad mig 353), Fase 2 (asignación automática +
> reasignación manual, mig 354), Fase 3 (reposición física a góndola, mig 355 + fix de dedupe mig 356)
> y Fase 4 (etiquetas de precio + impresión, mig 357, ÚLTIMA fase) — las 4 fases fueron construidas y
> verificadas en DEV el 2026-08-11/12 y deployadas juntas a PROD el 2026-08-12, con autorización
> explícita de GO ("pasamos todo a PRD").** Deploy verificado de forma independiente: `gh pr view 328`
> → `MERGED` (`mergeCommit` `75ad544719467380368cbbcb783c4371d068a791`); `gh release view v1.168.0` →
> publicado sobre `main`; `list_migrations` contra PROD (`jjffnbrdjchquexdfgwq`) confirma el historial
> hasta `357_repositores_fase4_etiquetas`; bundle real de `https://genesis360.pro/` confirmado con la
> cadena "v1.168.0".
>
> 🔒🛑 **Bug de seguridad real encontrado y corregido en la Fase 1 (mig 353), mientras estuvo SOLO en
> DEV, nunca llegó a PROD**: `vw_tareas_repositor` había quedado creada sin `security_invoker` — ver
> "Fix de seguridad" más abajo.
>
> ⚠ **La Fase 3 corrige la resolución anterior de I3** (documentada abajo en "Lo que NO incluye la
> Fase 1" y en `relevamiento_repositores_respuestas.md`): no hacía falta un "tercer tramo separado" —
> el camino de reabastecimiento POR UMBRAL nunca tuvo el filtro de `tipo_logico` que sí tiene el
> picking automático. Ver "Qué hace la Fase 3" más abajo.

Módulo para que la persona que repone mercadería en el local sepa, sin tener que acordarse ni
recorrer la góndola, **qué cartel de precio hay que cambiar** — cada vez que un precio cambia o un
producto entra en un estado con descuento (ej. "Próximo a vencer -15%"), aparece sola una tarea.

Es la **Fase E** del backlog de reglas de negocio que mandó Fede el 25/7/2026 (ver
[[project_backlog_fede_comercial_25_7]] en memoria) — la última de 5 fases (F/A/B/C/D ya en PROD
desde antes). El relevamiento original tenía 35 preguntas en 12 secciones (A-L); quedó bloqueado
hasta cerrar 3 relevamientos derivados (Ubicaciones, Pestaña de Supervisor, Motor de Rotación — los 3
ya en PROD) y 3 decisiones de negocio (A1/A2-B3/H1, cerradas por GO el 2026-08-11). Con todo eso
resuelto, el módulo es grande de más para construir de una — se partió en **fases**, mismo criterio
que ya usó el backlog de Comercial (F→A→B→C→D):

- **Fase 1 (✅ construida)**: núcleo del módulo + disparadores automáticos + prioridad.
- **Fase 2 (✅ construida, mig 354)**: asignación automática por carga + reasignación manual vía el
  patrón de la Pestaña de Supervisor (ya existía como pieza genérica, ver
  [[wiki/features/supervision]]).
- **Fase 3 (✅ construida, mig 355+356)**: reposición física de stock a góndola — resuelve I3 (ver
  abajo), reusando el mecanismo real de movimiento de stock de WMS con un tipo de tarea nuevo
  (`reposicion_gondola`).
- **Fase 4 (esta, ✅ construida, mig 357, ÚLTIMA fase del módulo)**: etiquetas de precio + impresión
  (G/H del relevamiento) — PDF en grilla A4 con código de barras, imprimible también en una impresora
  térmica Zebra si el negocio tiene una (decisión de GO). Con esta fase el módulo Repositores queda
  **100% construido**. Notificaciones (J) y reportes (K) del relevamiento original quedan fuera del
  alcance de Repositores — no se retoman como parte de este módulo.

## Qué hace la Fase 1

Dos disparadores automáticos, **write-time vía trigger de DB** (nunca heurística de lectura — mismo
criterio que el resto del ledger de trazabilidad del proyecto, ver mig 155), que generan o actualizan
una tarea en la tabla `tareas_repositor`:

1. **Cambio de precio** — trigger `fn_generar_tarea_repositor_precio`, `AFTER UPDATE OF precio_venta
   ON productos`. Cubre TODOS los puntos de entrada existentes por ser un trigger de DB, no una
   llamada desde el frontend: edición individual (`ProductoFormPage.tsx`), importador CSV
   (`ImportarProductosPage.tsx`), y el repricing automático por margen (D3, mig 346/347) — este
   último no tiene ningún código de frontend, así que un hook a nivel de página nunca lo hubiera
   cubierto.
2. **Entrada a un estado con descuento** — trigger `fn_generar_tarea_repositor_estado`, `AFTER UPDATE
   OF estado_id ON inventario_lineas`, solo si `estados_inventario.descuento_pct > 0`. Cubre por
   igual el camino directo (`LpnAccionesModal.tsx`), la aprobación con foto (mig 331,
   `aprobar_cambio_estado_inventario`) y la edición MASIVA (`InventarioPage.tsx`
   `bulkCambiarEstado`) — **1 sola tarea por SKU** aunque se editen muchas líneas a la vez (B1 del
   relevamiento), gracias al dedupe.

**Ninguno de los dos dispara si**:
- El producto no tiene una ubicación de exhibición asignada en esa sucursal (ver abajo), o esa
  ubicación no es de tipo Góndola.
- El tenant no está en `modo_operacion = 'avanzado'`.

### Ubicación de exhibición — el gap que había que tapar primero

`producto_ubicacion_sucursal.ubicacion_exhibicion_id` existe desde la mig 335 (rediseño de
Ubicaciones, v1.157.0) — se agregó explícitamente como preparación para este módulo. Pero **nunca se
construyó ninguna UI para setearla** — sin eso, los triggers de la Fase 1 no iban a tener nada para
disparar nunca. Se agregó el campo **"Ubicación de exhibición (góndola)"** en `ProductoFormPage.tsx`
→ "Stock e inventario" (modo avanzado, por sucursal activa), mismo patrón que "Ubicación
predeterminada" que ya existía ahí — filtrado a ubicaciones con `tipo_logico = 'exhibicion'`. Sin
asignar esto para un producto, el módulo simplemente no genera tareas para él (no es un error, es el
comportamiento esperado — el producto puede no tener presencia en góndola, ej. si es Mostrador/
Depósito puro).

### Prioridad automática (C1-C3 del relevamiento, definida por Fede)

La lista de tareas se ordena así, siempre, sin que nadie la configure:

1. **Se vendió algo de ese producto en esa sucursal DESPUÉS de que nació la tarea** (el cartel sigue
   desactualizado y ya hubo una venta con el cliente viéndolo mal) — máxima prioridad. Riesgo real de
   reclamo.
2. **El precio NUEVO es más alto que el viejo** — cobrar de más es peor de cara a Defensa del
   Consumidor que cobrar de menos.
3. **Cercanía a vencimiento** (solo aplica a tareas `cambio_estado`, vía `inventario_lineas.
   fecha_vencimiento` de la línea que disparó la tarea).
4. **Más vieja primero** — desempate final por tiempo pendiente.

Esto se calcula en la vista `vw_tareas_repositor`, **en cada lectura, nunca cacheado** — el criterio
#1 en particular es explícitamente dinámico: si hoy la tarea no tiene ninguna venta posterior, pero
mañana sí, escala de prioridad sola sin que nadie la toque. Implementado con un `EXISTS`
correlacionado contra `venta_items`/`ventas` (índices existentes en `producto_id` y `sucursal_id`
la hacen razonablemente eficiente para el volumen que maneja el módulo).

### Dedupe — 1 tarea por SKU, no por evento

Un producto puede cambiar de precio o de estado varias veces mientras la tarea sigue pendiente (ej.
el repricing automático corre de nuevo antes de que alguien atienda el cartel). En vez de crear una
tarea nueva cada vez, se actualiza la existente — dedupe por `(producto_id, sucursal_id, tipo)`,
implementado con un `UNIQUE` índice parcial (`WHERE estado IN ('pendiente','en_curso')`) +
`INSERT ... ON CONFLICT ... DO UPDATE` en ambos triggers.

⚠️ **Nota de diseño**: la primera versión de este dedupe usaba el patrón `UPDATE ...; IF NOT FOUND
THEN INSERT` — se cambió a `ON CONFLICT` porque el patrón viejo tiene una race condition real bajo
concurrencia (dos UPDATEs simultáneos al mismo producto podían no verse entre sí y terminar creando 2
tareas duplicadas). Encontrado en el self-review de la migración (el subagente `migration-reviewer`
falló por el límite de gasto mensual de la cuenta — se revisó a mano contra el mismo checklist).

## 🔒 Fix de seguridad (mig 353) — `vw_tareas_repositor` sin `security_invoker`

Con el límite de gasto mensual de subagentes ya liberado (confirmado por GO), se volvió a correr el
`migration-reviewer` completo sobre la mig 352 (la vez anterior había fallado a mitad de revisión) y
encontró que `vw_tareas_repositor` había quedado creada **SIN** `WITH (security_invoker = true)`. Por
default, Postgres evalúa las RLS policies de las tablas subyacentes con los permisos del **DUEÑO de la
vista**, no del usuario que consulta — el mismo gotcha que el proyecto ya había resuelto en la **mig
053** (`stock_por_producto`) y replicado desde entonces en TODAS las vistas nuevas (migs 136, 141, 142,
226: `vw_boveda_cuentas`, `vw_diferencias_por_cajero`, `vw_caja_resumen_diario`,
`vw_caja_mensual_por_sucursal`). `vw_tareas_repositor` fue la **ÚNICA** vista de todo el historial de
migraciones que quedó afuera de ese patrón — su comentario decía "RLS heredada de las tablas base
(mismo patrón que el resto de las vistas del proyecto)", que en este punto era incorrecto.

**Impacto real mientras estuvo así** (solo en DEV, nunca llegó a PROD): cualquier usuario autenticado
de CUALQUIER tenant que consultara la vista podía ver tareas — y por join, precios/estados de
inventario/vencimientos/patrones de venta — de TODOS los tenants, no solo el propio.

**Fix (`353_fix_security_invoker_vw_tareas_repositor.sql`)**: `ALTER VIEW public.vw_tareas_repositor
SET (security_invoker = true);` + `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` en las
2 funciones trigger (`fn_generar_tarea_repositor_precio`, `fn_generar_tarea_repositor_estado`) —
sugerencia no bloqueante del reviewer, alineada con el precedente de la mig 272. Verificado contra la
DB real de DEV: `pg_class.reloptions` confirma `security_invoker=true`;
`information_schema.role_routine_grants` confirma que las 2 funciones ya no tienen grant a
`authenticated`/`anon` (solo `postgres`/`service_role`). Commiteada y pusheada a `origin/dev` (commit
`36fc075b`) — **mig 353 ✅ EN PROD desde v1.168.0 (deploy real 2026-08-12, PR #328)**.

## Acceso y rol

- **A1 (rol custom, no rol nuevo)**: no hay un rol fijo `REPOSITOR` en el enum de `users.rol` — se
  delega vía `roles_custom` (mismo patrón que ya usa el módulo Comercial), agregando `'repositores'`
  a la lista `MODULOS` de `UsuariosPage.tsx`. El dueño crea un rol custom, elige un rol base (a
  definir cuál usa en la práctica — el nav item de `/repositores` está habilitado para
  `depositoVisible`/`cajeroVisible`, sin `ownerOnly`/`supervisorOnly`, para no cerrarle la puerta a
  ninguno de los dos como base) y oculta todo lo demás salvo Reposición.
- **A2/B3 (acceso default)**: GO delegó en el criterio del asistente — acceso default **SOLO a
  Reposición**, sin Inventario completo (evita exponer `precio_costo`/ajustes de stock de más que un
  repositor no necesita). El dueño lo suma a mano si quiere darle más.
- **I2 (gateo)**: Modo Avanzado únicamente, mismo criterio que Picking/Pedidos/Recepciones/Envíos.

## Lo que NO incluye la Fase 1 (a propósito)

- **Reposición física de stock a góndola** (mover mercadería real de depósito a la góndola) — ✅
  **construida en la Fase 3 (mig 355+356, ver abajo)**. La resolución original de I3 (más abajo en
  esta sección, dejada como registro histórico) asumía que hacía falta "reusar el mecanismo con un
  tipo de tarea nuevo" porque un `replenishment` nunca puede apuntar a una góndola — la investigación
  previa a construir la Fase 3 **corrigió** ese punto: eso es cierto solo para el camino de picking
  automático, no para el de reabastecimiento por umbral. Ver "Qué hace la Fase 3" más abajo para la
  resolución final.
- **Asignación/reasignación de tareas** — ✅ **construida en la Fase 2 (mig 354, ver abajo)**, hoy era
  una cola compartida sin asignar (mismo punto de partida que tuvo `wms_tareas` antes de tener
  asignación).
- **Etiquetas + impresión** (G/H del relevamiento) — ✅ **construida en la Fase 4 (mig 357, ver
  abajo)**, diseño de etiqueta con precio por unidad grande (usa la conversión de
  `unidades_medida_fisicas` ya existente) + PDF pensado para servir también en una impresora térmica
  Zebra si el negocio tiene una (decisión de GO, sin impresión automática — un humano dispara la
  impresión).
- **Notificaciones** (J) y **reportes** (K) del relevamiento original — fuera del alcance final del
  módulo, no se construyeron como parte de Repositores.

## Qué hace la Fase 2 (mig 354) — asignación automática + reasignación manual

GO eligió esta fase (de las 3 propuestas: reposición física / asignación-reasignación / etiquetas) como
la siguiente a construir, conectando con E2/E4 del relevamiento y con el patrón genérico de la Pestaña
de Supervisor (mig 347/348, [[wiki/features/supervision]]).

### Pool de repositores y reparto por carga

- **`fn_usuarios_hacen_repositor(p_tenant_id, p_sucursal_id)`** — pool de usuarios elegibles para
  HACER trabajo de repositor en una sucursal. Es un pool **distinto** del de
  `fn_usuarios_supervisan_modulo` (mig 348), que es para SUPERVISAR/aprobar — acá es para que le caiga
  la tarea de reponer. Elegibles: roles fijos DUEÑO/SUPER_USUARIO/SUPERVISOR/CAJERO/DEPOSITO, o un rol
  custom con permiso `'editar'`/`'supervisa'` en `'repositores'`. Excluye a propósito el rol ADMIN
  (staff de soporte cross-tenant de Genesis360) — no tiene sentido que trabajo físico de góndola le
  caiga a alguien de soporte. `SQL STABLE`, **sin** `SECURITY DEFINER`: al correr como invoker, si
  alguien pasa un `tenant_id` ajeno por RPC, la RLS de `users` lo bloquea sola (confirmado correcto por
  el `migration-reviewer`).
- **`fn_repositor_elegir_asignado(p_tenant_id, p_sucursal_id)`** — del pool de arriba, elige quien
  tiene MENOS tareas `pendiente`/`en_curso` asignadas ahora mismo en esa sucursal; empate al azar
  (mismo patrón que `fn_autorizaciones_auto_asignar` de la mig 348, para que el reparto sea justo de
  verdad y no siempre caiga en el mismo usuario). Uso interno, sin RPC pública propia.
- La elección se **inlineó directo en el `INSERT` de los 2 triggers de la mig 352**
  (`fn_generar_tarea_repositor_precio`/`fn_generar_tarea_repositor_estado`, redefinidos con
  `CREATE OR REPLACE`) — a diferencia del patrón de `autorizaciones`, acá **no** se agregó un trigger
  `BEFORE INSERT` genérico aparte, porque TODAS las filas de `tareas_repositor` nacen únicamente de
  esos 2 triggers. El dedupe `ON CONFLICT ... DO UPDATE` (mig 352) sigue **sin tocar**
  `usuario_asignado_id` a propósito: un cambio de precio repetido sobre una tarea ya asignada no la
  reasigna a otra persona.

### Guard de tenant y vista

- **`fn_tarea_repositor_asignado_valido_tenant`** (trigger `BEFORE INSERT/UPDATE OF
  usuario_asignado_id`): rechaza si el usuario asignado no pertenece al mismo tenant — mismo patrón
  que `fn_regla_enrutamiento_valida_tenant` de la mig 348, cierra el mismo tipo de gap (un `PATCH`
  directo a REST podría intentar asignar la tarea a alguien de otro tenant).
- **`vw_tareas_repositor`** (`CREATE OR REPLACE`, preserva `WITH (security_invoker=true)` de la mig
  353) suma la columna `usuario_asignado_nombre` — agregada AL FINAL del `SELECT` porque Postgres
  rechaza insertar una columna nueva en el medio de una vista existente ("cannot change name of view
  column").

### Reviewer — veredicto APTA

`migration-reviewer` corrió completo, sin hallazgos bloqueantes. 4 sugerencias 🟡 no bloqueantes, 2
aplicadas en el momento (mismo archivo, antes de commitear): `fn_repositor_elegir_asignado` pasó de
`STABLE` a `VOLATILE` (usa `random()`, clasificación correcta aunque inofensivo en la práctica) y se
agregó `REVOKE ALL FROM PUBLIC, anon, authenticated` al guard de tenant (ruido del Security Advisor, no
explotable). Las otras 2 quedan como nota, sin actuar:
- La reasignación está gateada **solo client-side** (`puedeSupervisarModulo`), igual que el patrón ya
  aceptado de `autorizaciones`/mig 347 — no es tema fiscal/contable/inventario, así que no se consideró
  bloqueante, pero vale confirmarlo con GO si en algún momento se quiere endurecer server-side.
- `schema_full.sql` sigue desactualizado (gap ya conocido de antes en esta sesión, falta
  `SUPABASE_ACCESS_TOKEN` — no específico de esta migración).

### Frontend — `RepositoresPage.tsx`

Cada tarea activa muestra un badge con el nombre del asignado (o "Sin asignar"). Si el usuario logueado
puede supervisar el módulo `'repositores'` (`puedeSupervisarModulo`), aparece un botón "Reasignar"
(ícono `UserCog`) al lado de completar/cancelar — abre un `<select>` con los usuarios elegibles (RPC a
`fn_usuarios_hacen_repositor`) + "Sin asignar"; al elegir uno pide un motivo (modal propio, no
`window.prompt`) y reasigna.

**Bug de trazabilidad preexistente de la Fase 1, encontrado y corregido de paso**: completar/cancelar
una tarea logueaba `entidad: 'pedido'` en `actividad_log` en vez de un tipo propio — se agregó
`'tarea_repositor'` a `EntidadLog` (`src/lib/actividadLog.ts`) y se corrigieron las 2 llamadas.

### Verificación real (2026-08-11) — SQL contra DEV + navegador real

- **SQL contra DEV real** (tenant "Almacén Jorgito", Sucursal Norte): cambio de precio real vía
  `UPDATE` → tarea nace con `usuario_asignado_id` ya asignado (reparto por carga, pool exacto de 5
  elegibles vs. 4 excluidos por rol confirmado: ADMIN/CONTADOR/RRHH quedaron afuera como se esperaba);
  un segundo cambio de precio en OTRO producto fue a una persona distinta (carga balanceada, no
  siempre la misma); un tercer cambio de precio sobre la MISMA tarea ya asignada NO la reasignó (dedupe
  respetado); un intento de asignar a un usuario de OTRO tenant fue RECHAZADO por el guard nuevo.
- **Navegador real** (Playwright ad-hoc contra `localhost:5173`, login real con usuario DUEÑO de
  prueba): `/repositores` carga sin errores de consola/red; con una tarea de prueba real se vio el
  badge "E2E Tester" (auto-asignado), se clickeó Reasignar, el picker mostró los 5 usuarios elegibles
  reales, se reasignó a "cajero1" con motivo, apareció el toast "Tarea reasignada" y el badge cambió a
  "cajero1" — confirmado también en DB (`actividad_log` con `entidad='tarea_repositor'`,
  `accion='reasignar'`, motivo incluido).
- Todos los datos de prueba se limpiaron después (tarea, ubicación de exhibición temporal, precio
  revertido, log de prueba borrado) — el tenant quedó como estaba.

Commiteado y pusheado a `origin/dev` (commit `e200d673`). **Mig 354 ✅ EN PROD desde v1.168.0 (deploy
real 2026-08-12, PR #328, tag/release `v1.168.0`).**

## Qué hace la Fase 3 (mig 355+356) — reposición física de stock a góndola

GO eligió esta fase de las 2 futuras que quedaban (reposición física / etiquetas+impresión) —
resuelve I3 y B3 del relevamiento, la última pieza operativa del módulo antes de etiquetas.

### Investigación previa al diseño — corrige la resolución anterior de I3

Antes de tocar código se investigó a fondo `wms_tareas`, `fn_wms_elegir_ubicacion_picking`,
`fn_generar_tareas_reabastecimiento_umbral`, el modelo de Ubicaciones post-rediseño,
`venta_item_despachos` y si el Motor de Rotación ya estaba construido (ver
[[wiki/features/wms]]/[[wiki/features/ubicaciones]]/[[wiki/features/precios-tiers-empaque]]). La
resolución anterior de I3 (ver arriba, "Lo que NO incluye la Fase 1") asumía que hacía falta "reusar
el MECANISMO de movimiento de stock con un tipo de tarea nuevo" porque "un replenishment nunca puede
apuntar a una góndola" — eso es cierto **solo** para el camino de picking automático
(`fn_wms_elegir_ubicacion_picking`, que sí filtra duro por `tipo_logico='picking'`), pero el camino de
**reabastecimiento POR UMBRAL** (`fn_generar_tareas_reabastecimiento_umbral`, ver
[[wiki/features/wms]] → "Fase 4") **nunca tuvo ese filtro en SQL** — el único bloqueo real era la UI
de Config, que solo ofrecía ubicaciones picking en el selector de umbrales. Conclusión final, más
precisa: sí se construye un `tipo` nuevo (por separación conceptual — que la tarea viva en Repositores
y no se mezcle con la cola de Picking del depósito), pero se **REUSA el mecanismo real de movimiento
de stock** (`fn_completar_tarea_reabastecimiento`, mig 297) tal cual, sin duplicar su lógica.

### Chequeo REGLA #0 antes de diseñar

El stock que llega a una ubicación `tipo_logico='exhibicion'` es **INVISIBLE para una venta de
mostrador normal** si esa ubicación tiene `disponible_surtido=false` (default desde la mig 336 para
toda ubicación nueva, ver [[wiki/features/ubicaciones]]) — confirmado grepeando ~9 queries de
`VentasPage.tsx`/`MasivoModal.tsx` que excluyen `disponible_surtido=false` del sourcing de venta. Sin
este chequeo, la reposición física movería stock real a un lugar donde el POS seguiría diciendo "sin
stock". El generador nuevo **SOLO considera góndolas con `disponible_surtido=true`** (toggle ya
existente en Config → Ubicaciones, ícono de carrito) — si el dueño no lo habilitó para una góndola,
esa góndola simplemente no genera tareas.

### Regla de disparo (MVP, cero configuración extra)

Mismo criterio que la Fase 1: se genera una tarea cuando el stock en la ubicación de exhibición de un
SKU (asignada vía `producto_ubicacion_sucursal.ubicacion_exhibicion_id`) **llega a CERO**. No reusa
`producto_ubicacion_umbrales` (exigiría que el dueño configure un mínimo/máximo por SKU+góndola,
trabajo extra que el relevamiento no pidió para esta fase) — la cantidad a mover es todo lo disponible
en el lote **FEFO** más próximo a vencer que se encuentre en depósito
(`ubicaciones.subtipo_almacenamiento IN ('bulk','estiba','camara')`).

### Mig `355_repositores_fase3_reposicion_gondola.sql`

- `wms_tareas.tipo` gana `'reposicion_gondola'` (mismo precedente que `'armado'`, mig 345) y
  `wms_tareas.origen` gana `'repositor'`.
- **`fn_generar_tareas_reposicion_gondola(p_tenant_id)`** — función nueva, `SECURITY INVOKER` a
  propósito (si alguien pasa un tenant ajeno, la RLS de las 4 tablas que toca lo bloquea sola,
  verificado por el reviewer contra las policies reales, sin necesitar un chequeo explícito). Recorre
  SKUs con exhibición asignada + `disponible_surtido=true`, detecta góndola en cero, busca FEFO en
  depósito, dedupea, arma la tarea con `usuario_asignado_id` completado por el MISMO reparto por carga
  de Fase 2 (`fn_repositor_elegir_asignado`, mig 354) — reusa el pool de "quién hace trabajo de
  repositor", sin crear uno nuevo.
- **`fn_completar_tarea_reabastecimiento`** (mig 297, el mecanismo real de mover stock con
  transferencia proporcional de reserva — ver [[wiki/features/wms]] → "Fase 4") se **REUSA tal cual**
  — único cambio, el guard de tipo pasa de `<> 'replenishment'` a `NOT IN ('replenishment',
  'reposicion_gondola')`. Un solo lugar donde vive esta lógica de REGLA #0, no una copia paralela.
- Guard nuevo **`fn_wms_tarea_asignado_valido_tenant`** (trigger) en
  `wms_tareas.usuario_asignado_id` — la columna existe desde la mig 289 y ya se usaba en
  `PickingPage.tsx` (filtro "tareas mías o libres", pedido de GO 2026-08-08) pero nunca había tenido
  este guard de tenant.
- `fn_repositor_elegir_asignado` (mig 354) ganó un `GRANT EXECUTE TO authenticated` porque ahora tiene
  un 2do llamador (el generador, que es `SECURITY INVOKER` e invocado directo por RPC) — antes solo la
  llamaban triggers `SECURITY DEFINER`.

### Frontend

`RepositoresPage.tsx` gana una sección nueva **"Reposición física"** (toggle junto a
"Precios/Etiquetas") con botón "Revisar reposición" (mismo patrón que "Revisar umbral" de Picking),
lista con origen→destino, completar/cancelar/reasignar (mismo patrón de Fase 2, reasignación con
motivo). `PickingPage.tsx` excluye `reposicion_gondola` de su cola (`.neq('tipo',
'reposicion_gondola')`) para que no se mezcle con el trabajo de depósito.

### `migration-reviewer` — 2 hallazgos reales corregidos en el momento

1. **`PedidosPage.tsx` tiene su PROPIA tab de WMS** (además de Picking) que también mostraba tareas
   `reposicion_gondola` sin filtrarlas — un click en "Confirmar retiro" ahí fallaba ruidosamente (no
   corrompía stock, pero confundía). Corregido con el mismo `.neq('tipo', 'reposicion_gondola')`.
2. **Dedupe no atómico** en el generador (`CONTINUE WHEN EXISTS`, mismo patrón heredado de
   `fn_generar_tareas_reabastecimiento_umbral`) — 2 llamadas concurrentes (doble click, 2 repositores)
   podían crear 2 tareas activas para el mismo producto+góndola, sobre-moviendo stock real. **Mig
   `356_fix_dedupe_reposicion_gondola.sql`**: índice único parcial
   `uq_wms_tareas_reposicion_gondola_activa` + `ON CONFLICT DO NOTHING`, mismo patrón que
   `uq_tareas_repositor_activa` de Fase 1 (mig 352). Verificado con 2 llamadas seguidas al generador:
   solo 1 tarea creada.

**2 notas del reviewer, NO corregidas (bajo riesgo hoy, documentadas para más adelante)**:
- El generador no filtra por sucursal visible del llamador (mismo patrón preexistente de
  `fn_generar_tareas_reabastecimiento_umbral`) — en un tenant multi-sucursal con RLS restrictivo por
  usuario podría dar falsos negativos de dedupe o mezclar sucursal de origen/destino. Riesgo real bajo
  hoy (no hay tenant multi-sucursal + avanzado + WMS activo en producción todavía).
- `tareas_repositor` (Fase 1, mig 352) nunca tuvo `authenticated` explícito en el `REVOKE ALL FROM
  PUBLIC, anon` — por default-privileges de Supabase, `authenticated` igual tiene INSERT/DELETE ahí
  (contradice el comentario "sin INSERT a propósito" de mig 352). Bajo impacto (no toca
  stock/plata/fiscal), hallazgo adyacente no específico de esta fase.

### Verificación real (2026-08-11/12, contra DEV)

- **SQL contra DEV real** (tenant "Almacén Jorgito", Sucursal Norte, "Bebida Coca Cola 2.5L" y "Elite
  Pañuelos Super Pack x3"): generación con reparto por carga confirmado (excluyó correctamente
  ADMIN/CONTADOR/RRHH del pool, igual que Fase 2), movimiento físico de stock verificado unidad por
  unidad (13 unidades RACK1→Góndola1, sumando 2 LPN de origen), stock de origen correctamente
  decrementado a 0 preservando una línea reservada intacta, cancelación con motivo verificada,
  reasignación dentro del tenant verificada, guard cross-tenant RECHAZADO correctamente, dedupe
  atómico verificado (2 llamadas seguidas = 1 sola tarea).
- **Navegador real** (Playwright ad-hoc, login real DUEÑO): tab "Reposición física" carga sin errores,
  card con origen→destino y cantidad, picker de reasignar con los usuarios reales del pool,
  reasignación con motivo → toast, completar → toast "Reposición completada — stock movido a la
  góndola" con movimiento real confirmado en DB.
- Todos los datos de prueba se limpiaron después (tareas, `producto_ubicacion_sucursal.
  ubicacion_exhibicion_id`, stock restaurado a sus cantidades originales, `actividad_log` de prueba
  borrado) — el tenant quedó exactamente como estaba antes de probar.

### Housekeeping — `schema_full.sql` puesto al día

`supabase/schema_full.sql` estaba desactualizado desde la mig 351 (le faltaban 351-356) porque el
modo automático de `dump-schema.mjs` necesita un `SUPABASE_ACCESS_TOKEN` no configurado en este
entorno (ver [[reference_schema_dump_metodo]] en memoria). GO pasó un token temporal en el chat para
usar UNA VEZ sin guardarlo — se usó inline (nunca escrito a disco) para regenerar el archivo dos veces
(tras mig 355 y tras mig 356), quedó current. El token no se guardó en ningún archivo ni quedó
persistido.

Commiteado y pusheado a `origin/dev` (commits `45a3c89b` mig 355, `d6f37b08` fix dedupe mig 356 +
`PedidosPage.tsx`). **Mig 355+356 ✅ EN PROD desde v1.168.0 (deploy real 2026-08-12, PR #328).**

## Qué hace la Fase 4 (mig 357) — etiquetas de precio + impresión (última fase del módulo)

GO eligió etiquetas+impresión como la última fase que quedaba (era la única) — resuelve G1-G3/H1-H3
del relevamiento y cierra el módulo Repositores completo (4/4 fases).

### Investigación previa — 2 patrones existentes reusados

Antes de diseñar se revisaron 2 mecanismos de impresión ya construidos: `src/lib/etiquetasEnvioPDF.ts`
(EN7 de Envíos — jsPDF en grilla A4 4/6/12 por hoja, con QR) tomado como plantilla estructural, y
`src/components/CodigoMasivoModal.tsx` (Inventario — renderiza códigos GS1 con `bwip-js` a un canvas
offscreen → dataURL, soporta imprimir N etiquetas de una tanda). Se confirmó que `convertirFisica()`
(`src/lib/unidadMedidaFisica.ts`, ver [[wiki/features/estructuras-udm]] → Fase 1) ya existía y no había
que reprogramarla, y que no existía ningún campo de "contenido" en `productos` (confirmado con grep).

### Mig `357_repositores_fase4_etiquetas.sql`

Solo 4 `ALTER TABLE ADD COLUMN IF NOT EXISTS` — sin tablas/RLS/triggers/funciones nuevos, las columnas
heredan la RLS de fila ya existente en `productos`/`tenants`:

- **`productos.contenido_cantidad`** (numeric, `CHECK > 0`) + **`productos.contenido_unidad_id`** (FK a
  `unidades_medida_fisicas`) — cuánto contiene FÍSICAMENTE 1 unidad de venta (ej. 120 para un shampoo
  de 120ml). Distinto de `productos.unidad_medida_base_id` (cómo se vende/cobra el producto, no cuánto
  contiene) — ver "Card 1: Identificación" en [[wiki/features/productos]].
- **`tenants.repositor_etiquetas_por_hoja`** (integer, `CHECK IN (4,6,12)`, default 12 — la opción de
  menos hojas).
- **`tenants.repositor_hora_impresion`** (time, nullable = sin aviso configurado).

### G1 — contenido de la etiqueta

Nombre + precio nuevo siempre. Precio anterior tachado AL LADO del nuevo **solo si es un descuento
real** (precio bajó) — si el precio SUBIÓ no se tacha nada (mostrar "tachado" en una suba de precio
sería un mensaje incorrecto de cara al cliente). Código de barras del producto vía `bwip-js`
(`code128`, con el número incluido automáticamente debajo por `includetext:true`).

Con `contenido_cantidad`/`contenido_unidad_id` cargados, la etiqueta agrega en chico "Precio por
L/Kg/m: $X" — nueva función **`precioPorUnidadGrande()`** en `src/lib/unidadMedidaFisica.ts`, que solo
agrega el mapeo familia→unidad de referencia (peso→Kilogramo, volumen→Litro, longitud→Metro) por
encima de `convertirFisica()` ya existente, **sin tocarla**. Sin esos dos campos cargados, la etiqueta
simplemente no muestra esa línea (no es un error).

### G2 — formato configurable

Card nueva **"Repositores — Etiquetas de precio"** en Config → Inventario → Zonas y picking, con un
select de tamaño de hoja (4/6/12, default 12) y un input de hora — mismo patrón `update` +
`setTenant(data)` que el resto de `ConfigPage.tsx`.

### G3 — una etiqueta por producto

Consecuencia natural del diseño, sin código extra: 1 tarea seleccionada = 1 producto = 1 etiqueta en
el PDF.

### H1/H2 — aviso a partir de una hora configurada, sin impresión automática

Banner **DENTRO** de la página `/repositores` (no una notificación cross-app del sistema de
`notificaciones`) que aparece cuando la hora actual ya pasó `tenants.repositor_hora_impresion` **y**
quedan carteles pendientes. Se evalúa en cada render — el proyecto no tiene cron ni `setInterval` en
ningún lado (ver `reference_pg_cron_no_habilitado` en memoria), así que no hay un "disparo" en tiempo
real al llegar la hora exacta: el aviso aparece la próxima vez que la página se re-renderiza
(navegación, refetch normal de React Query) — suficiente para el caso de uso, no se justificó agregar
infraestructura de polling nueva solo para esto.

### H3 — tanda de impresión

En la sección "Precios/Etiquetas" de `/repositores`, filtro "Pendientes": checkboxes por tarea +
"Seleccionar todas" + botón "Imprimir etiquetas (N)" que junta todas las seleccionadas en un solo PDF
(`generarEtiquetasPreciosPDF`, nuevo en `src/lib/etiquetasPreciosPDF.ts`). **Imprimir NO completa la
tarea** — son 2 acciones separadas a propósito (imprimir el cartel es un paso, ir a pegarlo
físicamente y click en "Completar" es otro, ya existente desde la Fase 1) — no se agregó ninguna
columna `impreso_at` a `tareas_repositor`, la migración quedó minimal.

### `src/lib/etiquetasPreciosPDF.ts` — nuevo

Mismo patrón jsPDF en grilla A4 que `etiquetasEnvioPDF.ts`, pero con código de barras (`bwip-js`) en
vez de QR, y contenido de precio/descuento en vez de datos de envío/destinatario.

### Migración self-reviewed, sin `migration-reviewer`

Decisión explícita, no un salteo por apuro: perfil de riesgo bajo (solo 4 `ADD COLUMN`, sin
RLS/triggers/funciones nuevos) a diferencia de las migraciones 352-356 (que sí tocaban
RLS/SECURITY DEFINER/movimiento real de stock) — se revisó a mano contra el mismo checklist en vez de
despachar el subagente.

### Verificación real (2026-08-11/12, contra DEV, navegador Playwright ad-hoc)

- 2 tareas de prueba reales (`tareas_repositor`, tipo `cambio_precio`): una con descuento real
  ($1.000→$800, producto CON código de barras) y otra con precio que SUBIÓ ($500→$600, producto SIN
  código de barras) — para cubrir ambas ramas de la regla G1.
- `contenido_cantidad=2.5` + `contenido_unidad_id=Litro` asignados a "Bebida Coca Cola 2.5L" ($600),
  para probar "Precio por L: $240".
- `/repositores` → "Precios/Etiquetas" → "Seleccionar todas" → "Imprimir etiquetas (2)" → descarga real
  de PDF (58.910 bytes, capturada), sin errores de consola/red.
- Aislado el producto SIN código de barras solo: PDF de 3.480 bytes (vs. 58KB con el código real
  incluido) — confirma que `if (codigo)` funciona bien y no genera una imagen de barcode vacía/rota
  cuando no hay código.
- Verificado visualmente (screenshot) el campo "Contenido" en `ProductoFormPage.tsx` → Identificación,
  entre Marca y Descripción, con placeholder y select de unidad deshabilitado hasta cargar una
  cantidad.
- Verificado visualmente (screenshot) la card "Repositores — Etiquetas de precio" en Config →
  Inventario → Zonas y picking, con el select de tamaño de hoja y el input de hora; guardar la hora
  persistió correctamente (update real + revertido después).
- Todos los datos de prueba se limpiaron después (tareas borradas, `contenido_cantidad`/
  `contenido_unidad_id` del producto revertidos a NULL, `repositor_hora_impresion` del tenant revertido
  a NULL) — el tenant "Almacén Jorgito" quedó exactamente como estaba antes de probar.

Typecheck + build verdes. Commiteado y pusheado a `origin/dev` (commit `ad35d0f6`). **Mig 357 ✅ EN
PROD desde v1.168.0 (deploy real 2026-08-12, PR #328).**

**Con esto, el módulo Repositores queda 100% construido: Fases 1-4 (mig 352-357), TODAS verificadas en
DEV Y DEPLOYADAS A PROD el 2026-08-12 (v1.168.0, PR #328, tag/release `v1.168.0` publicados).** El
deploy fue verificado de forma independiente: `gh pr view 328` → `MERGED`; `list_migrations` contra
PROD confirma 352-357 aplicadas; bundle real de `https://genesis360.pro/` con la cadena "v1.168.0".

## Verificación real (2026-08-11, contra DEV) — Fase 1

Con el tenant "Almacén Jorgito": se asignó "Góndola1" como ubicación de exhibición de un producto
real vía la UI → se cambió su precio dos veces por la UI real (`$555 → $777`) → la tarea
`cambio_precio` apareció en `/repositores` con `precio_anterior`/`precio_nuevo` correctos y el badge
"↗ Precio subió" → se cambió el `estado_id` de una línea real a un estado con `descuento_pct=15` →
apareció la tarea `cambio_estado` con el nombre y el % correctos → se completó una tarea desde la UI
y se confirmó el toast + el movimiento a la pestaña "Completadas". Todos los datos de prueba se
limpiaron después (precio, ubicación de exhibición y estado revertidos; tareas de prueba borradas) —
el tenant quedó exactamente como estaba antes de probar.

## Ver también

- [[project_backlog_fede_comercial_25_7]] (memoria) — estado completo del backlog de Fede, las 5
  fases, y el detalle de las decisiones A1/A2-B3/H1 que cerró GO.
- [[wiki/features/supervision]] — el patrón de Pestaña de Supervisor cuyo criterio de reparto por
  carga/reasignación reusó la Fase 2 de Repositores.
- [[wiki/features/wms]] — `fn_completar_tarea_reabastecimiento` (mig 297) y el camino de
  reabastecimiento por umbral que la Fase 3 de Repositores reusa; nota agregada ahí sobre el 2do
  llamador (mig 355+356).
- [[wiki/features/envios]] — `etiquetasEnvioPDF.ts` (EN7), la plantilla estructural jsPDF que reusó la
  Fase 4 para `etiquetasPreciosPDF.ts`.
- [[wiki/features/productos]] — "Card 1: Identificación" documenta el campo nuevo "Contenido"
  (`contenido_cantidad`/`contenido_unidad_id`, mig 357) usado por la etiqueta de precio de la Fase 4.
- [[wiki/features/estructuras-udm]] — `unidades_medida_fisicas`/`convertirFisica()`, la conversión de
  unidades física que reusa `precioPorUnidadGrande()` (Fase 4) sin tocarla.
- `G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md` — las 35 preguntas originales y sus
  respuestas completas, incluida la sección "Cierre de ambigüedades" que resolvió A1/A2/H1/C3/I3, y la
  nota que corrige I3 con la conclusión final de la Fase 3.
