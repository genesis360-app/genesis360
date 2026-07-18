---
title: Atributos de variante (talle / color / encaje / formato / sabor·aroma)
category: features
tags: [productos, inventario, variantes, talle, color, ventas, atributos]
sources: [CLAUDE.md, log.md]
updated: 2026-07-17
---

# Atributos de variante (talle / color / encaje / formato / sabor·aroma)

> [!WARNING] **EN DEV, SIN COMMITEAR (2026-07-17).** No mergeado a `main`, no deployado a PROD. Corre
> en el dev server local (`localhost:5173`) esperando que GO pruebe el flujo completo antes de seguir.
> Ver `log.md` entrada `[2026-07-17] update | 🧵 F3b + variantes talle/color FUNCIONALES` y el bloque
> "▶ RETOMAR ACÁ" de `project_pendientes.md`.

## Por qué existe esta página

GO reportó que "las opciones de variantes en ProductosPage no hacen nada, no son funcionales" —
puntualmente: activar el toggle "Talle" en la ficha de un producto no tenía dónde configurar los
talles válidos, y el dato no hacía nada con el inventario (ni en la venta ni en las vistas de stock).

## Dos sistemas de variantes distintos (no confundir)

Genesis360 tiene **dos** mecanismos de variante que conviven, con propósitos distintos:

| Sistema | Página / tabla | Qué es | Estado |
|---|---|---|---|
| **Grupo de variantes** | `ProductoGrupoModal.tsx` / `producto_grupos` | Cada variante es un **producto (SKU) separado** con su propio stock, precio, LPNs | ✅ Funcionaba bien, sin tocar en esta sesión. Ver [[wiki/features/grupos-variantes]] |
| **Atributos de variante** (esta página) | `ProductoFormPage` → Trazabilidad → toggles `tiene_talle`/`tiene_color`/`tiene_encaje`/`tiene_formato`/`tiene_sabor_aroma` | Atributo **descriptivo dentro del mismo SKU** — un mismo producto (p.ej. "Remera básica") tiene stock con distintos talles/colores en `inventario_lineas`, sin ser productos separados | 🟡 EN DEV — era el sistema roto, se arregló en esta sesión |

