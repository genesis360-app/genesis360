// estadoTrial — distinguir "la prueba está por vencer" de "la prueba YA venció".
//
// 🐛 Bug real (GO, 2026-09-12): entró a PROD con una cuenta cuyo trial había vencido 25 días antes
// y la pantalla de planes lo recibió con "¡Tu prueba gratuita está por vencer!" y "seguí usando
// Genesis360 sin interrupciones". Las dos frases eran falsas: ya había vencido y la interrupción ya
// había ocurrido — de hecho estaba ahí PORQUE lo habían sacado de la app.
//
// La condición miraba solo `subscription_status === 'trial'` y nunca comparaba la fecha, así que
// decía exactamente lo mismo el día 29 del trial que 25 días después de vencido. Al 2026-09-12,
// 5 de los 6 tenants en trial de PROD ya lo tenían vencido: era el caso MAYORITARIO, no un borde.
//
// El mensaje importa más de lo que parece: si confundió a GO, que conoce el sistema, a un cliente
// lo confunde seguro — no entiende por qué lo echaron ni desde cuándo.

export type FaseTrial = 'sin_trial' | 'vigente' | 'por_vencer' | 'vencido'

export interface EstadoTrial {
  fase: FaseTrial
  /** Días completos que faltan (`vigente`/`por_vencer`) o que pasaron (`vencido`). */
  dias: number
}

/** Umbral para considerar que "está por vencer" y avisarlo con urgencia. */
const DIAS_AVISO = 7

const MS_DIA = 86_400_000

/**
 * En qué punto del trial está el tenant.
 *
 * `sin_trial` = no está en trial (activo, cancelado, etc.): esta pantalla no habla de la prueba.
 */
export function estadoTrial(p: {
  subscriptionStatus: string | null | undefined
  trialEndsAt: string | null | undefined
  now: Date
}): EstadoTrial {
  if (p.subscriptionStatus !== 'trial' || !p.trialEndsAt) return { fase: 'sin_trial', dias: 0 }

  const fin = new Date(p.trialEndsAt)
  if (isNaN(fin.getTime())) return { fase: 'sin_trial', dias: 0 }

  const restanMs = fin.getTime() - p.now.getTime()
  if (restanMs <= 0) {
    // Vencido: se redondea hacia arriba para que las primeras 24 h digan "hace 1 día" y no "hace 0".
    return { fase: 'vencido', dias: Math.max(1, Math.ceil(-restanMs / MS_DIA)) }
  }

  const dias = Math.ceil(restanMs / MS_DIA)
  return { fase: dias <= DIAS_AVISO ? 'por_vencer' : 'vigente', dias }
}

/** Título de la pantalla de planes, según en qué punto del trial está. */
export function tituloPlanes(e: EstadoTrial, nombreNegocio?: string | null): string {
  const negocio = nombreNegocio?.trim()
  switch (e.fase) {
    case 'vencido':
      return negocio
        ? `La prueba gratuita de "${negocio}" venció`
        : 'Tu prueba gratuita venció'
    case 'por_vencer':
      return e.dias === 1
        ? 'Tu prueba gratuita vence mañana'
        : `Tu prueba gratuita vence en ${e.dias} días`
    case 'vigente':
      return 'Elegí tu plan'
    default:
      return 'Elegí tu plan'
  }
}

/** Bajada de la pantalla de planes. Dice qué pasó y qué se recupera al activar. */
export function subtituloPlanes(e: EstadoTrial, trialEndsAt?: string | null): string {
  switch (e.fase) {
    case 'vencido': {
      const fecha = trialEndsAt ? new Date(trialEndsAt) : null
      const cuando = fecha && !isNaN(fecha.getTime())
        ? ` el ${fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        : ''
      const hace = e.dias === 1 ? 'ayer' : `hace ${e.dias} días`
      // Se nombra la fecha Y los días: la fecha sola obliga a hacer la cuenta mental.
      return `Terminó${cuando} (${hace}). Activá un plan para volver a entrar — tus datos están intactos.`
    }
    case 'por_vencer':
      return 'Activá tu suscripción para seguir usando Genesis360 sin interrupciones'
    default:
      return 'Todos los planes incluyen 30 días de prueba gratuita'
  }
}
