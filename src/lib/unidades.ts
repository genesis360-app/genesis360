/**
 * Helpers de conversión de unidades de medida.
 *
 * Uso típico en movimientos: el producto está en gramos pero el operario
 * ingresa kilos. Se convierte antes de guardar en DB.
 *
 * Conversiones soportadas:
 *   kg ↔ gr   (1 kg = 1000 gr)
 *   lt ↔ ml   (1 lt = 1000 ml)
 *
 * Para otros pares se retorna null (sin conversión disponible).
 */

export type UnidadMedida = string  // 'kg' | 'gr' | 'lt' | 'ml' | 'u' | etc.

/** Mapa de conversión directa: desde → hacia → factor multiplicador */
const CONVERSION_MAP: Record<string, Record<string, number>> = {
  kg:  { gr: 1000,   kg: 1 },
  gr:  { kg: 0.001,  gr: 1 },
  lt:  { ml: 1000,   lt: 1 },
  ml:  { lt: 0.001,  ml: 1 },
}

/**
 * Convierte `cantidad` de `desde` a `hasta`.
 * Retorna null si el par de unidades no tiene conversión definida.
 * Retorna la misma cantidad si `desde === hasta`.
 */
export function convertirUnidad(
  cantidad: number,
  desde: UnidadMedida,
  hasta: UnidadMedida
): number | null {
  const d = desde.toLowerCase()
  const h = hasta.toLowerCase()
  if (d === h) return cantidad
  const factor = CONVERSION_MAP[d]?.[h]
  if (factor == null) return null
  return parseFloat((cantidad * factor).toPrecision(10))
}

/**
 * Retorna los pares de unidades compatibles con `unidad`.
 * Ej: 'kg' → ['gr']  |  'gr' → ['kg']
 */
export function unidadesCompatibles(unidad: UnidadMedida): UnidadMedida[] {
  const u = unidad.toLowerCase()
  return Object.keys(CONVERSION_MAP[u] ?? {}).filter(k => k !== u)
}

/**
 * True si existe conversión entre `a` y `b`.
 */
export function tieneConversion(a: UnidadMedida, b: UnidadMedida): boolean {
  return convertirUnidad(1, a, b) !== null
}

/**
 * Formatea la cantidad con su unidad.
 * Ej: formatUnidad(1.5, 'kg') → '1.5 kg'
 */
export function formatUnidad(cantidad: number, unidad: UnidadMedida): string {
  return `${cantidad.toLocaleString('es-AR', { maximumFractionDigits: 3 })} ${unidad}`
}
