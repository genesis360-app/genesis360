// Compras · CO3 — lógica pura de costos. Sin I/O.
// E1: detección de cambio de costo al recibir.  E2: costo total de la OC con accesorios.

export const EPS_COSTO = 0.001

/** Variación porcentual del costo (nuevo vs actual). Positivo = subió. */
export function cambioCostoPct(actual: number, nuevo: number): number {
  if (actual <= EPS_COSTO) return nuevo > EPS_COSTO ? 100 : 0  // sin costo previo: si ahora hay, es "nuevo"
  return ((nuevo - actual) / actual) * 100
}

/**
 * E1 — ¿el nuevo costo recibido supera el umbral de alerta respecto del costo actual?
 * Solo alerta si hay un costo nuevo > 0 y un costo actual > 0 (si no hay actual, no es "cambio").
 */
export function superaAlertaCosto(actual: number, nuevo: number, umbralPct: number): boolean {
  if (nuevo <= EPS_COSTO || actual <= EPS_COSTO) return false
  if (umbralPct == null || umbralPct < 0) return false
  return Math.abs(cambioCostoPct(actual, nuevo)) >= umbralPct
}

export interface CostosOC {
  /** Suma de cantidad × precio_unitario de los ítems. */
  subtotalItems: number
  costoEnvio?: number | null
  costoAduana?: number | null
  costoComision?: number | null
  costoOtros?: number | null
}

/** E2 — total de la OC = ítems + costos accesorios (sin distribuir al unitario). */
export function totalOCconAccesorios(c: CostosOC): number {
  return c.subtotalItems
    + (c.costoEnvio ?? 0)
    + (c.costoAduana ?? 0)
    + (c.costoComision ?? 0)
    + (c.costoOtros ?? 0)
}
