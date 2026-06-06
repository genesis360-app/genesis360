// Compras · CO2 — lógica pura de recepción robusta. Sin I/O.
// Resuelve el acumulado recibido por ítem de OC entre MÚLTIPLES recepciones (B5),
// el estado resultante de la OC y los guards de over/under-receipt (B3/B4).

export const EPS_RECEP = 0.001

/** Estado de una OC según el recibido acumulado de sus ítems. */
export type EstadoOCRecepcion = 'recibida' | 'recibida_parcial' | 'sin_recibir'

export interface ItemRecibido {
  /** Cantidad pedida en la OC para este ítem. */
  esperada: number
  /** Cantidad recibida ACUMULADA (suma de todas las recepciones confirmadas). */
  recibidoAcum: number
}

/**
 * B5 — estado de la OC a partir del acumulado de TODOS sus ítems.
 * - recibida: todos los ítems alcanzaron (o superaron) lo pedido.
 * - recibida_parcial: se recibió algo pero falta.
 * - sin_recibir: no se recibió nada.
 */
export function estadoOCdesdeRecibido(items: ItemRecibido[]): EstadoOCRecepcion {
  if (items.length === 0) return 'sin_recibir'
  let algo = false
  let todoCompleto = true
  for (const it of items) {
    if (it.recibidoAcum > EPS_RECEP) algo = true
    if (it.recibidoAcum + EPS_RECEP < it.esperada) todoCompleto = false
  }
  if (todoCompleto) return 'recibida'
  return algo ? 'recibida_parcial' : 'sin_recibir'
}

/**
 * B3 — ¿el recibido acumulado supera lo permitido por over-receipt?
 * - Si no se permite over-receipt: cualquier exceso sobre lo pedido lo supera.
 * - Si se permite con umbral %: supera solo si pasa esperada * (1 + pct/100).
 * - Si se permite sin umbral (pctMax null): nunca lo supera (over-receipt libre).
 */
export function superaOverReceipt(
  recibidoAcum: number,
  esperada: number,
  cfg: { permite: boolean; pctMax?: number | null },
): boolean {
  if (recibidoAcum <= esperada + EPS_RECEP) return false   // no hay exceso
  if (!cfg.permite) return true                            // exceso y no se permite
  if (cfg.pctMax == null || cfg.pctMax <= 0) return false  // permitido sin tope
  const tope = esperada * (1 + cfg.pctMax / 100)
  return recibidoAcum > tope + EPS_RECEP
}

/** B4 — ¿esta línea quedó con faltante (se recibió menos que lo pedido)? */
export function tieneFaltante(recibidoAcum: number, esperada: number): boolean {
  return recibidoAcum + EPS_RECEP < esperada
}

/** B1c — ¿la cantidad recibida difiere de lo esperado (over o under) → requiere SUPERVISOR+? */
export function esAjusteCantidad(recibido: number, esperada: number): boolean {
  return Math.abs(recibido - esperada) > EPS_RECEP
}