GO confirmó por AskUserQuestion cuál arreglar (el #2) y que quería un **catálogo configurable** de
valores válidos, no un campo de texto libre — mismo patrón que Estados/Ubicaciones en
Configuración → Inventario.

## Qué estaba roto

Los 5 toggles de `ProductoFormPage` (mig 118, ver [[wiki/features/productos]] Card 5 — Trazabilidad)
ya existían y las columnas `talle`/`color`/`encaje`/`formato`/`sabor_aroma` de `inventario_lineas` ya
se capturaban como **texto libre** al recibir stock (`LpnAccionesModal`, `InventarioPage` modal
ingreso, `RecepcionesPage`). Pero:

1. No había dónde definir qué valores eran válidos → riesgo de "M" / "Mediana" / "m" fragmentando el
   stock sin que nadie lo note.
2. El dato **no se leía en ningún otro lado** — ni al vender, ni en las vistas de stock agrupado. Un
   producto con "Talle" activado no distinguía sus líneas de stock por talle en ninguna pantalla.

## Qué se arregló (2026-07-17, EN DEV)

### Catálogo configurable — mig 273

`atributos_variante_valores` — **una tabla genérica** para los 5 atributos (no 5 tablas):

```sql
atributos_variante_valores
  id uuid PK · tenant_id FK
  atributo   text CHECK IN ('talle','color','encaje','formato','sabor_aroma')
  valor      text NOT NULL (no vacío)
  orden      integer default 0   -- "S, M, L, XL" en orden lógico, no alfabético
  activo     boolean default true
```

RLS tenant-scoped estándar. Índice único **case-insensitive** `(tenant_id, atributo,
lower(btrim(valor)))` — "M" y "m" no fragmentan el catálogo. Backfill: sembró con los valores DISTINCT
que ya existían como texto libre en `inventario_lineas` (dio 0 filas en DEV — nadie usaba el feature
todavía). No toca `inventario_lineas` (REGLA #0 — nunca se reescribe inventario histórico).

Ver [[wiki/database/migraciones]] fila 273.

### UI de configuración

**ConfigPage → Inventario → sub-pestaña "Atributos"** (nueva, visible en modo básico y avanzado, no
gateada por WMS): CRUD de valores por atributo, tabs Talle/Color/Encaje/Formato/Sabor·Aroma, soft-
delete `activo=false` (mismo patrón que Motivos). Ver [[wiki/features/configuracion]].

### Selects reemplazan texto libre

**`src/components/AtributoValorSelect.tsx`** (nuevo, reutilizable): `<select>` contra el catálogo del
tenant, con opción **"+ Agregar nuevo valor…"** inline que lo crea sin salir de la pantalla (para no
forzar una vuelta a Configuración antes de poder recibir stock). Usado en:

- `RecepcionesPage.tsx` (recepción de OC)
- `InventarioPage.tsx` → tab Agregar Stock, "Ingreso manual"

**`src/lib/atributosVariante.ts`** (nuevo, lib pura): `atributosDeLinea()` devuelve los atributos con
valor cargado de una línea de inventario, para renderizar badges reutilizables.

### Visibilidad en InventarioPage

Badges de talle/color/etc. agregados en:
- El picker de "Rebaje manual" (con búsqueda extendida para matchear también por esos valores)
- El panel de detalle de un movimiento
- La vista agrupada por ubicación
- La tabla de líneas por producto

`selectedLineasInfo` (resumen de selección múltiple, usado en traslados) **no** se extendió todavía —
pendiente menor.

### La parte crítica: selección real al vender (VentasPage)

Antes de tocar nada se investigó cómo funciona hoy la elección de lote/LPN al vender: **ya existe** un
picker manual "Elegir posición de rebaje" en el carrito (`lpnPickerIdx`/`overrideLpnSource`, ver
[[wiki/features/ventas-pos]] sección "Multi-LPN en carrito"). Se confirmó que **ese picker gobierna la
línea real que se descuenta al confirmar la venta** — el commit de checkout sigue el plan
`item.lpn_fuentes`/`lpn_manual_ids` del carrito ANTES de caer a FIFO/FEFO automático. No era cosmético.

Por eso la solución extiende ESE mecanismo existente en vez de inventar un flujo nuevo:

- `talle`/`color`/`encaje`/`formato`/`sabor_aroma` agregados a las interfaces `LineaDisponible`/
  `LpnFuente` y a la función pura `calcularLpnFuentes()` (`src/lib/ventasValidation.ts`) — 3 tests
  unitarios nuevos verifican que cada fuente conserva el atributo de SU línea al spanear varias
  líneas de stock, sin mezclarlos.
- Los 2 `SELECT` de `inventario_lineas` que alimentan el carrito (alta de producto al carrito +
  restauración de carrito desde `localStorage`) ganan esas columnas. Los otros `SELECT` de
  `inventario_lineas` en `VentasPage` son de consumo/commit por `linea_id` y no necesitan el atributo.
- Badges de talle/color en la fila compacta del carrito y en el picker expandido (que ahora prioriza
  mostrar talle/color sobre el LPN crudo).

## Qué queda pendiente

1. **Validación manual de GO en el dev server** (`localhost:5173`) — bloqueante para commitear/mergear.
2. **Spec e2e mutante formal** (próximo número disponible: **89**) — no se escribió en esta sesión por
   falta de browser tool disponible.
3. **`venta_item_despachos`** (ledger de trazabilidad de despacho por LPN, ver
   [[wiki/features/ventas-pos]] "ISS-075") **no** snapshotea todavía el talle/color consumido — hoy
   solo es visible en el carrito antes de confirmar, no en el historial post-venta. Mejora de
   trazabilidad razonable para una fase futura (ligada a `feedback_trazabilidad_grado_wms.md`), **no
   bloqueante** para que el feature sea "funcional" como pidió GO.
4. `selectedLineasInfo` en InventarioPage (traslados) sin extender con los atributos.

## Verde de la sesión

tsc · build · unit **1058+5** (3 nuevos de `calcularLpnFuentes`) · regresión e2e verde **sin cambios**
en 4 specs existentes que tocan las páginas modificadas (`29_recepcion_stock_mutante`,
`23_inventario_ingreso_mutante`, `04_ventas` + `19_flujo_venta_mutante`, `10_configuracion`) — confirma
que no se rompió nada existente.

## Links

- [[wiki/features/grupos-variantes]] — el otro sistema de variantes (SKU separado), no confundir
- [[wiki/features/productos]] — Card 5 Trazabilidad, los 5 toggles originales (mig 118)
- [[wiki/features/inventario-stock]] — badges y picker de rebaje manual
- [[wiki/features/ventas-pos]] — picker "Elegir posición de rebaje" que gobierna el descuento real
- [[wiki/features/configuracion]] — sub-pestaña Atributos
- [[wiki/database/migraciones]] — mig 273
