---
title: Filtro de píldoras — buscador combinable "Campo:valor" (Picking, Productos, Inventario)
category: features
tags: [filtro, busqueda, pildoras, chips, picking, productos, inventario, buscador]
sources: [src/lib/pildorasFiltro.ts, src/lib/pickingFiltro.ts, src/lib/productosFiltro.ts, src/lib/inventarioFiltro.ts, src/components/BuscadorPildoras.tsx, src/pages/PickingPage.tsx, src/pages/ProductosPage.tsx, src/pages/InventarioPage.tsx, tests/e2e/129_pildoras_filtro_productos_inventario_mutante.spec.ts]
updated: 2026-08-06
---

# Filtro de píldoras — buscador combinable "Campo:valor"

> ✅ **Generalización PROD desde v1.158.0 (deploy 2026-08-06).** El mecanismo original (Picking,
> v1.153.0) ya estaba en PROD desde v1.153.0 y no se tocó. Lo nuevo de esta iniciativa fue
> **llevarlo a Productos e Inventario**, código 100% nuevo (`pildorasFiltro.ts`,
> `productosFiltro.ts`, `inventarioFiltro.ts`) sin tocar `pickingFiltro.ts`.

## Qué es

Un buscador de texto tipo "chips" donde cada criterio se escribe como `(Campo):valor` (ej.
`Ubicación:Depósito`, `LPN:001`) y varias píldoras se combinan con un **combinador global Y/O**
(no árbol de expresiones anidado). Nació en `/picking` para resolver la ambigüedad de un buscador de
texto plano (escribir un número tomaba varios campos a la vez — LPN, SKU, Pedido, Venta, Envío, todos
candidatos). Ver [[wiki/features/wms]] → "Buscador de píldoras" para el origen completo.

## Arquitectura (tras la generalización del 2026-08-06)

```
src/lib/pildorasFiltro.ts        ← núcleo genérico NUEVO (parsing, alias, operadores,
                                     coincideValor, evaluarPildoras)
src/lib/pickingFiltro.ts         ← el original de Picking — NO TOCADO (cero riesgo sobre WMS
                                     ya en producción)
src/lib/productosFiltro.ts       ← campos nombre/sku/código, sobre el núcleo genérico
src/lib/inventarioFiltro.ts      ← campos producto/sku/código/LPN/ubicación, sobre el núcleo
src/components/BuscadorPildoras.tsx  ← genericizado: recibe `camposFiltro` por prop
```

**Decisión de diseño clave:** en vez de generalizar `pickingFiltro.ts` in-place (riesgo de romper
Picking, que corre en producción sobre tareas WMS reales), se escribió un núcleo genérico nuevo
(`pildorasFiltro.ts`) y los tres consumidores (`pickingFiltro.ts` original + los dos nuevos) conviven
sin que Picking cambie una línea de su lógica.

### `BuscadorPildoras.tsx` — de hardcodeado a genérico

Antes importaba los campos de `pickingFiltro.ts` a fuego. Ahora recibe `camposFiltro` por prop —
tipado `string` (no genérico) para simplificar la inferencia; cada página hace un cast puntual y
seguro en su callback. `PickingPage.tsx` se actualizó para pasar sus propios campos explícitos
(con el flag `numerico` que antes vivía aparte en `esCampoNumerico`) — **cero cambio de
comportamiento**, reverificado con el spec e2e real de Picking (`106`, 3/3 verde) tras el cambio.

### `inventarioFiltro.ts` — la unidad atómica es la LÍNEA (LPN)

Distinto de Productos: en Inventario el filtro combinado exige que TODOS los criterios matcheen
sobre la **MISMA línea física** (LPN), no una coincidencia repartida entre líneas distintas del
mismo producto. Ej. `(Ubicación):Depósito Y (LPN):001` exige que exista una línea que esté en
Depósito **Y** cuyo LPN contenga "001" — no alcanza con que el producto tenga alguna línea en
Depósito y otra distinta con ese LPN. Función `productoMatcheaPildoras` centraliza este criterio y
se reusa en las 2 vistas del tab Inventario (por producto y por ubicación) — antes cada vista tenía
su propio matching ad-hoc.

## Páginas migradas a filtrado 100% client-side

### `ProductosPage.tsx`

Se sacó el filtro **server-side** por `search` (Supabase `nombre.ilike / sku.ilike /
codigo_barras.eq`). Ahora trae todos los productos del tenant una sola vez (igual que ya hacía para
el resto de los filtros del panel) y el buscador de píldoras filtra 100% client-side, unificado con
categoría/marca/proveedor/etc.

### `InventarioPage.tsx` (tab Inventario, las 2 vistas)

Mismo reemplazo tanto en la vista "por producto" como "por ubicación", con la lógica de match
unificada en `productoMatcheaPildoras` (antes cada vista tenía su propio código de matching
duplicado).

### Scanners y deep-links migrados a "píldora libre"

Los 3 scanners de código de barras (Productos, Inventario) y el deep-link `/inventario?search=` que
usa `AlertasPage` para saltar a una línea vencida se migraron a crear una **píldora "libre"** (sin
campo explícito) en vez de setear un string plano en el input — mismo comportamiento efectivo para
el usuario, consistente con el nuevo modelo de datos del buscador.

## Tests

- **33 tests unitarios nuevos**: `tests/unit/pildorasFiltro.test.ts` (núcleo genérico),
  `tests/unit/productosFiltro.test.ts`, `tests/unit/inventarioFiltro.test.ts` (incluye el caso de
  "misma línea" descripto arriba).
- **e2e nuevo**: `tests/e2e/129_pildoras_filtro_productos_inventario_mutante.spec.ts` — siembra su
  propio producto único (patrón mutante, no depende de fixtures compartidos) y prueba: texto libre,
  campo explícito, combinador Y (exige ambos criterios), combinador O (alcanza con uno), en las dos
  páginas (Productos e Inventario). **2/2 verde, corrido dos veces** para confirmar estabilidad.
- Picking se reverificó sin cambios de comportamiento con el spec **106** (3/3 verde).

## Verde

`tsc --noEmit` (0 errores) · `npm run build` · suite unitaria completa (1525 tests, 96 archivos,
incluye los 33 nuevos) · e2e 106 y 129 verdes.

## Pendiente

- **Sin commitear ni deployar** — todo en el working tree local de `dev` (2026-08-06).
- Aplicar el mismo mecanismo a otros buscadores de texto plano del sistema queda **diferido a
  propósito** — no se tocó ningún otro salvo Productos/Inventario, que fue lo pedido explícitamente
  por el usuario. Retomar solo si GO lo pide.

## Links relacionados

- [[wiki/features/wms]] — origen del mecanismo (`/picking`, v1.153.0, EN PROD, sin cambios).
- [[wiki/features/productos]] — `ProductosPage.tsx`, filtro migrado.
- [[wiki/features/inventario-stock]] — tab Inventario, filtro migrado en sus 2 vistas.
- [[wiki/development/testing]] — spec e2e 129 y detalle de la deuda de `waitForTimeout`.
