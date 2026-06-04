// Lógica pura de ajustes de conteo (Conteos 2.0 · F3). Sin I/O.
// Gate de autorización (D), doble conteo de discrepancias (C) y reconciliación por delta (G1).

export interface UmbralConfig {
  u?: number | null      // umbral en unidades
  pct?: number | null    // umbral en %
  valor?: number | null  // umbral en valor $ (|diff| * costo)
}

export const EPS_CONTEO = 0.001

/**
 * ¿La diferencia supera ALGÚN umbral configurado? (unidades OR % OR valor $).
 * Si ningún umbral está configurado (todos null/0) → false.
 * (C1/D2 — umbral combinado para kiosco [u/%] y óptica [$]).
 */
export function superaUmbral(diffAbs: number, esperada: number, valorDiffAbs: number, c: UmbralConfig): boolean {
  if (c.u != null && c.u > 0 && diffAbs >= c.u) return true
  if (c.pct != null && c.pct > 0 && esperada > 0 && (diffAbs / esperada) * 100 >= c.pct) return true
  if (c.valor != null && c.valor > 0 && valorDiffAbs >= c.valor) return true
  return false
}

/**
 * Gate de autorización (D1): si el gate está inactivo → TODO ajuste con diferencia requiere autorización;
 * si está activo → solo los que superen algún umbral. Sin diferencia (< EPS) nunca requiere.
 */
export function requiereAutorizacion(gateActivo: boolean, diffAbs: number, esperada: number, valorDiffAbs: number, c: UmbralConfig): boolean {
  if (diffAbs < EPS_CONTEO) return false
  if (!gateActivo) return true
  return superaUmbral(diffAbs, esperada, valorDiffAbs, c)
}

/**
 * Doble conteo (C1): ¿la diferencia amerita recontar antes de ajustar? Solo si supera el umbral de reconteo.
 * Sin umbrales configurados → no se exige reconteo.
 */
export function requiereReconteo(diffAbs: number, esperada: number, valorDiffAbs: number, c: UmbralConfig): boolean {
  if (diffAbs < EPS_CONTEO) return false
  return superaUmbral(diffAbs, esperada, valorDiffAbs, c)
}

/**
 * Reconciliación por delta (G1): el nuevo stock de la línea = stock vivo + (contado - esperada_snapshot).
 * Si no hubo movimientos entre el snapshot y el cierre (vivo == esperada_snapshot) → resultado = contado.
 * Si hubo (p.ej. ventas), respeta esos movimientos en lugar de pisarlos. Nunca queda negativo.
 */
export function reconciliarDelta(vivo: number, contada: number, esperadaSnapshot: number): number {
  return Math.max(0, vivo + (contada - esperadaSnapshot))
}
