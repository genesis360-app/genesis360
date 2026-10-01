// cotizacionBna — la UNA tasa con la que Genesis360 pasa dólares a pesos (D-1 fase 2).
//
// Decidido por GO el 2026-09-25 (respuestas a los 30 puntos abiertos, D-1): el tipo de cambio
// **VENDEDOR DIVISA del Banco Nación del DÍA HÁBIL ANTERIOR**. Una sola tasa en todos lados, sin
// excepción: precio de un producto en USD (POS y ficha), importador, tiers y combos en USD, costo
// sugerido de OC, valor en pesos de un pago recibido en dólares y la Bóveda (en los dos sentidos).
// Reemplaza la regla "USD→ARS a COMPRA" de v1.207.0 (Fede, 08/09).
//
// La tasa sale de `cotizaciones_bna` (mig 439) vía `fn_cotizacion_bna_vigente`, que ya resuelve "el
// día hábil anterior" como la última fecha publicada ESTRICTAMENTE anterior a hoy en Argentina
// (fines de semana y feriados salen solos: el BNA no publica).
//
// A-2: si la captura del día falla, se sigue con la ÚLTIMA conocida y se avisa mostrando su fecha.
// D5: sin ninguna cotización, la tasa es 0 y el que convierte tiene que FRENAR — nunca se inventa.

export interface CotizacionVigente {
  /** Fecha publicada por el BNA (`YYYY-MM-DD`): el día de esa cotización, no el de captura. */
  fecha: string
  /** Vendedor divisa. */
  venta: number
}

const num = (v: unknown): number => {
  // El `numeric` de Postgres llega como string ("1525.5000"): parsear siempre antes de operar.
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Normaliza la fila de `fn_cotizacion_bna_vigente` (o la respuesta de la EF). `null` si no sirve. */
export function normalizarVigente(raw: unknown): CotizacionVigente | null {
  const fila = Array.isArray(raw) ? raw[0] : raw
  if (!fila || typeof fila !== 'object') return null
  const f = fila as { fecha?: unknown; venta?: unknown }
  const venta = num(f.venta)
  const fecha = typeof f.fecha === 'string' ? f.fecha.slice(0, 10) : ''
  if (!(venta > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  return { fecha, venta }
}

/** La tasa USD→ARS del sistema. 0 = no hay; el llamador tiene que frenar (D5). */
export function tasaUsdAArs(vigente: CotizacionVigente | null | undefined): number {
  return vigente && vigente.venta > 0 ? vigente.venta : 0
}

/** Hoy en Argentina, `YYYY-MM-DD` — la misma referencia que usa `fn_cotizacion_bna_vigente`. */
export function hoyArgentina(ahora: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
}

/** Días corridos entre dos fechas `YYYY-MM-DD` (b − a). */
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/**
 * Más de esto sin cotización nueva ya no se explica por un fin de semana largo: el día hábil
 * anterior a un martes post-feriado de lunes es el viernes (4 días). 5+ = algo no está capturando.
 */
export const DIAS_COTIZACION_VIEJA = 5

export type AvisoCotizacion =
  | { tipo: 'sin_cotizacion'; texto: string }
  | { tipo: 'captura_fallida' | 'vieja'; texto: string }

/** `25/09` a partir de `2026-09-25`. */
export function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.split('-')
  return `${d}/${m}`
}

/**
 * Qué avisarle al usuario sobre la tasa en uso, o `null` si está todo bien.
 *
 * · Sin cotización → error (D5): no se puede convertir nada.
 * · La captura de hoy falló → se sigue con la anterior (A-2), pero se dice de qué día es.
 * · La vigente es de hace ≥ `DIAS_COTIZACION_VIEJA` días → aunque nadie haya visto un error, no se
 *   está capturando (feriados y fines de semana no llegan a tanto).
 */
export function avisoCotizacion(
  vigente: CotizacionVigente | null | undefined,
  capturaFallida: boolean,
  hoy: string = hoyArgentina(),
): AvisoCotizacion | null {
  if (!vigente || !(vigente.venta > 0)) {
    return { tipo: 'sin_cotizacion', texto: 'No hay cotización del dólar BNA: no se puede convertir USD a pesos.' }
  }
  if (capturaFallida) {
    return { tipo: 'captura_fallida', texto: `No se pudo actualizar desde el BNA: se usa la del ${fechaCorta(vigente.fecha)}.` }
  }
  if (diasEntre(vigente.fecha, hoy) >= DIAS_COTIZACION_VIEJA) {
    return { tipo: 'vieja', texto: `La última cotización es del ${fechaCorta(vigente.fecha)}: verificá que se esté actualizando.` }
  }
  return null
}
