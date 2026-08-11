---
title: Módulo Repositores
category: features
tags: [repositores, precios, etiquetas, gondola, prioridad, roles-custom, modo-avanzado]
sources: [migration 352, migration 353, migration 354, relevamiento_repositores_respuestas.md, project_backlog_fede_comercial_25_7.md, src/pages/RepositoresPage.tsx, src/pages/ProductoFormPage.tsx, src/pages/UsuariosPage.tsx, src/components/layout/AppLayout.tsx, src/lib/actividadLog.ts]
updated: 2026-08-11
---

# Módulo Repositores

> 🟡 **Fase 1 (núcleo + disparadores + prioridad, mig 352 + fix de seguridad mig 353) y Fase 2
> (asignación automática + reasignación manual, mig 354) CONSTRUIDAS Y VERIFICADAS EN DEV (2026-08-11)
> — NINGUNA deployada a PROD todavía.** Es un módulo nuevo, no un fix: se le preguntó a GO si deployar
> ahora o esperar más revisión (de él o de Fede) antes de subirlo — sin respuesta al cierre de la
> sesión que lo construyó. Confirmar el estado real (`gh pr list`, `git log origin/main`) antes de
> asumir que sigue en DEV.
>
> 🔒🛑 **Bug de seguridad real encontrado y corregido en la Fase 1 (mig 353), mientras estuvo SOLO en
> DEV, nunca llegó a PROD**: `vw_tareas_repositor` había quedado creada sin `security_invoker` — ver
> "Fix de seguridad" más abajo.

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
- **Fase 2 (esta, ✅ construida, mig 354)**: asignación automática por carga + reasignación manual vía
  el patrón de la Pestaña de Supervisor (ya existía como pieza genérica, ver
  [[wiki/features/supervision]]).
- **Fases futuras (sin arrancar, ahora 2, no 3)**: reposición física de stock a góndola (requiere I3,
  ver abajo), etiquetas + impresión (PDF pensado para servir también en impresoras térmicas Zebra,
  decisión de GO), notificaciones, reportes — el orden entre reposición física y etiquetas no está
  decidido todavía.

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
`36fc075b`) — **mig 353, igual que la 352, SOLO en DEV**, sin deployar a PROD.

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

- **Reposición física de stock a góndola** (mover mercadería real de depósito a la góndola) — depende
  de **I3**, ya resuelto por investigación de código pero sin construir: NO reusar
  `wms_tareas.tipo='replenishment'` (la función que elige destino filtra duro por
  `tipo_logico='picking'`, incompatible con góndola) — hace falta un tipo nuevo (ej.
  `reposicion_gondola`), reusando el MECANISMO de movimiento de stock pero no el tag. Mismo
  precedente que ya usó el proyecto al agregar `'armado'` (mig 345) para un caso análogo. Todavía sin
  arrancar.
- **Asignación/reasignación de tareas** — ✅ **construida en la Fase 2 (mig 354, ver abajo)**, hoy era
  una cola compartida sin asignar (mismo punto de partida que tuvo `wms_tareas` antes de tener
  asignación).
- **Etiquetas + impresión** (G/H del relevamiento) — diseño de etiqueta con precio por unidad grande
  (usa la conversión de `unidades_medida_fisicas` ya existente) + PDF pensado para servir también en
  una impresora térmica Zebra si el negocio tiene una (decisión de GO, sin impresión automática — un
  humano dispara la impresión). Todavía sin arrancar.
- **Notificaciones** (J) y **reportes** (K). Todavía sin arrancar.

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

Commiteado y pusheado a `origin/dev` (commit `e200d673`). **Mig 354, igual que 352 y 353, SOLO en
DEV** — sin deployar a PROD; sin tag/release de GitHub todavía (pendiente de confirmar con GO si
corresponde igual, no decidido).

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
- `G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md` — las 35 preguntas originales y sus
  respuestas completas, incluida la sección "Cierre de ambigüedades" que resolvió A1/A2/H1/C3/I3.
