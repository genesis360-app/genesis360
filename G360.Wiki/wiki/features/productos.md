---
title: Productos
category: features
tags: [productos, inventario, variantes, sku, marca, unidades-medida, ubicacion-sucursal, scan-ticket, vision]
sources: [CLAUDE.md, migrations 329, 330, 340, 357, 367, 370, 388, 422, 423, 424, src/pages/ProductosPage.tsx, src/lib/importarProductosMoneda.ts, src/lib/importarProductosActualizacion.ts]
updated: 2026-09-24
---

# Productos

Módulo de catálogo de productos. Global por tenant — mismo catálogo visible en todas las sucursales.

**Páginas:** `src/pages/ProductosPage.tsx` · `src/pages/ProductoFormPage.tsx`  
**Acceso:** todos los roles con permiso de inventario

---

## ProductosPage

CRUD de productos con búsqueda, filtros por categoría/proveedor y acciones masivas.

### Barra de búsqueda y filtros

- **🆕 Buscador de "píldoras" combinables Y/O (2026-08-06, ✅ PROD desde v1.158.0):** reemplaza al
  search server-side viejo (nombre/SKU/código de barras vía Supabase `.ilike`/`.eq`). Ahora se trae
  el catálogo del tenant una vez y se filtra 100% client-side, con criterios `(Campo):valor`
  combinables. Ver [[wiki/features/filtro-pildoras]] para el detalle del mecanismo (compartido con
  Picking e Inventario).
- Botón píldora **"Filtros"** con popover (✅ v1.138.0, EN PROD desde el 2026-07-22 — ver sección dedicada abajo)
- Toggle "Agrupar variantes" (ícono Layers) — alterna entre vista plana y vista agrupada por grupos

### Footer de conteo de registros (🆕 2026-08-06, ✅ PROD desde v1.159.0)

Componente nuevo `src/components/ListaConteoFooter.tsx` (commit `b8d12b87`) — barra fina al pie del
listado con la cantidad de registros visibles según el filtro/píldoras aplicados vs. el total del
tenant:
- **Sin filtro:** "N productos".
- **Con filtro:** "Mostrando N de M productos".
- 🆕 **Sticky al fondo del viewport desde v1.165.0 (2026-08-11)** — detalle completo en
  [[wiki/features/inventario-stock]] "Footer de conteo de registros".

Reusado también en Inventario (tab Inventario), Clientes y Envíos — ver
[[wiki/features/inventario-stock]], [[wiki/features/clientes-proveedores]], [[wiki/features/envios]].

### 🎯 Tab "Autorizaciones" (2026-09-01, mig 388, v1.192.0, commit `0e2bb29d`)

Retrofit del patrón de Supervisión (A4 del relevamiento de Fede, ver [[wiki/features/supervision]] →
"Retrofit a más módulos" → "Productos (A4)" para el detalle completo). `kit_precio` (Motor de Rotación,
ver [[wiki/features/precios-tiers-empaque]] → "Opción 3") y `repricing_margen` (D3, sweep automático de
[[wiki/integrations/mercado-libre]]) estaban mal clasificados en `modulo='inventario'` pese a ser cambios
de PRECIO de producto — la mig 388 reclasifica las filas existentes a `modulo='productos'` y esta tab
nueva (condicional a `puedeSupervisarModulo(user, 'productos')`) las aprueba/rechaza con el mismo hook
genérico `useSupervisorAutorizaciones` que ya usan Inventario/Clientes/Envíos/Proveedores/Pedidos/RRHH.
**Estos 2 tipos ya NO aparecen en el tab de Supervisión de Inventario.**

### Vista plana (default)

- Lista todos los productos
- Badge `• Variante: X` bajo el nombre cuando el producto es hijo de una madre (`producto_padre_id` + `variante_diferenciador`, mig 305) — ⚠ antes era `• Parte de "X"` con `grupo_id`, columna **dropeada** en la mig 311
- Productos inactivos: `opacity-60` + badge "Inactivo" (ISS-122)

### Vista agrupada (grupos de variantes)

- Productos sin grupo → sección "Productos individuales" (colapsable)
- Grupos como secciones expandibles con tabla de variantes: Nombre/SKU | Variante | Precio | Stock
- Botón "Editar grupo" en cada sección

### Panel de filtros — pill button (✅ v1.138.0, EN PROD desde el 2026-07-22, PR #297)

Reemplaza al viejo toggle suelto "Ver inactivos" (ISS-122) por un panel combinable, mismo patrón
visual pill+popover que ya usa `InventarioPage` → tab Inventario (ver
[[wiki/features/inventario-stock]] → "Filtros tab Inventario — pill button"):

- Botón píldora "Filtros" (`SlidersHorizontal`) con badge de cantidad de filtros activos
- **Estado** — Activos / Inactivos / Todos (reemplaza el toggle `showInactivos` de antes; default
  "Activos", igual comportamiento que el toggle viejo pero ahora con opción "Todos" a la vez)
- **Estructura de embalaje** — Con / Sin / Todos, contra `producto_estructuras` (feature de
  v1.137.0, sin query extra: se resuelve con un `SELECT producto_id` agregado)
- **Categoría / Proveedor / Marca** — selects con opción "Sin X", derivados del propio listado de
  productos (sin queries adicionales)
- **Atributos de inventario** — combobox de chips combinables por **OR** (muestra productos con AL
  MENOS UNO de los atributos elegidos). Las opciones no se listan de entrada: aparecen recién al
  enfocar/tipear el input, agrupadas en dos secciones con los mismos labels que
  `ProductoFormPage`:
  - **Tracking**: Control por número de serie (`tiene_series`), Control por lote (`tiene_lote`),
    Fecha de vencimiento (`tiene_vencimiento`), País de origen (`tiene_pais_origen`), KIT
    (`es_kit`)
  - **Variantes**: Talle/Talla, Color, Encaje, Formato, Sabor/Aroma
  - Cada atributo elegido se agrega como chip con X para quitar; búsqueda por label o por grupo
- Click fuera del panel lo cierra; click fuera del combobox (pero dentro del panel) solo cierra el
  dropdown de atributos

> [!NOTE] **Bug real cazado por el e2e mutante 100 (no por code review).** Al elegir una opción
> del combobox de atributos el dropdown no se cerraba tras el click, y su lista `position:absolute`
> tapaba el botón "Limpiar todos los filtros" más abajo, interceptando el click (Playwright:
> "subtree intercepts pointer events"). Fix de una línea: cerrar el dropdown
> (`setAtributoDropOpen(false)`) también al seleccionar una opción, no solo al hacer click afuera
> del panel.

