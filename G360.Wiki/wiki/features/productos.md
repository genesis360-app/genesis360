---
title: Productos
category: features
tags: [productos, inventario, variantes, sku, marca, unidades-medida, ubicacion-sucursal, scan-ticket, vision]
sources: [CLAUDE.md, migrations 329, 330, 340, 357, 367, 370, 388, src/pages/ProductosPage.tsx]
updated: 2026-09-01
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
