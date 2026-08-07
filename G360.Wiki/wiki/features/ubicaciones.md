---
title: Ubicaciones — Rediseño en árbol (tipo lógico + jerarquía)
category: features
tags: [ubicaciones, wms, arbol, jerarquia, tipo-logico, picking, repositores, comercial]
sources: [supabase/migrations/334_ubicaciones_arbol_tipo_logico.sql, supabase/migrations/335_producto_ubicacion_exhibicion.sql, supabase/migrations/336_ubicaciones_defaults_apagados.sql, supabase/migrations/339_ubicaciones_drop_tipo_ubicacion.sql, src/lib/ubicacionesArbol.ts, src/lib/supabase.ts, src/pages/ConfigPage.tsx, tests/e2e/130_ubicaciones_arbol_mutante.spec.ts, relevamiento-ubicaciones-reglas-negocio.html]
updated: 2026-08-07
---

# Ubicaciones — Rediseño en árbol (tipo lógico + jerarquía)

> ✅ **PROD desde v1.158.0 (deploy 2026-08-06).** Migs **334** y **335** aplicadas en DEV Y PROD. El
> e2e de verificación manual (`130_ubicaciones_arbol_mutante`, escrito el 2026-08-06) encontró y
> corrigió **4 gaps reales** de breadcrumb que quedaban del cierre del 2026-08-05 — ver sección "🐛 4
> gaps de breadcrumb encontrados el 2026-08-06" más abajo. Es el **1º de 4 relevamientos** acordados
> con Fede/GO para desbloquear la **Fase E (módulo Repositores)** del backlog Comercial de Fede, hoy
> pausada — ver [[wiki/features/precios-tiers-empaque]] → "Fase E". Secuencia completa: **Ubicaciones
> (esta) → Pestaña de supervisor reusable → Motor de Rotación de productos con descuento →
> Repositores**.

## Origen