Filtrado 100% client-side sobre el listado ya cargado (sin queries extra salvo el `SELECT
producto_id` de `producto_estructuras`). Ver [[wiki/database/migraciones]] — sin migraciones
nuevas, es puramente frontend.

### Productos inactivos (ISS-122)

- Por defecto solo se muestran productos activos (`Estado = Activos` en el panel de filtros)
- Productos inactivos: fila con `opacity-60` + badge gris "Inactivo"
- Acción rápida para reactivar desde la bulk action bar

### Bulk action bar

Al seleccionar uno o más productos, aparece barra de acciones masivas:

| Acción | Detalle |
|--------|---------|
| Activar / Desactivar (ISS-123) | Botón único toggle: si la mayoría seleccionada está activa → "Desactivar"; si la mayoría está inactiva → "Activar". Acción aplicada en batch. |
| Precio | Actualiza precio de venta masivamente |
| Proveedor | Asigna proveedor a los seleccionados |
| Precio mayorista | Actualiza precio mayorista |
| **Eliminar** (mig 278, ✅ PROD v1.136.0, 2026-07-19) | **Hard delete REAL** (antes no existía ningún hard delete, ni individual ni bulk — solo el toggle Activar/Desactivar). Llama a `eliminar_productos_fisico()` (RPC, guard server-side `fn_producto_tiene_actividad`): borra la fila de `productos` solo si el producto NUNCA tuvo actividad (venta, movimiento, OC, recepción, traslado, conteo, devolución, envío, combo/kit, mapeo marketplace — ~17 tablas). Reporta parciales: "N eliminados · M bloqueados". Ver [[wiki/database/migraciones]] fila 278. |

### Panel lateral "Grupos"

Botón "Grupos" en barra de acciones → panel lateral (drawer):
- Lista de grupos existentes con nombre y cantidad de variantes
- ⛔ **ELIMINADO (mig 311, v1.144.0).** El panel "Grupos" y `ProductoGrupoModal.tsx` ya no existen: las variantes son madre/hijo (`producto_padre_id`) y se administran desde la sección "Variantes" de la ficha del producto. Ver [[wiki/features/estructuras-udm]] → Fases 3/4/5

---

## ProductoFormPage — 6 cards reorganizados (v1.8.29-dev)

La página de creación/edición fue reorganizada en 6 cards temáticos. Columna derecha: Imagen + QR (solo al editar).

> [!NOTE] **🐛 Fix bug real de caché stale al reabrir un producto editado (2026-07-22, ✅ EN PROD desde v1.144.0, sin
> commitear al cierre de sesión).** GO reportó que el selector "Estos precios corresponden a" (ancla
> de precio, Card 3) no se guardaba a la primera — había que editarlo dos veces. Investigado contra un
> producto real de GO (Bebida Coca Cola 2.5L, Almacén Jorgito): el **guardado en base siempre funcionó
> bien** (`nivel_precio_orden` quedaba correcto en la DB al toque). El bug real era de **lectura**: al
> guardar, `handleSubmit` solo invalidaba la caché de React Query de la LISTA (`['productos']`), nunca
> la del producto individual (`['producto', id]`) que usa este mismo formulario — así que al reabrir el
> producto, React Query servía el snapshot cacheado de ANTES de la edición (stale-while-revalidate)
> mientras refrescaba en segundo plano, y como el `useEffect` que siembra el formulario solo corre una
> vez (guard `!loaded`), quedaba pegado para siempre con el valor viejo. **Afecta potencialmente TODOS
> los campos del form**, no solo la ancla — la ancla lo hizo más visible por ser un `<select>` fácil de
> notar revertido, a diferencia de un precio que el usuario no siempre re-chequea. **Fix:**
> `src/pages/ProductoFormPage.tsx`, en el éxito de `handleSubmit`, se agregó
> `qc.removeQueries({ queryKey: ['producto', id] })` — no alcanza con `invalidateQueries`, hay que
> evictar la entrada para que la próxima apertura arranque de cero. Verificado en vivo contra el
> producto real de GO con navegación SPA real (no `page.goto()`, que resetearía la caché igual sin
> probar nada): ancla cambiada ida y vuelta (Caja→Pallet→Caja) con reapertura real en el medio, en
> ambos sentidos mostró lo recién guardado. **Sin migración — fix 100% frontend.**

