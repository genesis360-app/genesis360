# Plan de escenarios testeables — Módulo Inventario

> Generado a partir del código real (`src/lib/unidades.ts`, `src/lib/rebajeSort.ts`,
> `src/lib/ventasValidation.ts::calcularLpnFuentes`). Confirmado contra el código.
>
> Estilo de molde: `tests/unit/lpnFuentes.test.ts` (lógica pura, `.toEqual`).
>
> **Estado actual de cobertura:**
> - `rebajeSort.ts::getRebajeSort` + `calcularLpnFuentes` → **ya cubiertos** por
>   `tests/unit/lpnFuentes.test.ts` (sort FEFO/FIFO/LIFO + elección de LPN, distribución 2 fases
>   del BUG-LPN/BUG-RACE).
> - `unidades.ts` (conversión kg↔gr, lt↔ml; compatibilidad; formato) → **SIN cubrir**. Es lógica
>   pura usada en movimientos (operario ingresa kg, el producto está en gr). Riesgo medio: una
>   conversión mal hecha rebaja/ingresa stock en cantidad equivocada.
>
> **Prioridad por riesgo:** 🔴 alta = mueve/cuantifica stock · 🟡 media = compatibilidad/UX.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Escenarios totales | 17 |
| `unit` | 17 |
| Ya cubiertos (rebajeSort/lpnFuentes) | aparte en `lpnFuentes.test.ts` |
| Faltan (unidades) | 17 |

---

## Sección 1 — Conversión de unidades (🔴 INV-CONV)

**Fuente:** `unidades.ts::convertirUnidad`. `kg↔gr` (×1000 / ×0.001), `lt↔ml`. `desde===hasta`
devuelve la cantidad sin tocar. Par no soportado → `null`. Resultado redondeado a `toPrecision(10)`.

| # | Given | When | Then |
|---|---|---|---|
| INV-CONV-01 | 1.5 kg → gr | `convertirUnidad(1.5,'kg','gr')` | `1500` |
| INV-CONV-02 | 500 gr → kg | `convertirUnidad(500,'gr','kg')` | `0.5` |
| INV-CONV-03 | 2 lt → ml | `convertirUnidad(2,'lt','ml')` | `2000` |
| INV-CONV-04 | misma unidad | `convertirUnidad(7,'kg','kg')` | `7` (sin tocar) |
| INV-CONV-05 | case-insensitive | `convertirUnidad(1,'KG','GR')` | `1000` |
| INV-CONV-06 | par no soportado kg→lt | `convertirUnidad(1,'kg','lt')` | `null` |
| INV-CONV-07 | unidad desconocida | `convertirUnidad(1,'u','kg')` | `null` |
| INV-CONV-08 | precisión sin floating error | `convertirUnidad(0.001,'kg','gr')` | `1` (no 0.9999…) |

## Sección 2 — Compatibilidad (🟡 INV-COMP)

**Fuente:** `unidades.ts::unidadesCompatibles` / `tieneConversion`.

| # | Given | When | Then |
|---|---|---|---|
| INV-COMP-01 | kg | `unidadesCompatibles('kg')` | `['gr']` (sin incluirse a sí misma) |
| INV-COMP-02 | lt | `unidadesCompatibles('lt')` | `['ml']` |
| INV-COMP-03 | unidad sin conversión | `unidadesCompatibles('u')` | `[]` |
| INV-COMP-04 | case-insensitive | `unidadesCompatibles('KG')` | `['gr']` |
| INV-COMP-05 | tiene conversión kg↔gr | `tieneConversion('kg','gr')` | `true` |
| INV-COMP-06 | misma unidad | `tieneConversion('kg','kg')` | `true` |
| INV-COMP-07 | sin conversión | `tieneConversion('kg','lt')` | `false` |

## Sección 3 — Formato (🟡 INV-FMT)

**Fuente:** `unidades.ts::formatUnidad` (locale es-AR, máx 3 decimales).

| # | Given | When | Then |
|---|---|---|---|
| INV-FMT-01 | 1.5 kg | `formatUnidad(1.5,'kg')` | `'1,5 kg'` (decimal es-AR) |
| INV-FMT-02 | 1000 gr | `formatUnidad(1000,'gr')` | `'1.000 gr'` (miles es-AR) |

---

## Notas

- `unidades.ts` ya es lógica pura: solo se le agregan tests (sin refactor).
- `rebajeSort`/`calcularLpnFuentes` no se re-testean acá (cubiertos en `lpnFuentes.test.ts`).
- Fuera de alcance unit: el trigger `recalcular_stock` (corre en Postgres) y la distribución
  real del rebaje en 2 fases contra Supabase (e2e).
