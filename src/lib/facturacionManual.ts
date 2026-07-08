/**
 * facturacionManual.ts — Lógica PURA del vencimiento de pago manual (billing_mode='manual').
 * Espejo de la decisión de la EF `billing-manual-sweep` (mantener EN SYNC). Plan aprobado
 * 2026-07-08 (facturación de Fede + pago manual).
 *
 * El único gate de acceso sigue siendo `tenants.subscription_status` (accesoSuscripcion.ts /
 * SubscriptionGuard NO se tocan) — este archivo decide CUÁNDO el sweep debe mandar un
 * recordatorio o pasar el status a 'inactive', pero no toca el gate en sí.
 */

/** Días antes del vencimiento en los que se manda cada recordatorio (orden: más lejano primero). */
export const RECORDATORIO_DIAS_ANTES = [5, 1] as const
/** Días de gracia después del vencimiento antes de suspender por falta de pago. */
export const GRACIA_DIAS = 5

export type TipoRecordatorio = `recordatorio_${typeof RECORDATORIO_DIAS_ANTES[number]}d`
export type DecisionSweepManual = 'nada' | TipoRecordatorio | 'suspender'

/**
 * Decide qué acción tomar el sweep para un tenant en modo manual con `paidUntil` conocido.
 * Dedupe: si ya se mandó el recordatorio correspondiente (`ultimoTipo`), no se repite aunque
 * el sweep corra cada hora. Vencido + fuera de gracia → 'suspender' (una sola vez; el sweep
 * externo es quien realmente cambia `subscription_status`, esta función solo decide).
 */
export function decidirSweepManual(p: {
  paidUntil: string | Date | null
  ultimoTipo: string | null
  now?: Date
}): DecisionSweepManual {
  if (!p.paidUntil) return 'nada' // sin fecha (recién pasado a manual, sin primer pago) — nada que recordar todavía
  const now = p.now ?? new Date()
  const paidUntil = new Date(p.paidUntil).getTime()
  if (Number.isNaN(paidUntil)) return 'nada'

  const graceEnd = paidUntil + GRACIA_DIAS * 86400_000
  if (now.getTime() > graceEnd) return 'suspender'

  // Tier MÁS URGENTE ya alcanzado (el `dias` más chico cuyo umbral ya se cruzó). Cerca del
  // vencimiento se cruzan VARIOS umbrales a la vez (ej. el día del vencimiento se cruzan
  // tanto el de 5d como el de 1d) — hay que quedarse con el más urgente, no con el primero
  // del array, o el recordatorio "lejano" podía revivir después de mandado el "cercano".
  let tierActual: number | null = null
  for (const dias of RECORDATORIO_DIAS_ANTES) {
    const umbral = paidUntil - dias * 86400_000
    if (now.getTime() >= umbral && now.getTime() <= paidUntil) {
      if (tierActual === null || dias < tierActual) tierActual = dias
    }
  }
  if (tierActual === null) return 'nada'

  const ultimoDias = Number(p.ultimoTipo?.match(/^recordatorio_(\d+)d$/)?.[1] ?? NaN)
  if (!Number.isNaN(ultimoDias) && ultimoDias <= tierActual) return 'nada' // ya se mandó éste o uno más urgente
  return `recordatorio_${tierActual}d` as TipoRecordatorio
}

/** Fecha del vencimiento formateada es-AR, para el cuerpo de los emails/UI. */
export function formatearVencimiento(paidUntil: string | Date): string {
  return new Date(paidUntil).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
