/**
 * arrepentimiento.ts — Lógica PURA del botón de arrepentimiento (Ley 24.240 art. 34 /
 * "click-to-cancel") y de la cancelación estándar. Espejo de la decisión del EF
 * `cancel-suscripcion` (acciones 'preview' y 'arrepentimiento') — mantener EN SYNC.
 *
 * Modelo (mig 260):
 *   • Condición A — ARREPENTIMIENTO: dentro de los 10 días corridos posteriores a la
 *     PRIMERA compra (tenants.primera_compra_at, trigger en la primera activación paga).
 *     Reembolso TOTAL de todos los pagos + cancelación en MP + acceso revocado YA
 *     (subscription_period_end = now()). Fail-closed: si algún refund falla, no se
 *     cancela nada (reintento idempotente: los ya reembolsados se saltean).
 *   • Condición B — CANCELACIÓN ESTÁNDAR: sin reembolso por el período facturado; el
 *     servicio sigue hasta el fin del ciclo (grace MP-C9, ya implementado v1.110/112).
 *   • Ambas quedan logueadas en billing_cancelaciones (tenant, user, tipo, detalle).
 */

/** Días corridos de la ventana de arrepentimiento desde la primera compra. */
export const ARREPENTIMIENTO_DIAS = 10

export interface Elegibilidad {
  elegible: boolean
  /** Fin de la ventana (primera_compra_at + 10d) — null si nunca hubo compra. */
  hasta: Date | null
}

/**
 * ¿El tenant está en período de arrepentimiento? (10 días corridos desde la primera
 * compra). Sin primera_compra_at (nunca pagó: trial/free) NO hay nada que reembolsar
 * → no elegible (la baja de un trial es la cancelación estándar de siempre).
 */
export function elegibleArrepentimiento(
  primeraCompraAt: string | Date | null | undefined,
  now: Date = new Date(),
): Elegibilidad {
  if (!primeraCompraAt) return { elegible: false, hasta: null }
  const inicio = new Date(primeraCompraAt).getTime()
  if (Number.isNaN(inicio)) return { elegible: false, hasta: null }
  const hasta = new Date(inicio + ARREPENTIMIENTO_DIAS * 86400_000)
  return { elegible: now.getTime() <= hasta.getTime(), hasta }
}

export interface PagoMP {
  id: string | number
  status: string
  transaction_amount: number
  transaction_amount_refunded?: number | null
}

/**
 * ¿Este pago necesita refund? Aprobado y sin reembolso total previo. Los ya
 * reembolsados se saltean → el retry tras una falla parcial es idempotente
 * (REGLA #0: nunca reembolsar dos veces).
 */
export function necesitaRefund(p: PagoMP): boolean {
  if (p.status === 'refunded') return false
  if (p.status !== 'approved') return false
  const refunded = Number(p.transaction_amount_refunded ?? 0)
  return refunded < Number(p.transaction_amount)
}

/** Filtra los pagos a reembolsar y suma el monto total del reembolso. */
export function planDeRefunds(pagos: PagoMP[]): { ids: Array<string | number>; total: number } {
  const target = pagos.filter(necesitaRefund)
  return {
    ids: target.map(p => p.id),
    total: target.reduce(
      (s, p) => s + (Number(p.transaction_amount) - Number(p.transaction_amount_refunded ?? 0)), 0),
  }
}
