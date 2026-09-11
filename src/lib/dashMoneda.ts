// dashMoneda — el modo de moneda del Dashboard (G1, "modo real" pedido por Fede).
//
// Los tres modos NO son tres monedas: son tres formas de leer los mismos números.
//
//   · ARS  → todo en pesos. Lo que nació en dólares se convierte a la cotización de HOY
//            antes de sumar. Es una VISTA en pesos, no un dato histórico exacto.
//   · USD  → lo mismo, dividido por la cotización de hoy. Vista de referencia: dice cuánto
//            vale hoy en dólares, NO cuánta plata se movió realmente en dólares.
//   · REAL → sin convertir nada. Lo que nació en pesos se muestra en pesos y lo que nació en
//            dólares se muestra en dólares, en DOS números separados que nunca se suman.
//
// El patrón "REAL" no se inventa acá: ya existía en el KPI "Ingreso Neto de Caja" del
// Dashboard (dos acumuladores según `caja_movimientos.moneda`, el USD como leyenda aparte).
// Este archivo lo extrae para poder aplicarlo en Ventas y Gastos sin duplicar el criterio.
//
// ⚠ REGLA #0 — dónde vive la moneda real de cada tabla:
//   · `gastos` / `gastos_fijos` / `ordenes_compra` / `caja_movimientos` → columna `moneda`
//     propia, y el monto está EXPRESADO en esa moneda (una OC en USD guarda dólares).
//   · `ventas` → NO tiene columna `moneda`. `ventas.total` está SIEMPRE en pesos, incluso
//     cuando la venta tuvo un componente en dólares; `cotizacion_usd` (mig 368) solo marca
//     que hubo una conversión (producto priceado en USD o pago en USD). El sistema no guarda
//     cuánta plata de esa venta fue realmente en dólares: no hay `moneda` en `venta_items` ni
//     monto USD en `ventas`. Por eso el bucket USD de ventas se informa como "equivalente en
//     pesos" y NUNCA como una cifra en dólares — sería un número inventado.

export type ModoMoneda = 'ARS' | 'USD' | 'REAL'

/** El `numeric` de Postgres llega como string ("21.00") — normalizar siempre antes de sumar. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Divisor de conversión del modo. REAL nunca convierte; ARS tampoco. */
export function convDash(modo: ModoMoneda, cotizacion: number): number {
  return modo === 'USD' && cotizacion > 0 ? cotizacion : 1
}

/** Símbolo del número principal del modo. En REAL el principal es el de pesos. */
export function symDash(modo: ModoMoneda): string {
  return modo === 'USD' ? 'U$D ' : '$'
}

/** Formato del número principal según el modo (pesos, o pesos/cotización en modo USD). */
export function fmtDash(v: number, modo: ModoMoneda, cotizacion: number): string {
  const val = num(v) / convDash(modo, cotizacion)
  return `${symDash(modo)}${val.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

/** Formato de un monto que ES dólares de verdad (nunca convertido). */
export function fmtUsdDash(v: number): string {
  return `US$${num(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export interface SplitMoneda {
  ars: number
  usd: number
  cantArs: number
  cantUsd: number
}

/**
 * Suma filas manteniendo cada moneda en su propio acumulador — nunca las mezcla.
 * Para tablas con columna `moneda` propia, donde el monto está expresado en esa moneda.
 * Cualquier moneda que no sea 'USD' cuenta como pesos (el default de la DB es 'ARS' y no hay
 * una tercera moneda soportada: meter algo desconocido en el bucket USD sería peor).
 */
export function sumarPorMonedaNativa<T>(
  rows: T[] | null | undefined,
  getMonto: (r: T) => unknown,
  getMoneda: (r: T) => unknown,
): SplitMoneda {
  const out: SplitMoneda = { ars: 0, usd: 0, cantArs: 0, cantUsd: 0 }
  for (const r of rows ?? []) {
    const monto = num(getMonto(r))
    if (String(getMoneda(r) ?? 'ARS').toUpperCase() === 'USD') {
      out.usd += monto; out.cantUsd++
    } else {
      out.ars += monto; out.cantArs++
    }
  }
  return out
}

/**
 * Aplana un split a la "vista en pesos" (modos ARS y USD).
 *
 * `usdSinConvertir` sale > 0 cuando hay dólares pero no hay cotización cargada: en ese caso NO
 * se inventa una tasa ni se suman los dólares como si fueran pesos — quedan afuera del total y
 * la UI tiene que avisarlo. Plata que desaparece en silencio de un total es justo lo que la
 * REGLA #0 no tolera.
 */
export function aVistaPesos(s: SplitMoneda, cotizacion: number): { total: number; usdSinConvertir: number } {
  if (s.usd === 0) return { total: s.ars, usdSinConvertir: 0 }
  if (cotizacion > 0) return { total: s.ars + s.usd * cotizacion, usdSinConvertir: 0 }
  return { total: s.ars, usdSinConvertir: s.usd }
}

/** El número que corresponde al modo: en REAL el principal es solo la pata en pesos. */
export function totalDelModo(s: SplitMoneda, modo: ModoMoneda, cotizacion: number): number {
  return modo === 'REAL' ? s.ars : aVistaPesos(s, cotizacion).total
}

/**
 * Separa ventas por si involucraron una conversión USD (`cotizacion_usd` no nulo, mig 368).
 * OJO: el `total` de AMBOS grupos está en pesos — ver el encabezado del archivo. Este split
 * sirve para no mezclar en un mismo indicador ventas atadas a un tipo de cambio con ventas
 * que no lo están, no para obtener una cifra en dólares.
 */
export function separarVentasUsd<T extends { cotizacion_usd?: unknown }>(
  ventas: T[] | null | undefined,
): { ars: T[]; conUsd: T[] } {
  const ars: T[] = [], conUsd: T[] = []
  for (const v of ventas ?? []) {
    if (v.cotizacion_usd == null || num(v.cotizacion_usd) <= 0) ars.push(v); else conUsd.push(v)
  }
  return { ars, conUsd }
}

/**
 * Dólares efectivamente cobrados en una venta.
 *
 * `ventas.medio_pago` es un JSON string `[{tipo, monto, monto_usd?}]`: `monto` es SIEMPRE el
 * equivalente en pesos (y ya está adentro de `ventas.total`), y `monto_usd` — solo en los medios
 * de efectivo en dólares, G5 Fase 4 — son los dólares que entraron de verdad.
 *
 * Es la ÚNICA cifra en dólares reales que una venta guarda. Ojo: no se suma al total en pesos,
 * es otra mirada sobre la misma plata. Un medio en USD que quedó sin `monto_usd` cuenta 0 a
 * propósito: inventar el dólar dividiendo el monto en pesos por la cotización de hoy daría una
 * cifra distinta a la que realmente se cobró.
 */
export function usdCobradoDeMedioPago(medioPago: unknown): number {
  let medios: unknown = medioPago
  if (typeof medioPago === 'string') {
    try { medios = JSON.parse(medioPago || '[]') } catch { return 0 }
  }
  if (!Array.isArray(medios)) return 0
  return medios.reduce((a: number, m: any) => {
    const v = num(m?.monto_usd)
    return a + (v > 0 ? v : 0)
  }, 0)
}
