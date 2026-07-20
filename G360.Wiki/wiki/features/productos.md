---
title: Productos
category: features
tags: [productos, inventario, variantes, sku, marca, unidades-medida, ubicacion-sucursal, scan-ticket, vision]
sources: [CLAUDE.md]
updated: 2026-07-19
---

# Productos

Módulo de catálogo de productos. Global por tenant — mismo catálogo visible en todas las sucursales.

**Páginas:** `src/pages/ProductosPage.tsx` · `src/pages/ProductoFormPage.tsx`  
**Acceso:** todos los roles con permiso de inventario

---

## ProductosPage

CRUD de productos con búsqueda, filtros por categoría/proveedor y acciones masivas.

### Barra de búsqueda y filtros

- Search por nombre / SKU / código de barras
- Filtros: Categoría, Proveedor
- Toggle "Ver inactivos" — muestra productos con `activo = false` (opacity-60 + badge "Inactivo")
- Toggle "Agrupar variantes" (ícono Layers) — alterna entre vista plana y vista agrupada por grupos

### Vista plana (default)

- Lista todos los productos
- Badge `• Parte de "X"` bajo el nombre cuando el producto tiene `grupo_id`
- Productos inactivos: `opacity-60` + badge "Inactivo" (ISS-122)

### Vista agrupada (grupos de variantes)

- Productos sin grupo → sección "Productos individuales" (colapsable)
- Grupos como secciones expandibles con tabla de variantes: Nombre/SKU | Variante | Precio | Stock
- Botón "Editar grupo" en cada sección

### Productos inactivos (ISS-122)

- Por defecto solo se muestran productos activos
- Toggle "Ver inactivos" en barra de búsqueda
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
- Botón "Nuevo grupo" → abre `ProductoGrupoModal`
- Click en grupo → abre `ProductoGrupoModal` en modo edición

---

## ProductoFormPage — 6 cards reorganizados (v1.8.29-dev)

La página de creación/edición fue reorganizada en 6 cards temáticos. Columna derecha: Imagen + QR (solo al editar).

### Card 1: Identificación

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre | text (required) | — |
| SKU | text | Auto-generado con `calcularSiguienteSKU()` si está vacío |
| Código de barras | text | Scan con cámara disponible |
| Marca | text | Sin required (ISS-115, migration 118) |
| Descripción | textarea | — |

### Card 2: Clasificación

| Campo | Tipo | Notas |
|-------|------|-------|
| Categoría | select | Lista del tenant |
| Proveedor | select | Lista del tenant |
| Activo / Inactivo | toggle | Inactivo bloquea ingreso de stock (soft-delete lógico) |

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
| Precio costo | number | No required; alerta si queda en $0 |
| Precio venta ARS | number | Incluye IVA |
| Precio venta USD | number | Opcional |
| IVA | select | Alícuota aplicable |
| Margen objetivo | number | % — activa insightMargen en Dashboard |
| Precios mayoristas | accordion | Tabla de tiers por cantidad (migration 092) |

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

> [!NOTE] **✅ PROD desde v1.134.0 (2026-07-18):** talle/color/encaje/formato/sabor_aroma pasan de texto libre a un **catálogo configurable** por tenant (Config → Inventario → Atributos, mig 273), obligatorios en todo movimiento de stock cuando están activos (mismo patrón que lote), y con selección real al vender (el picker "Elegir posición de rebaje" de VentasPage bloquea el cobro si hay ambigüedad sin resolver). Estos toggles son **incompatibles con "Grupo de variantes"** en el mismo producto (mig 274, guard UI+DB). Detalle completo en [[wiki/features/atributos-variante]].

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
  ubicacion_id UUID,
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
- [[wiki/features/inventario-stock]]
- [[wiki/features/wms]]
- [[wiki/features/multi-sucursal]]
- [[wiki/features/escaneo-barcode]]
- [[wiki/database/migraciones]]
- [[wiki/database/schema-overview]]
