// A0 — Cómo el importador de productos traduce la moneda del CSV a las columnas que la app lee.
//
// Respuesta de Fede al relevamiento de Multimoneda (2026-09-20): *"arreglarlo ya, por separado, sin
// esperar al proyecto multimoneda"*. Fuente:
// `G360.Wiki/sources/raw/relevamiento_multimoneda_respuestas.md`, sección A0.
//
// 🛑 El bug que cierra: el importador escribía `precio_venta_moneda` / `precio_costo_moneda`
// (varchar 'ARS'|'USD') y NUNCA tocaba `moneda_venta` / `moneda_costo` ('local'|'usd'), que son las
// que miran el POS, la ficha, rentabilidad y el costo de las OC. Las primeras son columnas MUERTAS:
// las escribía y las leía solo este importador, y ningún trigger sincroniza los dos pares. O sea que
// un CSV con `precio_venta=100` + `USD` se guardaba como 100 y se vendía a **$100 pesos**, ~1/1400
// de su precio.
//
// 🛑 Segundo bug, más silencioso, que también cierra: al ACTUALIZAR por CSV un producto que estaba
// en dólares con un precio en pesos, antes se pisaba `precio_venta` pero `moneda_venta` seguía en
// 'usd' — y como el POS recalcula `precio_usd × cotización` e ignora `precio_venta` cuando la moneda
// es 'usd', la importación no cambiaba el precio cobrado. El CSV manda: si viene en ARS, el producto
// queda en ARS.
//
// Las columnas muertas se siguen escribiendo aparte (no acá) para no romper la vista previa ni el
// histórico; se eliminan dentro del rediseño de Multimoneda.

/** Lo que la app lee de verdad para el precio de venta o el de costo de un producto. */
export interface MonedaProductoImportada {
  /** Espejo en PESOS. Es la fuente de margen, reportes y listados. */
  precioArs: number
  /** Monto en dólares. Fuente real cuando `moneda === 'usd'`; `null` si el producto va en pesos. */
  precioUsd: number | null
  /** Columna viva: `'local'` (moneda del negocio) o `'usd'`. */
  moneda: 'local' | 'usd'
}

/**
 * Traduce un importe del CSV + su moneda a las columnas vivas.
 *
 * `cotizacionUsdAArs` tiene que ser la tasa de **COMPRA** (`tasaUsdAArs`), que es con la que el POS
 * valúa un producto en dólares al cobrarlo. Con la de venta, el espejo en pesos quedaría por encima
 * de lo que realmente se cobra y el margen mentiría.
 *
 * Devuelve `null` si la fila pide USD y no hay cotización: **nunca se inventa una tasa** (D5 del
 * relevamiento). Quien llama tiene que rechazar la fila, no seguir con un cero.
 */
export function monedaProductoImportada(
  importe: number,
  monedaCsv: string,
  cotizacionUsdAArs: number,
): MonedaProductoImportada | null {
  const enUsd = String(monedaCsv ?? '').trim().toUpperCase() === 'USD'

  if (!enUsd) {
    return { precioArs: importe, precioUsd: null, moneda: 'local' }
  }

  // Sin cotización no hay conversión posible. Devolver el importe "como si fueran pesos" es
  // exactamente el bug que esto viene a cerrar.
  if (!Number.isFinite(cotizacionUsdAArs) || cotizacionUsdAArs <= 0) return null

  return {
    precioArs: Math.round(importe * cotizacionUsdAArs * 100) / 100,
    precioUsd: importe,
    moneda: 'usd',
  }
}

/**
 * Tope del margen que la base puede guardar.
 *
 * 🛑 `productos.margen_ganancia` es una columna GENERATED ALWAYS —
 * `((precio_venta - precio_costo) / precio_costo) * 100`— declarada `numeric(8,2)` (mig 436; antes
 * `numeric(5,2)`, con techo 999,99 %, que rechazaba precios legítimos: un café de $30 a $1.500 da
 * 4.900 %). Por encima de 999.999,99 % Postgres tira un `numeric field overflow` crudo, que no le
 * dice nada a nadie: a ese nivel es un error de carga, no un precio.
 */
export const MARGEN_MAX_PCT = 999999.99

/**
 * Red de seguridad del importador para filas con el costo y el precio en monedas DISTINTAS.
 *
 * Hasta la mig 436 el techo de la columna (999,99 %) frenaba de rebote el error típico de un CSV que
 * mezcla monedas: costo en ARS contra precio en USD deja el precio multiplicado por la cotización
 * (150 ARS contra 100 USD a 1400 = 93.233 %). Al ampliar la columna esa fila habría entrado en
 * silencio con un precio inflado, así que se conserva el mismo umbral SOLO para ese caso.
 */
export const MARGEN_SOSPECHOSO_MONEDAS_MEZCLADAS_PCT = 999.99

/** El margen que va a calcular la base, en %. `null` si no se puede calcular (costo 0 o negativo). */
export function margenGenerado(precioCostoArs: number, precioVentaArs: number): number | null {
  if (!(precioCostoArs > 0)) return null
  return Math.round(((precioVentaArs - precioCostoArs) / precioCostoArs) * 100 * 100) / 100
}

/** ¿Este par de precios entra en `margen_ganancia` (`numeric(8,2)`)? */
export function margenEntraEnLaBase(precioCostoArs: number, precioVentaArs: number): boolean {
  const m = margenGenerado(precioCostoArs, precioVentaArs)
  if (m === null) return true // la base guarda 0 cuando el costo es 0: nunca desborda
  return Math.abs(m) <= MARGEN_MAX_PCT
}

/** Fila con monedas mezcladas cuyo margen delata que el costo y el precio no están en la misma moneda. */
export function margenSospechosoPorMonedas(precioCostoArs: number, precioVentaArs: number): boolean {
  const m = margenGenerado(precioCostoArs, precioVentaArs)
  if (m === null) return false
  return Math.abs(m) > MARGEN_SOSPECHOSO_MONEDAS_MEZCLADAS_PCT
}

/**
 * La inversa de `monedaProductoImportada`: cómo sale un precio al EXPORTAR productos, para que el
 * archivo se pueda volver a importar sin deformarse.
 *
 * 🛑 Si el producto está en dólares hay que exportar el **monto en dólares** (`precio_usd`), no el
 * espejo en pesos: el importador interpreta la columna según `precio_*_moneda`, así que exportar el
 * espejo con la moneda en `USD` lo multiplicaría por la cotización en cada ida y vuelta.
 */
export function montoYMonedaParaExportar(
  precioArs: number | null | undefined,
  precioUsd: number | null | undefined,
  moneda: string | null | undefined,
): { monto: number; moneda: 'ARS' | 'USD' } {
  if (moneda === 'usd') {
    return { monto: Number(precioUsd) || 0, moneda: 'USD' }
  }
  return { monto: Number(precioArs) || 0, moneda: 'ARS' }
}