> [!NOTE] **🆕 Thumbnail de imagen + `loading="lazy"` — fix de performance (mig 340, ✅ EN DEV Y PROD
> desde v1.160.0, PR #317 mergeado el 2026-08-08).** Investigación de por qué Supabase DEV entró en "grace period" por
> exceder la cuota de **Cached Egress** + agotar el **Disk IO Budget**: la imagen del producto se
> mostraba a tamaño COMPLETO (hasta 1200px/1.5MB, sin resize) incluso como ícono de 32-36px en
> Productos, Inventario y POS/Ventas — cada vista de lista/galería volvía a bajar el archivo entero.
> **Fix:** al subir la imagen, `ProductoFormPage.tsx` genera además un thumbnail chico con
> `browser-image-compression` (`maxWidthOrHeight: 200, maxSizeMB: 0.05`), lo sube a Storage como
> `<stamp>_thumb.<ext>` y lo guarda en la columna nueva **`productos.imagen_thumb_url`** (mig 340,
> nullable). `ProductosPage.tsx`, `InventarioPage.tsx` (buscador de producto) y `VentasPage.tsx`
> (carrito, vista lista y galería) ahora renderizan `imagen_thumb_url || imagen_url` con
> **`loading="lazy"`** — productos ya existentes sin thumbnail siguen mostrando la imagen completa
> (fallback), solo pierden la optimización hasta que se re-suba la imagen. Verde: tsc · build ·
> **1525 tests unitarios**. **⚠ NO probado con un usuario real subiendo una imagen nueva en el
> navegador** — verificado por code review y tipos, queda pendiente de QA manual. Detalle completo del
> hallazgo (incluida la nota operativa sobre la cuota compartida DEV/PROD de Supabase, pendiente de
> GO): `sources/raw/project_pendientes.md` (bloque "ARRANCÁ ACÁ" del 2026-08-07), `log.md`.

### Card 1: Identificación

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre | text (required) | — |
| SKU | text | Auto-generado con `calcularSiguienteSKU()` si está vacío |
| Código de barras | text | Scan con cámara disponible |
| Marca | text | Sin required (ISS-115, migration 118) |
| Contenido | number + select unidad | Opcional — cuánto contiene 1 unidad de venta (ej. 120 + "ml"). Nuevo (mig 357, módulo Repositores) — ver nota abajo |
| Descripción | textarea | — |

> [!NOTE] **Campo "Contenido" (mig 357, ✅ EN PROD desde v1.168.0, 2026-08-12, para el módulo
> Repositores).** `productos.
> contenido_cantidad` (numeric) + `productos.contenido_unidad_id` (FK a `unidades_medida_fisicas`) —
> cuánto contiene FÍSICAMENTE 1 unidad de venta (ej. 120 para un shampoo de 120ml). **Distinto** de
> "Unidad de medida" en Card 4 (`unidad_medida_base_id`, cómo se vende/cobra el producto) — un
> producto puede venderse "por Unidad" y a la vez contener 120 ml adentro. Opcional: sin cargar, el
> selector de unidad queda deshabilitado y la etiqueta de precio de Repositores no muestra "Precio por
> L/Kg/m". El select solo ofrece las familias peso/volumen/longitud (agrupadas por `<optgroup>`), no
> conteo/área. Único consumidor hoy: la etiqueta de precio imprimible de
> [[wiki/features/repositores]] → "Qué hace la Fase 4".

### Card 2: Clasificación

| Campo | Tipo | Notas |
|-------|------|-------|
| Categoría | select | Lista del tenant |
| Proveedor | select | Lista del tenant |
| Activo / Inactivo | toggle | Inactivo bloquea ingreso de stock (soft-delete lógico) |
| Puede cobrarse en cualquier moneda | toggle | `acepta_cualquier_moneda` (mig 370) — ver nota abajo |

> [!NOTE] **Checkbox "Puede cobrarse en cualquier moneda" (mig 370, ✅ EN PROD, COMMITEADO Y PUSHEADO a
> `origin/dev` — commit `310d9b3b`, tag `v1.171.0`, commiteado 2026-08-18, deployado a PROD 2026-08-20 —
> PR #331, merge commit `4dbe7fdb`).** Nuevo campo
> `productos.acepta_cualquier_moneda` (boolean, default `false`), Fase 2 del proyecto "Caja en USD"
> (relevamiento G5, respuesta A2: cobro en USD y `moneda_venta` son independientes, pero **por producto**).
> Es **independiente** de `moneda_venta`/`precio_usd` (Card 3) — no es una decisión que tome el cajero en
> el momento de cobrar, se define de antemano en la ficha. Cableado en los 4 puntos de
> `ProductoFormPage.tsx`: estado inicial del formulario, carga desde DB al editar, payload de creación/
> edición y payload de "Duplicar producto". **Solo se persiste en esta fase** — el cobro real mixto de
> monedas (un producto en pesos cobrado en USD o viceversa) es la Fase 4 del proyecto, todavía sin
> construir. Ver [[wiki/features/caja]] → "Caja en USD — Fase 2 de 8" y [[wiki/development/reglas-negocio]]
> → "Caja en USD / Venta física en USD".
>
> ⚠️ **Recordatorio pendiente, NO resuelto todavía**: el flujo "Crear variante" (botón dentro de la ficha)
> copia `precio_venta`/`precio_costo` (ARS) del producto madre pero NO copia `moneda_venta`/`precio_usd`/
> `moneda_costo`/`precio_costo_usd` **ni** `acepta_cualquier_moneda` — una variante nueva de un producto en
> USD (o con cobro en cualquier moneda habilitado) nace silenciosamente en modo "$"/`false`. Gap
> preexistente, menor, no relacionado con lo que reportó Fede — queda anotado para una próxima pasada.

> [!NOTE] **Botón "Eliminar" individual (mig 278, ✅ PROD v1.136.0, 2026-07-19).** Hasta esta
> sesión el botón "Eliminar" de esta página en realidad hacía `UPDATE productos SET activo=false` —
> idéntico y redundante con el toggle Activo/Inactivo de arriba. Ahora hace un **hard delete real**
> (`DELETE FROM productos`) vía la RPC `eliminar_productos_fisico`, solo si el producto nunca tuvo
> actividad histórica (venta, movimiento, OC, recepción, traslado, conteo, devolución, envío, combo/
> kit); si está bloqueado, muestra el motivo ("tiene movimientos, ventas, compras..."). Mismo guard
> server-side que la acción bulk "Eliminar" de `ProductosPage` (ver tabla de acciones masivas abajo).
> Ver [[wiki/database/migraciones]] fila 278.

### Card 3: Precios

| Campo | Tipo | Notas |
|-------|------|-------|
| Precio costo | number | No required; alerta si queda en $0. Toggle "Ingresar en USD" → `precio_costo_usd`/`moneda_costo` (mig 367) |
| Precio venta ARS | number | Incluye IVA |
| Precio venta USD | number | Opcional. Selector "Moneda de venta" + toggle "Ingresar en USD" → `precio_usd`/`moneda_venta` (mig 161) |
| IVA | select | Alícuota aplicable |
| Margen objetivo | number | % — activa insightMargen en Dashboard |
| Precios mayoristas | accordion | Tabla de tiers por cantidad (migration 092), con operador (mig 306). Selector **$ / % / USD** por tier (mig 367) + enlace opcional a una línea de empaque ("desde 2 pallets") — ver [[wiki/features/precios-tiers-empaque]] |
| ~~Estos precios corresponden a~~ | ⛔ **ELIMINADO (mig 304, v1.144.0)** | Era el "ancla de precio" (`productos.nivel_precio_orden`), un bug por POSICIÓN: no se revalidaba al reordenar niveles. Hoy `precio_venta`/`precio_costo` son **SIEMPRE por unidad base** y el precio de una presentación se deriva (`base × factor_base`); el precio por volumen se carga como **tier de cantidad**. Ver [[wiki/features/estructuras-udm]] → Fase 2 y Fase 2-bis. |

> [!NOTE] **🛑 Fix bug real de persistencia USD (mig 367, 2026-08-18, reportado por Fede).** El toggle
> "Ingresar en USD" de costo/venta vivía en `useState` efímero: convertía a pesos al tipear pero
> nunca persistía que el origen era USD — al reabrir la ficha volvía a mostrar "$" y el monto USD
> original se perdía para siempre (solo sobrevivía el peso congelado a la cotización del momento de
> carga). Costo no tenía ningún equivalente persistido a `precio_usd`/`moneda_venta` (venta, mig
> 161) — se agregó `precio_costo_usd`/`moneda_costo`, mismo patrón exacto. El toggle ahora lee/
> escribe esos campos del form directamente (no hay 2do estado paralelo que pueda desincronizarse).
> De paso, los tiers mayoristas (arriba) sumaron la 3ª opción `USD`, que antes no existía — un tier
> `precio_fijo` siempre se cobraba en pesos sin mirar la moneda del producto.
>
> ⚠️ **Hallazgo aparte, NO resuelto en este fix**: las columnas `precio_costo_moneda`/
> `precio_venta_moneda` (mig 007, distintas de las de arriba) son un mecanismo huérfano — solo las
> escribe/lee el importador CSV (`ImportarProductosPage.tsx`), guardando el monto SIN convertir
> (ej. `precio_costo=45, precio_costo_moneda='USD'` significa literalmente "45 dólares", no pesos).
> Ningún otro consumidor de `precio_costo`/`precio_venta` en la app (cálculo de margen en esta misma
> ficha, POS, reportes, dashboard) respeta esa columna — todos asumen que `precio_costo`/
> `precio_venta` son SIEMPRE pesos. Si algún tenant real importó productos con costo/precio marcado
> como USD por CSV, el margen/reportes de esos productos están **silenciosamente mal calculados
> hoy**. Pendiente: (a) confirmar si algún tenant en PROD usó esa columna del importador, (b)
> decidir si el importador pasa a convertir a ARS al importar (como hace el resto de la app) o si se
> migra al patrón `precio_costo_usd`/`moneda_costo` nuevo.
>
> ✅ **CERRADO — A0 (2026-09-23, EN `dev`, SIN deploy)**: (a) confirmado, **0 tenants en PROD** usaron
> esa columna (medido el 18/09); (b) resuelto migrando el importador al patrón vivo
> (`moneda_venta`/`moneda_costo`), no al de convertir a ARS. Detalle completo, los 2 bugs que cierra y
> los 3 hallazgos nuevos que dejó (D-1/D-2/D-3) en la sección dedicada abajo: "Importador CSV — columnas
> de moneda (A0)".
>
> **🛑 Fix relacionado, distinto (2026-08-20, reportado por Fede): la LISTA de Productos (esta
> ficha ya estaba bien) ignoraba `moneda_venta`/`moneda_costo`.** `ProductosPage.tsx` mostraba
> SIEMPRE el mirror en ARS (`precio_venta`/`precio_costo`, la fuente para margen/reportes/POS) con
> `$`, en 6 lugares (fila colapsada, fila de variante, panel expandido) — nunca miraba si el
> producto estaba priceado nativamente en USD. Fix: helpers `precioVentaTexto`/`precioCostoTexto`
> (usan `formatMoneda` de `lib/formato.ts`), verificados con `tests/e2e/135_producto_lista_moneda_usd_mutante.spec.ts`
> contra DEV real. Fede pidió además auditar TODOS los lugares de la app que muestran precio/costo
> de producto y diseñar un patrón reusable pensando en más monedas a futuro — **eso no se hizo
> todavía**, es un alcance mayor (candidato a "features grandes": relevamiento → diseño → fases).
> Ver [[project_moneda_producto_pendientes_fede]] (memoria) para el detalle completo, incluidos 2
> hallazgos relacionados que quedaron DEFERIDOS a propósito (compra vs. venta en la conversión del
> carrito, y a qué sistema se refiere "solo dólar oficial de BNA") esperando que GO hable con Fede.
>
> **✅ ACTUALIZACIÓN 2026-08-24/25 — este fix ya está EN PROD**: commit `193820df` (tag `v1.179.1`)
> quedó arrastrado a producción por el deploy de v1.179.2 (PR #333, merge commit `f36ff2f4`) — ver
> `wiki/business/roadmap.md`. Los 2 hallazgos deferidos (compra vs. venta, dólar BNA) **siguen sin
> resolver**, sin cambios en esta sesión.

> [!NOTE] **🐛 Overflow horizontal en mobile (375px/360px) — fix (2026-08-24/25, ✅ EN PROD desde
> v1.179.2, PR #333).** El contenedor del buscador de `ProductosPage.tsx` no tenía `min-w-0`, así que en
> pantallas angostas el input empujaba el layout y generaba scroll horizontal. Encontrado en una revisión
> general de la app (unit + e2e completos); mismo fix aplicado en Inventario (ver
> [[wiki/features/inventario-stock]]).

### Card 4: Stock e inventario

| Campo | Tipo | Notas |
|-------|------|-------|
| Stock mínimo | number | Global; override por sucursal (migration 052) |
| Unidad de medida | select | Predefinidas + `<optgroup>` con UdM personalizadas del tenant (migration 119) |
| Ubicación predeterminada | select | Ver sección "Ubicación predeterminada por sucursal" |
| Estado inventario predeterminado | select | Estado a asignar al ingresar stock |
| Regla inventario | select | FIFO / FEFO / LEFO / LIFO / Manual |

### Card 5: Trazabilidad

| Campo | Tipo | Notas |
|-------|------|-------|
| Tiene series | toggle | Habilita tracking serial |
| Tiene lote | toggle | Habilita campo nro_lote |
| Tiene vencimiento | toggle | Habilita fecha_vencimiento + shelf_life_dias (migration 118) |
| Shelf life (días) | number | Visible solo si `tiene_vencimiento = true` |
| País de origen | toggle | `tiene_pais_origen` (ISS-113, migration 118) |
| Talle | toggle | `tiene_talle` (ISS-121, migration 118) |
| Color | toggle | `tiene_color` (ISS-121, migration 118) |
| Encaje | toggle | `tiene_encaje` (ISS-121, migration 118) |
| Formato | toggle | `tiene_formato` (ISS-121, migration 118) |
| Sabor / Aroma | toggle | `tiene_sabor_aroma` (ISS-121, migration 118) |
| Es kit | toggle | Habilita composición de kit |
| Aging profile | select | Solo si `tiene_vencimiento` |

**Campos de variante en LPN:**
Los mismos atributos (pais_origen, talle, color, encaje, formato, sabor_aroma) se capturan al ingresar stock:
- `LpnAccionesModal` tab Editar
- `InventarioPage` modal ingreso
- `RecepcionesPage` FormItem + insert en `inventario_lineas`

> [!NOTE] **✅ PROD desde v1.134.0 (2026-07-18):** talle/color/encaje/formato/sabor_aroma pasan de texto libre a un **catálogo configurable** por tenant (Config → Inventario → Atributos, mig 273), obligatorios en todo movimiento de stock cuando están activos (mismo patrón que lote), y con selección real al vender (el picker "Elegir posición de rebaje" de VentasPage bloquea el cobro si hay ambigüedad sin resolver). Estos toggles son **incompatibles con el otro modelo de variantes en el mismo producto**: originalmente contra "Grupo de variantes" (mig 274) y, desde **v1.146.0**, contra las **variantes madre/hijo** que lo reemplazaron (**mig 314**: CHECK para el hijo + trigger para la madre, además del bloqueo en la UI). Detalle completo en [[wiki/features/atributos-variante]].

### Card 6: Marketplace

Visible solo si el tenant tiene `marketplace_activo = true`.

| Campo | Tipo |
|-------|------|
| Publicar | toggle |
| Precio marketplace | number |
| Stock reservado | number |
| Descripción marketplace | textarea |

### Grupos de variantes (card entre Trazabilidad y Marketplace)

- Sin grupo: botón "Vincular a un grupo" → dropdown o "Nuevo grupo"
- Con grupo: badge "Variante de: nombre", selects/inputs por atributo del grupo, lista de otras variantes con link a editar, botón "Desvincular"
- Guardado: `grupo_id` + `variante_valores JSONB`
- **Auto-sufijo de nombre (✅ PROD v1.136.0, 2026-07-19):** al guardar un producto vinculado
  a un grupo con valores de variante cargados, el nombre se auto-completa con `— <valor>` (ej.
  "Remera Básica" → "Remera Básica — S"); si el valor cambia se despega el sufijo viejo antes de
  agregar el nuevo. Antes solo pasaba al usar "Generar variantes" desde el modal del grupo — vincular
  un producto YA EXISTENTE no lo aplicaba. Detalle y motivo en [[wiki/features/grupos-variantes]].

---

## Importador CSV — columnas de moneda (A0, 2026-09-23, EN `dev`, SIN deploy)

Commits `870d3e36` + `ca2f08f2` en `origin/dev`. **Sin migración nueva** (sigue 001-432) y **sin deploy a
PROD** — `dev` queda con este fix por encima de PROD, sin bump de `APP_VERSION` todavía. Pedido explícito
de Fede: arreglarlo ya, por separado, sin esperar al rediseño de Multimoneda.

**El bug que cierra**: `ImportarProductosPage.tsx` escribía `precio_venta_moneda`/`precio_costo_moneda`
(varchar `'ARS'|'USD'`, mig 007 — columnas **muertas**, las escribía y leía solo él mismo) y **nunca**
tocaba `moneda_venta`/`moneda_costo` (`'local'|'usd'`, las **vivas** que miran el POS, esta misma ficha, la
rentabilidad y el costo de OC — ver nota de mig 367 arriba). No hay trigger que sincronice el par. Un CSV
con `precio_venta=100` + `USD` quedaba guardado tal cual y se vendía a **$100 pesos**, ~1/1400 de su
precio real. **Medido antes de tocar nada: 0 productos afectados en DEV y en PROD** (27 productos, 5
negocios) — bug latente puro, sin plata mal cargada en ningún lado.

**Segundo bug, también cerrado**: al ACTUALIZAR por CSV un producto que estaba en USD con un precio en
pesos, se pisaba `precio_venta` pero `moneda_venta` seguía en `'usd'` — y como el POS recalcula
`precio_usd × cotización` e ignora `precio_venta` cuando la moneda es `'usd'`, la importación **no
cambiaba lo que se cobraba**. Ahora el CSV manda.

**Cómo quedó el fix**: lógica pura nueva `src/lib/importarProductosMoneda.ts` (patrón ccLogic de la casa)
con **22 tests** (`tests/unit/importarProductosMoneda.test.ts`). Usa la cotización de **COMPRA**
(`cotizacionUsdAArs`/`tasaUsdAArs`), la misma que usa el POS para valuar un producto en dólares al
cobrarlo. **Sin cotización, la fila no se importa** (regla D5 de Fede: nunca se inventa una tasa) —
validado en la vista previa y con guard en el envío. Typecheck limpio, build verde. **UAT §66, 8
escenarios.** Revisado por `code-reviewer`: sin hallazgos rojos, OK para deployar; confirmó que el camino
en pesos produce el mismo payload que antes.

Verificado contra la base real en DEV con el payload exacto (revertido después): costo 60 USD / precio
100 USD a cotización 1400 → quedó `precio_costo=84000`, `precio_costo_usd=60`, `moneda_costo='usd'`,
`precio_venta=140000`, `precio_usd=100`, `moneda_venta='usd'`, `margen_ganancia=66.67`.

> [!NOTE] **Tres hallazgos que dejó A0 — estado al 2026-09-24**: ✅ **D-1 y D-3 RESUELTOS**, sin esperar
> respuesta de GO (eran aplicación directa de reglas ya decididas, no puntos a relevar). 🟡 **D-2
> mitigado, no cerrado**. Detalle completo en la sección de abajo, "Actualización por archivo — D-3,
> D-1, D-2 y los 2 bugs 🔴 que encontró `code-reviewer` (2026-09-24)".

---

## Actualización por archivo — D-3, D-1, D-2 y los 2 bugs 🔴 que encontró `code-reviewer` (2026-09-24, EN `dev`, SIN deploy)

Commits `93448deb`, `c8e7649c`, `02568b64`, `470525c6` en `origin/dev`. **Sin migración nueva** (sigue
001-**432**) y **sin deploy a PROD** — `dev` queda con estos 4 cambios por encima de PROD, sin bump de
`APP_VERSION` todavía. Cierra los 3 hallazgos que dejó A0 (arriba) más 2 bugs 🔴 nuevos que encontraron
dos pasadas independientes de `code-reviewer`.

### D-3 ✅ — al actualizar por archivo se escribe SOLO lo que el archivo trae

Antes, actualizar por CSV/Excel reescribía las **26 columnas** del payload con los defaults de la fila,
sin importar si el archivo las traía o no. Medido sobre los 27 productos de PROD: se habrían perdido
**19** proveedores, **19** descripciones, **12** códigos de barras y **9** productos con trazabilidad
(series/lote/vencimiento) con solo exportar y reimportar sin tocar nada — y el IVA se habría resetado a
21 % en cualquier producto exento.

**Decisión de GO**: *"lo que el archivo trae manda; lo que no trae, no se toca."* Módulo nuevo
`src/lib/importarProductosActualizacion.ts` (patrón ccLogic), con `celdaTieneValor` decidiendo por
columna si el archivo la trajo (para que un `0` válido —IVA exento, margen objetivo en 0— no se
confunda con "vacío").

🛑 **La prueba de que no alcanzaba con sumarle columnas al export**: `activo` YA estaba en el archivo
que emitía "Exportar productos", y **se pisaba igual** — el payload viejo lo escribía fijo en `true`.
Exportar y reimportar sin tocar nada **reactivaba productos dados de baja**. Sumar columnas al export
sin cambiar el motor de actualización no alcanza.

### D-1 ✅ — la ficha ya usa la cotización de COMPRA, la misma que el POS

`ProductoFormPage.tsx:66` calculaba el espejo en pesos de Card 3 con la cotización de **venta**,
mientras el POS cobra a la de **compra** desde el fix del 2026-09-08 — era la mitad que había quedado
afuera de ese fix. Una línea. Ahora POS, ficha e importador usan la misma tasa. Hoy latente: 0
productos en USD en PROD.

### D-2 🟡 mitigado — aviso claro del tope de margen, el tope en sí sigue abierto

Cargar un producto que superara el margen guardable devolvía un `numeric field overflow` crudo de
Postgres, en la ficha y en el importador. Ahora los dos avisan con un mensaje claro antes de intentar
guardar (`margenEntraEnLaBase`). ⚠️ **El tope de 999,99 % sigue existiendo**: `productos.margen_ganancia`
es `GENERATED numeric(5,2)`, así que ningún producto con markup mayor todavía se puede guardar.
**Ampliar la columna es una decisión de GO todavía ABIERTA.**

### Export reimportable — de 10 a 22 columnas

El export de "Exportar productos" pasó a emitir las columnas de producto de la plantilla del
importador (booleanos como SI/NO), para poder editar en Excel y reimportar sin perder nada. No incluye
las 14 columnas `estr_*` de empaque (otra tabla): como una columna ausente significa "no tocar",
reimportar tampoco borra el empaque.

🛑 **El ida y vuelta no deforma los precios en dólares**: un producto en USD exporta con su **monto en
dólares** en la columna de precio, no con el espejo en pesos — si no, cada ida y vuelta lo multiplicaría
por la cotización otra vez. Función `montoYMonedaParaExportar` + test de identidad exportar→importar
sobre 3 productos (uno en ARS, uno en USD, uno exento).

🔒 El export deja de entregar costo y margen objetivo a los roles que no los ven en la grilla (CAJERO /
DEPÓSITO / RRHH): ocultar en la UI y no en la descarga no es ocultar nada.

### 🔴🔴 Los 2 bugs que encontró `code-reviewer` — la suite de 1.900 tests no los vio

Dos revisiones independientes de `code-reviewer` sobre el diff completo (2 pasadas) encontraron **2
bugs 🔴 en la lógica de PARSEO** de `ImportarProductosPage.tsx`, uno de ellos fiscal:

1. **IVA Exento (0 %) se convertía en 21 % al importar.** `String(row.alicuota_iva || '21')`: con `0`,
   el operador `||` devuelve `'21'` — y como 21 es un valor válido, la fila entraba **sin ningún
   error**. Es literalmente el gotcha escrito en el CLAUDE.md ("un `||default` sobre 0 convierte
   Exento en 21 %"). Ya estaba resuelto en `ProductoFormPage` con `Number.isFinite`; el importador es
   un archivo hermano que nunca recibió el mismo arreglo. Un producto exento exportado y reimportado
   sin tocar nada facturaba IVA fantasma.
2. **Traer la columna de moneda SIN el precio dejaba el precio en 0, en silencio.** El precio y su
   moneda se escriben en grupo, y una columna ausente se parsea como 0 — así que una fila con solo
   `sku` + `precio_venta_moneda` escribía `precio_venta: 0` sobre un producto real, sin ningún error en
   la vista previa. Era el CSV más natural: *"le corrijo solo la moneda a este producto"*.

**Segunda pasada** (3 hallazgos más): el aviso de margen (D-2, arriba) quedaba **ciego en las
actualizaciones parciales** — comparaba contra 0 para el lado que el archivo no trae, así que nunca
saltaba, y una fila de `sku`+`precio_venta` con un cero de más pasaba la vista previa y recién
explotaba al confirmar. Ahora el lado ausente se toma del valor real ya guardado. Y `hasEstr` (decide
si una fila trae empaque) miraba solo **7 de las 14** columnas `estr_*` — una fila con solo
`estr_largo_unidad` fallaba entera.

**4 hallazgos menores, también cerrados**: `margen_objetivo = 0` sufría el mismo `||` y la
reimportación lo borraba en vez de dejarlo en 0 · una fila que solo trae columnas de empaque sobre un
producto existente ya no falla entera · el escape del CSV contempla saltos de línea (`descripcion`/
`notas` con Enter partían la fila) · ver también el punto 🔒 de roles, arriba.

### 🛑 La lección: la lógica de parseo sin test es lógica sin cobertura

Los 2 bugs 🔴 vivían en un `.tsx` (`ImportarProductosPage.tsx`), que no tiene test unitario propio —
igual que `ProductoFormPage.tsx` y `ProductosPage.tsx`. Lo que sí está cubierto son las funciones puras
de `src/lib/` (51 tests entre `importarProductosMoneda.test.ts` e
`importarProductosActualizacion.test.ts`): ahí no hubo ningún bug.

Peor: el test que cubría "precio y moneda viajan en grupo" **usaba un fixture con el precio ya puesto a
mano**, así que nunca ejercitó el camino real donde el precio sale en 0 por ausencia de columna. Un
test que no prueba el camino real da una sensación de cobertura que no existe.

**Regla para la próxima**: si una lógica decide sobre plata o sobre lo fiscal y vive dentro de un
`.tsx`, no está testeada por más verde que esté la suite — hay que sacarla a `src/lib` antes de
confiar en ella, con fixtures que salgan del parseo real (`XLSX.utils.sheet_to_json`), no armados a
mano.

**Verificación**: UAT §66 (26 escenarios) · §67 (mig 433, ver [[wiki/features/autenticacion-onboarding]])
· §68 (7 escenarios de cobertura que faltan, `tests/specs/uat-modo-basico.md`). Typecheck limpio, build
verde.

---

## Ubicación predeterminada por sucursal (migration 121 · v1.8.31-dev)

```sql
producto_ubicacion_sucursal(
  producto_id UUID,
  sucursal_id UUID,
  ubicacion_id UUID,               -- putaway default (esta sección)
  ubicacion_exhibicion_id UUID,    -- góndola, mig 335 — ver abajo
  UNIQUE(producto_id, sucursal_id)
)
```

**Comportamiento en ProductoFormPage:**

| Contexto | Select muestra | Guarda en |
|----------|---------------|-----------|
| Con sucursal activa en header | Ubicaciones de esa sucursal + globales | `producto_ubicacion_sucursal` (upsert) |
| Sin sucursal activa (vista global) | Todas las ubicaciones | `productos.ubicacion_id` (fallback global) |

**Resolución al ingresar stock:**

1. Busca en `producto_ubicacion_sucursal` por `(producto_id, sucursal_id)` activa
2. Fallback: `productos.ubicacion_id` global
3. Operador puede modificar antes de confirmar

**Corrección bug (v1.8.31-dev):** un solo `<select>` por sucursal activa (antes renderizaba dos selects cuando la sucursal variaba durante la sesión de edición).

Patrón idéntico a `producto_stock_minimo_sucursal` (migration 052).

### Ubicación de exhibición — góndola (mig 335 + 352 · ✅ EN PROD desde v1.168.0, para el módulo Repositores)

Campo nuevo (2026-08-11) **"Ubicación de exhibición (góndola)"**, mismo bloque que "Ubicación
predeterminada" arriba pero en su propio select, filtrado a ubicaciones con `tipo_logico =
'exhibicion'` de la sucursal activa. Guarda en la MISMA fila de `producto_ubicacion_sucursal`
(columna `ubicacion_exhibicion_id`) — el upsert/delete de esa fila ahora contempla los dos campos
independientemente (no borra uno porque el otro quedó vacío).

La columna existía desde la mig 335 (rediseño de Ubicaciones) pero **no tenía ninguna UI** hasta la
mig 352 — sin ella asignada, el módulo [[wiki/features/repositores]] no genera ninguna tarea para ese
producto (sus triggers de "cambió el precio"/"entró en descuento" dependen de este campo para saber
si corresponde avisar a un repositor).

---

## Unidades de medida personalizables (migration 119 · ISS-120 · conectadas a estructuras en 282)

```sql
unidades_medida(
  tenant_id UUID,
  nombre TEXT,      -- ej: "Docena"
  simbolo TEXT,     -- ej: "doc"
  activo BOOLEAN,
  predefinida BOOLEAN  -- mig 148; seed: Unidad/Kilogramo/Gramo/Litro/Metro/Caja + Pallet (282)
)
RLS: tenant isolation
```

- CRUD en `ConfigPage` → tab "Unidades"
- En `ProductoFormPage`: selector UdM con `<optgroup label="Predefinidas">` y `<optgroup label="Personalizadas">`
- **Desde mig 282 toda UdM del tenant es elegible como NIVEL de una estructura de producto**
  (footprints con conversión caja/pallet/etc.) — ver [[wiki/features/estructuras-udm]]. Antes
  eran solo una etiqueta de texto en `productos.unidad_medida`.

---

## Defaults del producto al ingresar stock (v1.8.30-dev)

Al seleccionar un producto para ingresar stock (por scan o búsqueda), el formulario se pre-rellena con:

| Campo | Fuente |
|-------|--------|
| Ubicación | `producto_ubicacion_sucursal` (sucursal activa) → fallback `productos.ubicacion_id` |
| Estado | `productos.estado_inventario_predeterminado` |
| Proveedor | `productos.proveedor_id` |

El operador puede modificar cualquier valor antes de confirmar.

**Aplicado en:**
- `InventarioPage` — tab Agregar Stock (scan y búsqueda manual)
- `RecepcionesPage` — formulario manual y desde OC

---

## Nuevos campos (migrations 118–121)

| Campo | Tabla | Descripción |
|-------|-------|-------------|
| `marca` | `productos` | Nombre de la marca (TEXT, sin required) |
| `shelf_life_dias` | `productos` | Vida útil en días (visible si `tiene_vencimiento = true`) |
| `tiene_pais_origen` | `productos` | Toggle de variante atributo |
| `tiene_talle` | `productos` | Toggle de variante atributo |
| `tiene_color` | `productos` | Toggle de variante atributo |
| `tiene_encaje` | `productos` | Toggle de variante atributo |
| `tiene_formato` | `productos` | Toggle de variante atributo |
| `tiene_sabor_aroma` | `productos` | Toggle de variante atributo |
| `grupo_id` | `productos` | FK a `producto_grupos` (migration 120) |
| `variante_valores` | `productos` | JSONB con valores de variante del grupo (migration 120) |
| `pais_origen` | `inventario_lineas` | Valor capturado al ingresar |
| `talle` | `inventario_lineas` | Valor capturado al ingresar |
| `color` | `inventario_lineas` | Valor capturado al ingresar |
| `encaje` | `inventario_lineas` | Valor capturado al ingresar |
| `formato` | `inventario_lineas` | Valor capturado al ingresar |
| `sabor_aroma` | `inventario_lineas` | Valor capturado al ingresar |

---

## Escaneo de ticket de compra (v1.8.38)

Botón **"Escanear ticket"** en el toolbar del listado de productos (junto a "Nuevo producto").

Permite fotografiar un ticket de supermercado y comparar los productos detectados contra el catálogo:

| Estado | Ícono | Descripción | Acción disponible |
|--------|-------|-------------|-------------------|
| Encontrado, precio igual | ✅ verde | Sin cambios necesarios | — |
| Encontrado, precio diferente | ⚠️ amber | Muestra "BD: $X → Ticket: $Y" | Actualizar `precio_costo` (toggle) |
| No en catálogo | ➕ azul | Nuevo producto detectado | Crear (con precio venta editable) |
| Omitido | ✗ gris | Excluido manualmente | Reactivar con X |

**Al crear:** SKU = barcode del ticket si existe, o `NOMBRE-{timestamp}{idx}` si no.  
**Proceso:** imagen comprimida a JPEG 1200px → EF `scan-ticket` (Claude Sonnet 4.6) → matcheo DB → tabla editable → "Aplicar cambios".

Ver detalle técnico: [[wiki/features/escaneo-barcode]]

---

## 🗓️ Precio de venta con fecha/hora de vigencia — Fase 1 (mig 422, 2026-09-14, ✅ EN PROD desde el 2026-09-15)

Pedido de Fede. El relevamiento (`relevamiento-precio-programado-reglas-negocio.html`) lo respondió GO el
2026-09-14; las respuestas completas están en `log.md` (sesión cont. 68).

**Cómo se usa:** en la ficha del producto, al guardar un cambio del precio de venta aparece *"¿Desde cuándo
rige el nuevo precio?"* con **Ahora** (por defecto) o **Programar fecha y hora** (propone mañana 08:00). Si se
programa, el resto de la ficha se guarda y el precio que rige hoy **no cambia** hasta esa hora. Debajo del
precio queda el aviso "Programado: $X desde…" con acceso a **Productos → Programados**, donde se ven los
pendientes y los últimos 30 días, y se cancelan.

| Regla (relevamiento) | Cómo quedó |
|---|---|
| A1 conviven | El precio vigente rige; el nuevo queda en `precios_programados` |
| A2 uno por producto | Índice único parcial; programar otro cancela el anterior (con aviso en el modal) |
| A3 cancelar/editar | Desde Programados; lo pueden los mismos roles que cambian precios |
| A4 "ahora" por defecto | El modal abre en "Ahora" |
| A5 solo minorista | Solo `precio_venta` en pesos; con precio en USD no se ofrece programar |
| B1 carrito | Sin cambios: el POS congela el precio al agregar al carrito |
| D1 ML/TN a la hora | Sale solo: el cron hace el mismo `UPDATE OF precio_venta` que dispara `fn_enqueue_sync_precio` |
| E2 dónde se ven | Tab Programados + aviso el día anterior (09:00) a DUEÑO, SUPER_USUARIO y SUPERVISOR |
| E3 local cerrado | Lo aplica pg_cron cada minuto, no el navegador |
| E4 auditoría | `actividad_log`: `programar_precio`, `cancelar_precio_programado` y la aplicación (`precio de venta (programado)`) |

**Del lado del servidor (REGLA #0):** la tabla solo se escribe por `fn_programar_precio` /
`fn_cancelar_precio_programado`, que validan `auth_puede_editar_modulo('inventario')` — el mismo criterio que
`fn_productos_rol_guard`. Importa porque al APLICAR el cron no tiene sesión y el guard de productos lo deja pasar:
el control tiene que estar al programar. Si aplicar falla, queda `fallido` con el error y se avisa al dueño.

**Fases siguientes:** C1/C2, C3 y D2 quedaron hechas en las Fases 2-3 (sección de abajo). Queda E1, cambios
masivos (v2).

---

## 🏷️ Precio programado — Fases 2-3: la etiqueta de la góndola y el aviso de ML/TN (migs 423-424, 2026-09-15, ✅ EN PROD desde el 2026-09-15)

Cierra lo que quedaba del relevamiento. La parte de etiquetas es de modo avanzado: las tareas del repositor solo
existen para productos con góndola asignada (ver [[wiki/features/repositores]]).

| Regla (relevamiento) | Cómo quedó |
|---|---|
| C1 la tarea aparece antes | El cron de cada minuto (`fn_aplicar_precios_programados`) llama primero a `fn_generar_tareas_precio_programado`: cuando faltan `tenants.repositor_anticipacion_min` minutos o menos, crea la tarea `cambio_precio` en cada sucursal con góndola, ligada al programado (`precio_programado_id`, `vigente_desde`). La anticipación se elige en Config → Inventario → "Repositores — Etiquetas de precio": a la hora, 15 o 30 minutos, 1, 2, 4 u 8 horas, o un día (por defecto, 1 hora) |
| C2 qué precio lleva la etiqueta | El NUEVO. No se da por puesta mientras rija otro precio: lo rechaza el servidor (`fn_tarea_repositor_guard_completar`) y en Repositores el botón queda deshabilitado, con "Rige desde…" |
| C3 aviso al cajero | El POS lee las tareas de cartel abiertas de la sucursal: si lo que dice la etiqueta (`precio_anterior`) no es el precio vigente, avisa al agregar el producto y en la fila del carrito. Se cobra el precio vigente; si el cliente reclama, la diferencia va como descuento autorizado por el supervisor |
| C3 alerta | Alertas → "Etiquetas vencidas en góndola": tarea ligada a un programado cuya hora ya pasó y sigue abierta. El badge (`useAlertas`) y la página usan la misma consulta (`queryEtiquetasVencidas`). "Ver tarea" abre Repositores con la tarea resaltada |
| D2 ML/TN no toma el precio | Trigger `trg_notificar_sync_precio_fallido` en `integration_job_queue`: cuando un `sync_precio` queda `failed` (después de reintentar a 1, 2, 4 y 8 minutos, o por un error que no se reintenta) avisa a DUEÑO y SUPER_USUARIO. Si ya tienen un aviso sin leer del mismo canal de las últimas 6 horas, se suma a ese ("N productos…") |

**Casos borde decididos en el diseño:**
- **Ya había una tarea de cartel sin hacer** (un cambio anterior que nadie puso): se fusiona. `precio_anterior` no se
  toca (es lo que muestra la góndola) y se pone directamente la etiqueta del programado, a la hora: un solo viaje.
  Mientras tanto el cajero ve el aviso.
- **Cambio de precio manual antes de la hora:** no le pisa la etiqueta al programado.
- **Cancelar, reemplazar o no poder aplicar el programado:** si la góndola ya muestra el precio vigente, la tarea se
  cancela; si no, se desliga y vuelve a pedir la etiqueta del precio vigente.
- **Cancelar a mano la tarea anticipada:** no se vuelve a crear; a la hora nace la tarea común del cambio de precio,
  que queda como vencida si nadie la hace.
- **Anticipación "a la hora del cambio":** la tarea aparece al aplicarse el precio y cuenta como vencida hasta que se
  haga.

**Del lado del servidor:** `authenticated` ya no tiene INSERT ni DELETE en `tareas_repositor`, y el UPDATE quedó
por columna (estado, fechas, motivo, asignado y notas). Antes cualquier usuario del negocio podía crear, borrar o
reescribir tareas por REST, y con eso se salteaba el guard. `migration-reviewer` las dio APTAS; se aplicó su
recomendación (la rama de error del cron con subtransacción propia: sin eso, un aviso que falla revertía todos los
precios ya aplicados en ese minuto) y el guard también frena una etiqueta de un programado que terminó fallido o
cancelado sin poder desarmarse.

**Límite que conviene saber:** al cambiar un precio (programado o manual) la publicación en ML/TN solo se encola
para productos con repricing por margen o % de ajuste por canal (`fn_enqueue_sync_precio`, mig 346). Con el
checkbox "Sync precio" solo, el precio publicado no cambia. Es el comportamiento de antes; D2 avisa cuando la
publicación falla, no cuando no se intentó.

**Verificación:** 19 unit (`tests/unit/precioProgramado.test.ts`) · e2e **151** mutante (ver UAT §60) ·
migraciones verificadas en DEV (grants por columna, `security_invoker`, acentos, orden del historial) y smoke de
PostgREST con control negativo. ✅ **Deploy a PROD el 2026-09-15** (migs 422-424 aplicadas antes del merge, junto con
420-421/425-426; `md5(pg_get_functiondef)` idéntico DEV↔PROD, crons `aplicar-precios-programados` y
`notif-precios-programados-manana` activos y corriendo sin fallos) — ver [[wiki/database/migraciones]] y
`sources/raw/project_pendientes.md`.

---

## Links relacionados

- [[wiki/features/grupos-variantes]]
- [[wiki/features/atributos-variante]] — catálogo configurable de talle/color/etc. (✅ PROD, las 4 rondas)
- [[wiki/features/filtro-pildoras]] — buscador de píldoras combinable, compartido con Inventario y Picking
- [[wiki/features/inventario-stock]]
- [[wiki/features/wms]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/database/migraciones]]
- [[wiki/database/schema-overview]]
