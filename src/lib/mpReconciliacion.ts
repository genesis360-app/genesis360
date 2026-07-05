/**
 * mpReconciliacion.ts — ESPEJO PURO de la clasificación del EF `mp-reconciliacion`
 * (sweep horario anti-MP-W6 / DRIFT 1-2 del UAT mp-suscripciones-pagos).
 *
 * Contexto (bug real, Fede 2026-07-04): si el checkout-return no corre en el cliente,
 * el webhook NO puede linkear el preapproval nuevo (external_reference y payer_email
 * vienen vacíos en checkout por plan) → el pago queda huérfano EN SILENCIO: MP cobra
 * y el cliente no tiene acceso. El sweep recorre los preapprovals de MP y clasifica.
 *
 * 🛑 REGLA #0: el sweep SOLO detecta y alerta a soporte — NUNCA activa/mueve plata
 * automáticamente (sin payer_email no hay matching confiable de dueño; un auto-link
 * equivocado regalaría una cuenta o cobraría al tenant que no es). La resolución es
 * humana vía `admin-api billing.link_subscription` (validado e2e en PROD).
 *
 * Este módulo es un mirror; si cambia el EF, actualizar acá + los tests EN EL MISMO cambio.
 */

/** Estados de un preapproval que MP considera "vivo" (espejo de mpCancelacion.MP_VIVOS). */
const VIVOS = ['authorized', 'pending', 'paused']

export type ReconClasificacion =
  | 'ignorar'             // no es un plan nuestro, o estado sin señal accionable
  | 'ok'                  // authorized + tenant linkeado active (todo consistente)
  | 'huerfana'            // 🛑 authorized + plan nuestro + SIN tenant linkeado (pago perdido)
  | 'drift_mp_cobra'      // 🛑 authorized + tenant linkeado NO active (MP cobra, DB no da acceso)
  | 'drift_acceso_gratis' // 🛑 preapproval muerto + tenant linkeado active (acceso sin cobro vigente)

export function clasificarPreapproval(p: {
  /** El preapproval_plan_id matchea MP_PLAN_BASICO/MP_PLAN_PRO. */
  esPlanNuestro: boolean
  /** Status del preapproval en MP (authorized/pending/paused/cancelled/…). */
  status: string
  /** subscription_status del tenant que tiene este id en mp_subscription_id, o null si nadie. */
  linkedTenantStatus: string | null
}): ReconClasificacion {
  if (!p.esPlanNuestro) return 'ignorar'

  if (p.status === 'authorized') {
    if (p.linkedTenantStatus === null) return 'huerfana'
    if (p.linkedTenantStatus === 'active') return 'ok'
    return 'drift_mp_cobra'
  }

  // pending/paused: sin cobro confirmado ni corte definitivo → sin señal accionable
  // (pending = checkout en curso; paused = MP reintentando/suspendido, lo maneja el webhook).
  if (VIVOS.includes(p.status)) return 'ignorar'

  // Muerto (cancelled/finished/expired). Solo es hallazgo si un tenant ACTIVO lo tiene
  // linkeado (acceso sin suscripción viva — el webhook de cancelación debió sincronizar).
  if (p.linkedTenantStatus === 'active') return 'drift_acceso_gratis'
  return 'ignorar'
}
