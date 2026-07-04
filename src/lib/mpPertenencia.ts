/**
 * mpPertenencia.ts — ESPEJO PURO del contrato de pertenencia de una suscripción MP
 * (REGLA #0). El EF `mp-verificar-suscripcion` (y `admin-api` → `billing.link_subscription`)
 * viven en Deno y no se pueden unit-testear directo; este espejo fija la decisión y se
 * testea (mismo patrón que `ccLogic`/`cajaArqueo` espejan RPCs SQL).
 *
 * ⚠️ Si cambia la lógica de pertenencia en el EF, actualizar ACÁ + los tests. La decisión
 * gobierna si un cliente que pagó se activa: un falso positivo activa gratis a otro; un
 * falso negativo deja a un cliente que pagó sin servicio. Cero tolerancia (REGLA #0).
 *
 * Crux histórico (v1.107/108): MP manda `payer_email` (y `external_reference`) VACÍOS en
 * checkout por plan → NO se puede gatear la pertenencia por email; se cae en el claim
 * exclusivo (que ese preapproval no esté ya linkeado a otro tenant). Solo se rechaza por
 * email si MP SÍ mandó uno y no matchea.
 */

export type PertenenciaTier = 'basico' | 'pro'
export type PertenenciaReason =
  | 'no_encontrado' | 'no_autorizado' | 'plan_desconocido' | 'owner_mismatch' | 'ya_reclamada'

export type PertenenciaDecision =
  | { activar: true; tier: PertenenciaTier }
  | { activar: false; reason: PertenenciaReason }

export interface PreapprovalMin {
  id?: string | null
  status?: string | null
  preapproval_plan_id?: string | null
  payer_email?: string | null
}

export interface DecidirPertenenciaParams {
  /** El preapproval traído de MP (o null si no se encontró). */
  sub: PreapprovalMin | null | undefined
  /** Email del usuario logueado (dueño del tenant). */
  userEmail: string
  /** Mapa `preapproval_plan_id` → tier (env MP_PLAN_BASICO/PRO). */
  planTiers: Record<string, PertenenciaTier>
  /** Ya computado con una query: el preapproval está linkeado a OTRO tenant. */
  reclamadaPorOtroTenant: boolean
  /**
   * true (default) = flujo cliente (`mp-verificar-suscripcion`): si MP mandó payer_email
   * y no matchea, rechaza. false = link por soporte (`admin-api`): el agente decide, no se
   * exige el email (igual protege el claim exclusivo + authorized + plan nuestro).
   */
  exigirPayerEmail?: boolean
}

/** Decisión de activación de una suscripción MP para un tenant. Espejo del EF. */
export function decidirPertenencia(params: DecidirPertenenciaParams): PertenenciaDecision {
  const { sub, userEmail, planTiers, reclamadaPorOtroTenant, exigirPayerEmail = true } = params

  if (!sub?.id) return { activar: false, reason: 'no_encontrado' }
  if (sub.status !== 'authorized') return { activar: false, reason: 'no_autorizado' }

  const tier = sub.preapproval_plan_id ? planTiers[sub.preapproval_plan_id] : undefined
  if (!tier) return { activar: false, reason: 'plan_desconocido' }

  if (exigirPayerEmail) {
    const subEmail = (sub.payer_email ?? '').toLowerCase().trim()
    const uEmail = (userEmail ?? '').toLowerCase().trim()
    // payer_email vacío (checkout por plan) → no se gatea por email; cae en el claim
    // exclusivo. Solo rechaza si MP mandó un email y NO matchea.
    if (subEmail && (!uEmail || subEmail !== uEmail)) return { activar: false, reason: 'owner_mismatch' }
  }

  if (reclamadaPorOtroTenant) return { activar: false, reason: 'ya_reclamada' }

  return { activar: true, tier }
}