GO/Fede respondieron `relevamiento-ubicaciones-reglas-negocio.html` (raíz del repo, generado
2026-08-02) el 2026-08-05, con GO autorizando explícitamente romper/tocar datos existentes ("no hay
clientes reales, son todas pruebas — si hay que modificar lo que ya está para que funcione con lo
nuevo, que se haga"). El plan de diseño se armó antes de codear (vía EnterPlanMode) y quedó guardado
en `C:\Users\gasto\.claude\plans\enumerated-churning-iverson.md`.

## El problema que resuelve

`ubicaciones` era una tabla **plana**: cada fila era una posición física suelta (racks, estanterías,
mostrador), sin forma de modelar contención ("Rack 1" contiene "Rack 1 - Nivel A" contiene "Rack 1 -
Nivel A - Posición 3") ni de distinguir el **tipo de negocio** de una posición (¿es exhibición al
cliente? ¿mostrador? ¿picking? ¿almacenamiento puro?) del **tipo técnico WMS** (bulk/estiba/cámara/
cross-dock/staging). El módulo Repositores necesita ambas cosas: saber qué ubicaciones son de
**exhibición** (donde un repositor tiene que reponer cara al cliente) separadas de las de
**almacenamiento**, y poder navegar la jerarquía real del depósito.

## Diseño: árbol vía self-FK, no una tabla nueva

**Mig 334** (`334_ubicaciones_arbol_tipo_logico.sql`) agrega `padre_ubicacion_id` (self-FK) a
`ubicaciones` — el mismo patrón que `producto_presentaciones.padre_linea_id` (mig 307): un nivel
nuevo es, en sí mismo, una fila más de la misma tabla, **no** una tabla de "niveles" separada.

**Hallazgo central que evitó una migración de datos grande:** `inventario_lineas.ubicacion_id`,
`wms_tareas.ubicacion_origen_id`/`ubicacion_destino_id`, `producto_ubicacion_umbrales.ubicacion_id`,
`producto_ubicacion_sucursal.ubicacion_id` y `venta_item_despachos.ubicacion_id` **ya** apuntaban a
`ubicaciones.id`. Como un nivel nuevo del árbol es también una fila de `ubicaciones`, **ninguna** de
esas FK necesitó re-apuntar a nada — cero migración de datos en esas cinco tablas.

### Columnas nuevas

```sql
padre_ubicacion_id   UUID REFERENCES ubicaciones(id)   -- self-FK, arma el árbol
tipo_logico           TEXT  -- enum de negocio: 'exhibicion' | 'mostrador' | 'picking' | 'almacenamiento'
subtipo_almacenamiento TEXT -- técnico WMS, solo válido con tipo_logico='almacenamiento':
                             -- 'bulk' | 'estiba' | 'camara' | 'cross_dock' | 'staging'
codigo                TEXT NOT NULL UNIQUE (por tenant)  -- autogenerado, editable
pos_x, pos_y, orientacion_deg  -- reservados, SIN UI todavía (proyecto "Almacén 360", pospuesto)
```

`subtipo_almacenamiento` **reemplaza** al viejo `tipo_ubicacion` (mig 032, CHECK
`'picking'|'bulk'|'estiba'|'camara'|'cross_dock'`) — mismos 5 valores técnicos, ahora separados de
la dimensión de negocio y solo aplicables cuando `tipo_logico='almacenamiento'`.

### Regla de diseño: `tipo_logico` solo en nodos hoja

`tipo_logico` **únicamente** se puede asignar a un nodo **sin hijos**. Responde directamente la
pregunta que el propio relevamiento dejaba abierta sobre el "nivel implícito": una ubicación plana
de hoy **ya es una hoja**, así que el backfill le asigna su tipo directo, **sin crear nodos
sintéticos** para representar el árbol de las ubicaciones existentes.

### Triggers nuevos (4)

- **`trg_ubic_no_ciclo`** — anti-ciclo: una ubicación no puede terminar siendo su propio ancestro.
- **`trg_ubic_tipo_logico_guard`** — consistencia: `subtipo_almacenamiento` solo con
  `tipo_logico='almacenamiento'`; `tipo_logico` solo en nodos sin hijos.
- **`trg_ubic_autogenerar_codigo`** — genera `codigo` si no se especifica: raíz → `U01`, `U02`...;
  hijo → `<código del padre>-1`, `-2`...
- **`trg_ubic_guard_padre_operativo`** (🛑 `SECURITY DEFINER`) — **guard DURO**: bloquea agregar un
  nivel bajo un padre que tenga `tipo_logico` asignado, stock activo, umbrales de reabastecimiento
  configurados (`producto_ubicacion_umbrales`), o tareas WMS pendientes. Es inventario real (Regla
  de Oro #0) — avisa-y-bloquea, no avisa-y-deja-pasar.

### 🔒 2 hallazgos del `migration-reviewer` antes de aplicar (corregidos)

1. **Guard duro bypasseable sin `SECURITY DEFINER`.** `inventario_lineas` y `wms_tareas` tienen RLS
   **por sucursal** (mig 216-218); `ubicaciones` no. Sin `SECURITY DEFINER`, un usuario fijado a una
   sola sucursal podía crear un nivel bajo un padre operativo cuyo stock/tareas viven en OTRA
   sucursal (invisible para su RLS), evadiendo el guard. Corregido antes de aplicar.
2. **Bug en la autogeneración de código.** El backfill hubiera arrancado en `"U22"` en vez de
   `"U01"` — contaba filas que **todavía no tenían código asignado** al calcular el próximo
   correlativo. Corregido antes de aplicar.

### Backfill

19 filas en DEV (4 en PROD, **sin tocar en esta sesión**, verificado con queries reales antes de
escribir la migración), mapeo `tipo_ubicacion` viejo → `tipo_logico`/`subtipo_almacenamiento` nuevo:

| `tipo_ubicacion` viejo | `tipo_logico` nuevo | `subtipo_almacenamiento` nuevo |
|---|---|---|
| `picking` | `picking` | — |
| `bulk` / `estiba` / `camara` / `cross_dock` | `almacenamiento` | mismo valor |
| `NULL` | `almacenamiento` | `NULL` (valor neutro, no bloqueante) |

### 6 funciones SQL reescritas

El relevamiento solo esperaba 2 lectoras de `tipo_ubicacion`; un grep exhaustivo de
`schema_full.sql` encontró **4 más**. Las 6 pasan a leer `tipo_logico`/`subtipo_almacenamiento`:

- `fn_wms_elegir_ubicacion_picking`
- `fn_generar_tareas_reabastecimiento_umbral`
- `fn_generar_tareas_picking_envio`
- `fn_generar_tareas_picking_pedido_stock`
- `fn_generar_tareas_picking_pedido_venta`
- `fn_lanzar_bolsa_pedidos` — de paso se corrigió un bug latente preexistente: comparaba con `<>`,
  que en SQL **no** rechaza `NULL`; cambiado a `IS DISTINCT FROM`.

### Lo que NO hizo falta tocar

`vw_ubicacion_ocupacion` (migs 321/322/325) y la comparación de `producto_ubicacion_umbrales` **ya**
hacían match exacto por `ubicacion_id` — nunca sumaban por descendientes del árbol — así que ya
miden "por nivel" tal cual sin ningún cambio.

### `tipo_ubicacion` (columna vieja) — NO se dropeó todavía

Queda para una **Fase U5** de limpieza futura, mismo patrón que F3b/F4 con las columnas fiscales de
`tenants`: se dropea recién cuando un grep de lectores da 0. **Estado actual del grep:** 0 en `src/`
salvo el propio tipo TS marcado `deprecated` en `src/lib/supabase.ts` — la migración de `DROP
COLUMN` en sí queda pendiente.

## Mig 335 — prepara Repositores

`335_producto_ubicacion_exhibicion.sql` agrega **`producto_ubicacion_sucursal.
ubicacion_exhibicion_id`** — columna **nueva** (no se reinterpretó la `ubicacion_id` existente, que
sigue siendo el default de **PUTAWAY** al recibir stock). Es la ubicación de **exhibición** de cara
al cliente que el futuro módulo Repositores va a necesitar para saber "qué va dónde en el piso de
venta". Sin obligatoriedad a nivel DB por ahora — es una regla condicional de negocio, pensada para
una fase de UI futura.

## Verificación

Ambas migraciones pasaron por el subagente `migration-reviewer` **antes** de aplicarse (los 2
hallazgos de arriba, corregidos antes de aplicar) y se verificaron con **queries reales contra DEV**
después de aplicar:

- Códigos únicos `U01`-`U19` en el orden histórico correcto.
- `tipo_logico` seteado en las 19 filas backfilleadas.
- `fn_wms_elegir_ubicacion_picking` sigue devolviendo exactamente lo mismo que antes de la migración
  (`NULL` — ningún tenant real tiene todavía una ubicación tipo `picking` configurada).
- Guard duro probado insertando intentos de child-bajo-padre-operativo: rechazado correctamente por
  dos motivos distintos (`tipo_logico` asignado y stock activo).
- Caso positivo: generación de código jerárquico (`U06-1`, `U06-2`) verificada.

Todas las pruebas corrieron en transacciones con `ROLLBACK` para no ensuciar los datos de DEV.
`schema_full.sql` regenerado después de aplicar ambas migraciones (vía token de acceso temporal, ya
descartado — no persiste en ningún lado).

## Frontend (Fases U3/U4)

- **`src/lib/supabase.ts`** — interface `Ubicacion` extendida con `padre_ubicacion_id`,
  `tipo_logico`, `subtipo_almacenamiento`, `codigo` (ahora **requerido**, matching el `NOT NULL` de
  la DB), `pos_x`/`pos_y`/`orientacion_deg`. El viejo `tipo_ubicacion` queda marcado `deprecated` en
  un comentario, sin borrarse todavía.
- **`src/lib/ubicacionesArbol.ts`** (archivo nuevo) — helpers puros compartidos:
  - `breadcrumbUbicacion` — camino completo padre→hijo, para mostrar en selects/listas.
  - `descendientesDeUbicacion` — para no dejar elegir un descendiente propio como padre (= ciclo) al
    editar.
  - `ordenarArbolUbicaciones` — orden jerárquico con profundidad, para listas indentadas.
- **`src/pages/ConfigPage.tsx`** — Config → Inventario → Ubicaciones reescrita:
  - Selector de "Ubicación padre" (etiquetado con breadcrumb) tanto para crear como para editar.
  - Campo `codigo`: autogenerado si se deja vacío, editable, con validación de formato en cliente
    (`^[A-Z0-9]+(-[A-Z0-9]+)*$`) antes de enviar.
  - Selector de `tipo_logico` con `InfoTip` (componente ⓘ estándar del repo) explicando las 4
    opciones.
  - Sub-tipo de almacenamiento **condicional** — solo visible si `tipo_logico='almacenamiento'`.
  - Lista con **indentación visual por profundidad** + breadcrumb; con búsqueda activa cae a lista
    plana.
  - Guard nuevo en `deleteUbicacion`: bloquea con mensaje claro ("esta ubicación tiene niveles
    adentro") en vez de reventar con el error crudo de FK.
  - Filtro `ubicacionesPicking` del tab Zonas migrado a `tipo_logico==='picking'`.
- **7 archivos operativos** migrados a `breadcrumbUbicacion` en sus selects de ubicación (antes solo
  mostraban `nombre`) y, donde correspondía, al filtro por las columnas nuevas en vez de
  `tipo_ubicacion`:
  - `RecepcionesPage.tsx`
  - `InventarioPage.tsx` (3 de sus 5 selects — ⚠ **quedaron 2 sin migrar, ver gaps del 2026-08-06
    abajo**)
  - `ProductoFormPage.tsx`
  - `PedidosPage.tsx` — el selector de ubicación de staging para lanzar bolsas ahora filtra por
    `subtipo_almacenamiento='staging'` en vez del viejo `tipo_ubicacion`.
  - `TrasladosPanel.tsx`
  - `LpnAccionesModal.tsx` (2 selects)
  - `MasivoModal.tsx`

**Verde (2026-08-05):** `tsc --noEmit` limpio, `npm run build` exitoso, suite unitaria completa:
**1492 tests (92 archivos) verdes**, incluidos 12 tests nuevos en `tests/unit/ubicacionesArbol.test.ts`
para `breadcrumbUbicacion`/`descendientesDeUbicacion`/`ordenarArbolUbicaciones`.

## 🐛 4 gaps de breadcrumb encontrados el 2026-08-06 (✅ PROD desde v1.158.0)

GO había probado manualmente el árbol el 2026-08-05 (crear una ubicación con medidas/tipo lógico) y
preguntó qué más probar. Se armó `tests/e2e/130_ubicaciones_arbol_mutante.spec.ts` (nuevo, 2/2 verde)
cubriendo: crear un hijo bajo un padre (código autogenerado `U01-1`), el guard que rechaza asignar
`tipo_logico` a un padre CON hijos, que el mismo `tipo_logico` SÍ se puede asignar en la hoja, el
guard que rechaza BORRAR un padre con niveles adentro, y **el breadcrumb padre→hijo en un selector
operativo real** (Inventario → Agregar stock → Ingreso).

Al escribir justo ese último punto aparecieron **4 gaps reales** que contradicen lo que quedó
documentado arriba como cerrado el 2026-08-05 ("InventarioPage.tsx (3 selects)" migrados): en
realidad ese archivo tiene **5** selects de Ubicación y solo 3 estaban migrados a
`breadcrumbUbicacion`. Los 4 gaps encontrados y corregidos:

| Archivo | Select | Problema |
|---|---|---|
| `InventarioPage.tsx` (~línea 3623) | Modal de **Ingreso individual** (el que usa cualquier alta manual de stock) | Mostraba `u.nombre` plano |
| `InventarioPage.tsx` (~línea 4220) | Filtro de Ubicación del panel "Filtros" del tab Inventario | Mismo problema |
| `ConfigPage.tsx` (~línea 4334) | Select de ubicaciones de picking, tab "Zonas y picking" | Mismo problema |
| `PedidosPage.tsx` (~línea 1107) | Select de "Ubicación de staging" del modal de lanzar bolsa de pedidos | Mismo problema **+** la query `ubicaciones-staging` solo traía `id, nombre` filtrado a `subtipo_almacenamiento='staging'` (no el árbol completo) — `breadcrumbUbicacion` no podía resolver el ancestro de una ubicación de staging colgada de un nivel no-staging sin ampliarla |

**Fix:** swap a `breadcrumbUbicacion(u.id, ...PorId)` en los 4, reusando los `useMemo` de
`...PorId` que ya existían en cada archivo; la query de `PedidosPage.tsx` se amplió para traer el
árbol completo con `padre_ubicacion_id`. Verificado con `tsc --noEmit` (0 errores) + `npm run build`
+ specs 95/96/106/129/130 todos re-verificados verdes tras el cambio.

**Impacto real del gap (documentado para que no se repita):** en un árbol con niveles de igual
nombre bajo padres distintos (ej. "Nivel B" bajo dos estantes diferentes), esos 4 selectores
mostraban SOLO "Nivel B" sin indicar de qué padre — indistinguibles para el usuario. **No es un bug
de integridad de datos** (no movía stock mal, Regla de Oro #0 intacta) — es un gap de UX que
contradecía lo que el wiki daba por cerrado. Lección: al cerrar una migración de "N selects", contar
los selects reales del archivo (grep), no dar por sentado el número que dijo el plan original.

## 🔒 Mig 336 (2026-08-06, 🟡 SOLO EN DEV) — ubicaciones nuevas nacen con TN/MELI/picking-venta APAGADOS

Pedido explícito de GO, distinto del rediseño en árbol de arriba (mismas 3 columnas existían desde
antes de la 334, sin tocar por U1-U4): en `ubicaciones`, **`disponible_surtido`** (habilita la
ubicación para picking/venta), **`disponible_tn`** y **`disponible_meli`** tenían `DEFAULT true`
(`es_devolucion` ya nacía `false`, no hacía falta tocarla) — una ubicación recién creada quedaba
expuesta a sync de canales online (TiendaNube/MercadoLibre) y a picking/venta **sin que el usuario lo
pidiera**. Eso es justo lo que la Regla de Oro #0 pide evitar en inventario: exposición no pedida por
default.

**`336_ubicaciones_defaults_apagados.sql`** — `ALTER TABLE ubicaciones ALTER COLUMN
disponible_surtido/disponible_tn/disponible_meli SET DEFAULT false`. **Aplicada en DEV vía
`apply_migration`, NO en PROD todavía** — el código correspondiente (sin cambios de lógica, solo el
default de la columna) quedó sin commitear en el working tree local de `dev` junto con el resto de
la sesión. `supabase/schema_full.sql` actualizado a mano para reflejarlo.

**Verificación:** confirmado por SQL contra DEV (`information_schema.columns`) que las 4 columnas
(incluida `es_devolucion`, que ya era `false`) dan `column_default = 'false'`. El único INSERT de la
app a esta tabla es `addUbicacion()` en `src/pages/ConfigPage.tsx` — no hay seed de onboarding de
tenant que dependa de estos defaults, así que el cambio **no afecta tenants ni ubicaciones
existentes**, solo las creadas de acá en adelante.

## Pendiente

1. **✅ Deployado a PROD el 2026-08-06 (v1.158.0)** — junto con el resto de lo acumulado en DEV
   desde v1.157.0 (fix Regla #0 en `MasivoModal.tsx`, píldoras de filtro, gaps de breadcrumb, cierre
   de la deuda de `waitForTimeout`). Ver `log.md` (2026-08-06, entrada `deploy`).
2. **✅ Mig 336 (defaults apagados) deployada también a PROD** — junto con el resto del deploy de
   v1.159.0 el 2026-08-06 (envío automático TN/MELI, fulfillment sync TN, rentabilidad neta MELI,
   footer de conteo de registros). Ver `log.md` (2026-08-06, entrada `deploy` v1.159.0).
3. **✅ Fase U5 (limpieza) hecha — mig 339 (2026-08-07), 🟡 SOLO EN DEV, sin commitear.** Dropea
   `ubicaciones.tipo_ubicacion` (0 lectores reales confirmados: sin funciones/triggers/vistas ni
   referencias en `supabase/functions`, en `src/` solo el tipo TS deprecated, limpiado junto con la
   migración). Archivo `supabase/migrations/339_ubicaciones_drop_tipo_ubicacion.sql` existe en el
   repo pero como untracked (`??`) en `git status` — no commiteado, no pusheado, no en PROD. Ver
   `wiki/database/migraciones.md`, `sources/raw/project_pendientes.md` (bloque "ARRANCÁ ACÁ").
4. **Relevamiento #2** de la secuencia hacia Repositores (Pestaña de supervisor reusable) — ✅
   respondido completo el 2026-08-07, diseño/construcción sin arrancar todavía (esperan al #3). **#3
   (Motor de Rotación de productos con descuento)** — ✅ relevamiento 100% respondido el 2026-08-07
   (B4/C2/E5 cerrados por GO), con esquema de CONFIGURACIÓN + UI (mig 341) y ejecución real de las
   Opciones 1 y 2 (mig 342) ya construidos — **Opción 2 ✅ VERIFICADA end-to-end el mismo 2026-08-07**
   (encontró y corrigió un bug real de Regla de Oro #0 en `VentasPage.tsx`, test e2e permanente spec
   131), Opción 3 (kits) sin arrancar; 🟡 TODO SOLO EN DEV, sin commitear — ver
   [[wiki/features/precios-tiers-empaque]].
   **#4 (Repositores) sigue bloqueado.**
5. **Prueba manual en el navegador** — cubierta por Playwright (spec 130) el 2026-08-06, pero GO
   todavía no recorrió la UI a mano el árbol completo con los 4 fixes de breadcrumb aplicados.

## Links relacionados

- [[wiki/features/configuracion]] — sub-tab Ubicaciones dentro de Config → Inventario.
- [[wiki/features/precios-tiers-empaque]] — "Fase E" (módulo Repositores), de donde nace esta
  secuencia de 4 relevamientos.
- [[wiki/features/wms]] — Fase 2 ("Dimensiones en ubicaciones"), donde vivía el `tipo_ubicacion`
  viejo, ahora deprecado a favor de `tipo_logico`/`subtipo_almacenamiento`.
- [[wiki/features/estructuras-udm]] — precedente del patrón self-FK (`producto_presentaciones.
  padre_linea_id`, mig 307) que esta migración reusa para el árbol de `ubicaciones`.
- [[wiki/features/pedidos]] — el selector de staging de "Lanzar bolsa" ahora filtra por
  `subtipo_almacenamiento='staging'`.
- [[wiki/features/inventario-stock]] — tablas que consumen `ubicaciones.id` sin cambios de FK
  (`inventario_lineas`, `producto_ubicacion_umbrales`).
- [[wiki/database/migraciones]] — migs 334, 335.
