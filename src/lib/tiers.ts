/**
 * Lógica pura de tiers de precio mayorista con OPERADOR (rediseño UoM Fase 2-bis, mig 306).
 *
 * Un tier declara un `operador` ('>','<','=','>=','<=') + una `cantidad` (en unidades base) + un
 * `precio` por unidad. Los tiers se evalúan en el ORDEN que el usuario los cargó (asc); gana el
 * PRIMER tier que matchea contra la cantidad total del SKU. Si ninguno aplica, el llamador usa el
 * precio base por unidad (precioTier devuelve null).
 *
 * Decisión de negocio (Fede, 2026-07-24): la cantidad que se compara es el TOTAL del SKU en el
 * carrito (agregación por SKU, no por línea) — el precio mayorista es por VOLUMEN, no por bulto.
 * La agregación la arma el POS; esta lib solo resuelve la regla contra una cantidad ya sumada.
 */

export type TierOperador = '>' | '<' | '=' | '>=' | '<='

export interface TierMayorista {
  /** Valor de comparación en unidades base (nombre legacy `cantidad_minima`). */
  cantidad_minima: number
  precio: number
  operador: TierOperador
  orden: number
}

/** ¿La cantidad satisface la regla `cantidad <operador> valor`? */
export function matchTier(cantidad: number, valor: number, op: TierOperador): boolean {
  switch (op) {
    case '>':  return cantidad > valor
    case '<':  return cantidad < valor
    case '=':  return cantidad === valor
    case '>=': return cantidad >= valor
    case '<=': return cantidad <= valor
    default:   return false
  }
}

/**
 * Precio por unidad del PRIMER tier (en `orden` asc) que matchea la cantidad total del SKU.
 * Devuelve null si ninguno aplica (el llamador usa el precio base por unidad). Ignora tiers con
 * datos inválidos (precio negativo, cantidad no finita).
 */
export function precioTier(tiers: TierMayorista[], cantidad: number): number | null {
  if (!tiers || tiers.length === 0) return null
  const ordenados = [...tiers].sort((a, b) => a.orden - b.orden)
  for (const t of ordenados) {
    if (!Number.isFinite(t.cantidad_minima) || !(t.precio >= 0)) continue
    if (matchTier(cantidad, t.cantidad_minima, t.operador)) return t.precio
  }
  return null
}

/** El mejor precio mayorista (el más barato) — para el canal que fuerza lista mayorista sin mirar
 *  cantidad. null si no hay tiers válidos. */
export function mejorPrecioMayorista(tiers: TierMayorista[]): number | null {
  const validos = (tiers ?? []).filter(t => t.precio >= 0)
  if (validos.length === 0) return null
  return validos.reduce((min, t) => Math.min(min, t.precio), Infinity)
}

/** Etiqueta corta del operador para la UI. */
export const OPERADORES_TIER: { valor: TierOperador; label: string }[] = [
  { valor: '>=', label: '≥ (o más)' },
  { valor: '=',  label: '= (exacto)' },
  { valor: '>',  label: '> (más de)' },
  { valor: '<=', label: '≤ (o menos)' },
  { valor: '<',  label: '< (menos de)' },
]
