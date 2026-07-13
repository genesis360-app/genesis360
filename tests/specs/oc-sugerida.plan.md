# Plan de escenarios — OC sugerida (auto-draft de órdenes de compra desde stock bajo mínimo)

Fuente de la lógica pura: `src/lib/ocSugerida.ts` (extraída de
`AlertasPage.generarOCsSugeridas`). Tests: `tests/unit/ocSugerida.test.ts`.
Botón: Alertas → "Generar OC sugerida" (visible en ambos modos desde v1.126.0).

## Flujo

1. El usuario elige una sucursal específica (no "Todas") y hace clic en "Generar OC sugerida".
2. Se toman las alertas `tipo='stock_minimo'` con producto, se buscan sus `proveedor_productos`,
   se agrupan por proveedor y se crea **una OC borrador por proveedor** con sus ítems.
3. Redirige a Proveedores → tab Órdenes de compra.

## Cobertura actual (unit — lock de comportamiento)

- OC-SUG-01: agrupa por proveedor; faltante = `stock_minimo − stock_actual`.
- OC-SUG-02: proveedores distintos → una OC por proveedor.
- OC-SUG-03: producto sin proveedor → `sinProveedor` (no entra a ninguna OC).
- OC-SUG-04: `cantidad = max(faltante, cantidad_minima, 1)`.

## 🐛 Bugs conocidos (a corregir — GO 2026-07-12, revisar tras cerrar facturación)

| # | Bug | Síntoma | Estado |
|---|-----|---------|--------|
| BUG1 | **NO consolida por producto** — genera una línea POR ALERTA | **Caso GO:** clic en "Generar OC sugerida" creó una OC con **varias líneas del mismo SKU** (2 unidades c/u) en vez de UNA línea con la cantidad total según el maestro. Pasa cuando hay >1 alerta `stock_minimo` del mismo `producto_id` (p.ej. una por sucursal). | lockeado en OC-SUG-BUG1 · fix en `it.todo` |
| BUG2 | `faltante` usa el **stock GLOBAL** del maestro (`productos.stock_actual/stock_minimo`), no el stock por sucursal que dispara la alerta | La cantidad pedida puede no corresponder al faltante real de la sucursal seleccionada | `it.todo` |
| BUG3 | Elige un **proveedor arbitrario** (el primer `proveedor_producto`) si el producto tiene varios | OC al proveedor equivocado / no determinístico | `it.todo` |
| BUG4 | Sin **dedup** contra OC abiertas existentes | Regenerar (o doble clic) duplica OC del mismo proveedor/producto | `it.todo` |
| BUG5 | `precio = precio_compra ?? null` | Si el `proveedor_producto` no tiene precio, la OC sale con línea sin precio (total incompleto) | lockeado en OC-SUG-BUG5 · fix en `it.todo` |

## Fix propuesto (BUG1, el reportado)

Consolidar por `producto_id` ANTES de armar los ítems: sumar/tomar una vez el faltante del
producto (idealmente el faltante por sucursal, BUG2), una línea por SKU. Al implementarlo, los
tests OC-SUG-BUG1/BUG5 pasan a asertar el comportamiento corregido y se destildan los `it.todo`.

## Pendiente de cobertura (no-unit)

- e2e/UAT: clic real en "Generar OC sugerida" → verificar la OC creada (mutante; crea OC en DEV).
  Diferido hasta el fix (hoy documentaría el bug). UAT ALR-OC-01 marcado 🐞.
