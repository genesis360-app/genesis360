/**
 * mpCancelacion.ts — ESPEJO PURO del contrato FAIL-CLOSED de cancelación de suscripción MP
 * (REGLA #0). Espeja el helper `cancelarSubMP` de `cancel-suscripcion` / `admin-api` (Deno).
 *
 * 🛑 REGLA #0 — el bug original (Fede, 2026-07-02) era FAIL-OPEN: marcaba la cuenta como
 * 'cancelled' sin confirmar que el preapproval quedó fuera de cobro en MP → el cliente
 * seguía siendo cobrado. La garantía que este contrato fija: **NUNCA se puede marcar la
 * cuenta como cancelada si el preapproval GUARDADO (mp_subscription_id) no se confirmó
 * fuera de cobro** (cancelado o no-vivo). Ante cualquier duda → `puedeMarcarCancelado=false`.
 *
 * Este módulo es un mirror (patrón ccLogic); si cambia el EF, actualizar acá + los tests.
 */

/** Estados de un preapproval que MP considera "vivo" (potencialmente cobrando). */
export const MP_VIVOS = ['authorized', 'pending', 'paused'] as const

export interface CandidatoObs {
  id: string
  /** El GET del preapproval en MP respondió ok. */
  getOk: boolean
  /** HTTP status del GET (para el mensaje de error si falló). */
  getStatus?: number
  /** Status del preapproval (si getOk). */
  status?: string
  /** Pertenece al tenant: external_reference===tenant O id===storedId (ya computado). */
  esDelTenant?: boolean
  /** Si estaba vivo y se intentó el PUT cancel: resultado. */
  putOk?: boolean
  /** HTTP status del PUT (para el mensaje de error si falló). */
  putStatus?: number
}

export interface EvalCancelacion {
  mp_cancelled: number
  errores: string[]
  /** Si el caller puede marcar la cuenta 'cancelled' (solo si NO hay errores = fail-closed). */
  puedeMarcarCancelado: boolean
}

/**
 * Evalúa el resultado de intentar cancelar los preapproval(s) candidatos de un tenant.
 * `storedId` = `tenants.mp_subscription_id` (el id verificado al activar; la llave confiable).
 * `obs` = observaciones YA resueltas de cada candidato (GET/PUT contra MP hechos por el caller).
 */
export function evaluarCancelacion(storedId: string | null, obs: CandidatoObs[]): EvalCancelacion {
  let mp_cancelled = 0
  const errores: string[] = []
  // Si hay un preapproval GUARDADO, exigimos confirmar que quedó fuera de cobro.
  let storedConfirmado = storedId ? false : true

  for (const o of obs) {
    if (!o.getOk) {
      if (o.id === storedId) errores.push(`${o.id}:get_${o.getStatus}`)
      continue
    }
    if (!o.esDelTenant) continue // no es de este tenant → ignorar
    if (o.status === 'cancelled') {
      mp_cancelled++
      if (o.id === storedId) storedConfirmado = true
      continue
    }
    if (!MP_VIVOS.includes(o.status as any)) {
      // no vivo (ej. finalizado) → no cobra; cuenta como confirmado si es el guardado
      if (o.id === storedId) storedConfirmado = true
      continue
    }
    // vivo → se intentó el PUT cancel
    if (o.putOk) {
      mp_cancelled++
      if (o.id === storedId) storedConfirmado = true
    } else {
      errores.push(`${o.id}:${o.putStatus}`)
    }
  }

  if (storedId && !storedConfirmado) errores.push('no_confirmado')

  return { mp_cancelled, errores, puedeMarcarCancelado: errores.length === 0 }
}
