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

// ── Intentos de suscripción (mig 464) ──────────────────────────────────────────────────────
// Incidente 2026-09-28: un negocio pagó el mismo plan dos veces con 40 s de diferencia y ninguna suscripción quedó
// vinculada; las alertas de huérfana no decían de quién eran y se descartaron como "prueba". Cada salida de
// /suscripcion al checkout queda registrada en `mp_suscripcion_intentos`; con eso se nombra al negocio candidato de
// una huérfana y se frena el segundo pago. Sigue sin vincular solo: la alerta propone, soporte decide.

export interface IntentoSuscripcion {
  tenant_id: string
  mp_plan_id: string
  created_at: string
  vinculado_at?: string | null
}

/** Ventana hacia atrás desde la creación del preapproval en la que un intento cuenta como candidato. */
export const VENTANA_CANDIDATO_MS = 3 * 60 * 60 * 1000

/**
 * Negocios candidatos de una suscripción huérfana: intentaron ese MISMO plan en las 3 h previas a que MP creara el
 * preapproval (y el intento no quedó vinculado a otra). Ordenados del intento más cercano al más lejano, sin repetir.
 */
export function candidatosHuerfana(
  pre: { preapproval_plan_id: string; date_created: string },
  intentos: IntentoSuscripcion[],
): string[] {
  const t = new Date(pre.date_created).getTime()
  if (!Number.isFinite(t)) return []
  const enVentana = intentos
    .filter(i => i.mp_plan_id === pre.preapproval_plan_id && !i.vinculado_at)
    .map(i => ({ tenant: i.tenant_id, dt: t - new Date(i.created_at).getTime() }))
    .filter(x => Number.isFinite(x.dt) && x.dt >= -60_000 && x.dt <= VENTANA_CANDIDATO_MS) // 1 min de tolerancia de relojes
    .sort((a, b) => Math.abs(a.dt) - Math.abs(b.dt))
  return [...new Set(enVentana.map(x => x.tenant))]
}

/** Ventana en la que un intento sin vincular frena un nuevo pago ("ya iniciaste un pago"). */
export const VENTANA_ANTI_DUPLICADO_MS = 2 * 60 * 60 * 1000

/** El intento sin vincular más reciente dentro de la ventana, o null (la app avisa antes de dejar pagar de nuevo). */
export function intentoPendienteReciente(intentos: IntentoSuscripcion[], ahora: Date): IntentoSuscripcion | null {
  const recientes = intentos
    .filter(i => !i.vinculado_at)
    .filter(i => {
      const dt = ahora.getTime() - new Date(i.created_at).getTime()
      return Number.isFinite(dt) && dt >= 0 && dt <= VENTANA_ANTI_DUPLICADO_MS
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return recientes[0] ?? null
}

/**
 * ¿La huérfana parece un pago DUPLICADO? Sí, si el negocio candidato ya tiene otra suscripción nuestra autorizada
 * (vinculada o también huérfana) creada dentro de las 24 h de esta.
 */
export function esPosibleDuplicado(
  pre: { id: string; date_created: string },
  candidato: string,
  otras: Array<{ id: string; date_created: string; tenant_id: string | null; candidatos: string[] }>,
): boolean {
  const t = new Date(pre.date_created).getTime()
  return otras.some(o => o.id !== pre.id &&
    (o.tenant_id === candidato || o.candidatos.includes(candidato)) &&
    Math.abs(new Date(o.date_created).getTime() - t) <= 24 * 60 * 60 * 1000)
}
