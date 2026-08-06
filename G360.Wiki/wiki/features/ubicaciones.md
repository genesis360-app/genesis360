---
title: Ubicaciones — Rediseño en árbol (tipo lógico + jerarquía)
category: features
tags: [ubicaciones, wms, arbol, jerarquia, tipo-logico, picking, repositores, comercial]
sources: [supabase/migrations/334_ubicaciones_arbol_tipo_logico.sql, supabase/migrations/335_producto_ubicacion_exhibicion.sql, src/lib/ubicacionesArbol.ts, src/lib/supabase.ts, src/pages/ConfigPage.tsx, relevamiento-ubicaciones-reglas-negocio.html]
updated: 2026-08-05
---

# Ubicaciones — Rediseño en árbol (tipo lógico + jerarquía)

> 🟡 **EN DEV, sin deploy a PROD (2026-08-05).** `APP_VERSION` bumpeada a `v1.157.0` como checkpoint
> de sesión (no implica deploy). Migs **334** y **335** aplicadas solo en DEV. Es el **1º de 4
> relevamientos** acordados con
> Fede/GO para desbloquear la **Fase E (módulo Repositores)** del backlog Comercial de Fede, hoy
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
  - `InventarioPage.tsx` (3 selects)
  - `ProductoFormPage.tsx`
  - `PedidosPage.tsx` — el selector de ubicación de staging para lanzar bolsas ahora filtra por
    `subtipo_almacenamiento='staging'` en vez del viejo `tipo_ubicacion`.
  - `TrasladosPanel.tsx`
  - `LpnAccionesModal.tsx` (2 selects)
  - `MasivoModal.tsx`

**Verde:** `tsc --noEmit` limpio, `npm run build` exitoso, suite unitaria completa: **1492 tests (92
archivos) verdes**, incluidos 12 tests nuevos en `tests/unit/ubicacionesArbol.test.ts` para
`breadcrumbUbicacion`/`descendientesDeUbicacion`/`ordenarArbolUbicaciones`.

## Pendiente

1. **Nada deployado a PROD.** Todo quedó en DEV (`APP_VERSION` bumpeada a `v1.157.0` como checkpoint
   de sesión, sin deploy). PROD sigue en `v1.155.0`.
2. **Fase U5 (limpieza):** dropear `ubicaciones.tipo_ubicacion` en una migración futura cuando se
   reconfirme 0 lectores (hoy el grep en `src/` ya da 0 salvo el tipo TS deprecated — falta la
   migración de `DROP` en sí).
3. **Relevamientos #2/#3/#4** de la secuencia hacia Repositores sin arrancar: Pestaña de supervisor
   reusable → Motor de Rotación de productos con descuento → Repositores.
4. **Sin prueba manual en el navegador todavía** — typecheck/build/tests no reemplazan probar la UI
   real.

## Links relacionados

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
