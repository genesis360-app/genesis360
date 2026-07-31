// Cupones — lógica pura (Fede 25/7, módulo Comercial).
//
// Un cupón es una campaña con un monto FIJO en $ (nunca %) que se aplica sobre el TOTAL de la
// compra — independiente de cualquier descuento de producto ya aplicado a los ítems del carrito.
// Cada campaña genera hasta ~100 códigos alfanuméricos únicos de un solo uso.

export interface Cupon {
  activo: boolean
  vigencia_desde: string  // date ISO (YYYY-MM-DD)
  vigencia_hasta: string  // date ISO (YYYY-MM-DD)
  monto: number
}

/** ¿El cupón está activo y hoy cae dentro de su vigencia? Mismo criterio que `comboVigente`. */
export function cuponVigente(cupon: Cupon, hoyISO: string): boolean {
  if (!cupon.activo) return false
  if (hoyISO < cupon.vigencia_desde) return false
  if (hoyISO > cupon.vigencia_hasta) return false
  return true
}

/** Monto a descontar del total: el monto fijo del cupón, nunca más que el total (no puede dar
 *  negativo). */
export function montoDescuentoCupon(cupon: Pick<Cupon, 'monto'>, totalAntes: number): number {
  if (!(totalAntes > 0) || !(cupon.monto > 0)) return 0
  return Math.min(cupon.monto, totalAntes)
}

// Alfabeto sin caracteres ambiguos (sin O/0, sin I/1) — se lee/tipea a mano en el mostrador.
const ALFABETO_CUPON = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Un código alfanumérico al azar (cripto-random, no Math.random). */
export function generarCodigoCupon(longitud = 8): string {
  const random = new Uint32Array(longitud)
  crypto.getRandomValues(random)
  let out = ''
  for (let i = 0; i < longitud; i++) out += ALFABETO_CUPON[random[i] % ALFABETO_CUPON.length]
  return out
}

export const CUPON_CODIGOS_MAXIMO = 100

/**
 * Genera `cantidad` códigos ÚNICOS entre sí (dentro del mismo lote). Con un alfabeto de 32
 * símbolos y 8 caracteres (32^8 ≈ 1.1×10¹²) la chance de colisión al pedir 100 es despreciable,
 * pero igual se filtran duplicados por si acaso — nunca se devuelven menos de los pedidos.
 */
export function generarCodigosCupon(cantidad: number, longitud = 8): string[] {
  const n = Math.max(1, Math.min(CUPON_CODIGOS_MAXIMO, Math.floor(cantidad) || 0))
  const set = new Set<string>()
  while (set.size < n) set.add(generarCodigoCupon(longitud))
  return [...set]
}
