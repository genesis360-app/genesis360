/**
 * suscripcionActivacion.ts — lógica PURA del flujo de activación de suscripción MP
 * (retorno del checkout en SuscripcionPage). Extraída para poder testearla y para que
 * lo testeado sea exactamente lo que corre (sin drift). Fuente de verdad de cómo se
 * traduce la respuesta del EF `mp-verificar-suscripcion` al estado de UI.
 *
 * 🛑 REGLA #0 (revenue): el contrato clave —que NO puede romperse en un refactor— es:
 *   - `200 { activated:true }`                              → 'ok'      (activar + redirigir)
 *   - `200 { activated:false, reason }` (no_encontrado…)    → 'pendiente' (reintentar; el webhook puede activar)
 *   - `4xx/5xx` (owner_mismatch/ya_reclamada/plan_desconocido/error server) → 'error' (terminal, NO reintentar en loop)
 */

export type VerifEstado = 'verificando' | 'ok' | 'pendiente' | 'error'

export interface VerifResultado {
  estado: Exclude<VerifEstado, 'verificando'>
  reason?: string
}

/**
 * Clasifica la respuesta de `supabase.functions.invoke('mp-verificar-suscripcion')`.
 * @param data     Body 2xx del EF (`{ activated, reason }`) o null si hubo error HTTP.
 * @param hayError true si `invoke` devolvió error (respuesta 4xx/5xx = terminal).
 * @param errorReason `reason` extraído del body del error (si se pudo leer), para el mensaje.
 */
export function clasificarVerificacion(
  data: { activated?: boolean; reason?: string } | null | undefined,
  hayError: boolean,
  errorReason?: string,
): VerifResultado {
  // 4xx/5xx = terminal (owner_mismatch, ya_reclamada, plan_desconocido, error server).
  if (hayError) return { estado: 'error', reason: errorReason }
  if (data?.activated) return { estado: 'ok' }
  // 200 con activated:false → MP todavía no confirmó (no_encontrado / no_autorizado).
  return { estado: 'pendiente', reason: data?.reason }
}

/**
 * Mensaje de error REAL de una invocación a un EF (UAT MP-AD10). supabase-js NO parsea el
 * body cuando el EF devuelve 4xx/5xx: el error llega como FunctionsHttpError con message
 * genérico ("Edge Function returned a non-2xx status code") y `data` en null; el body real
 * (`{ error: '…' }`) viaja en `error.context` (un Response). Orden: data.error → body del
 * context → error.message → fallback.
 */
export async function mensajeErrorEF(error: any, data: any, fallback: string): Promise<string> {
  if (data?.error) return data.error
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.error
  } catch { /* body no-JSON o ya consumido → cae al fallback */ }
  return error?.message ?? fallback
}

/** Mensaje al usuario según el `reason` terminal que devuelve mp-verificar-suscripcion. */
export function mensajeErrorVerif(reason: string | null | undefined): string {
  switch (reason) {
    case 'owner_mismatch':
      return 'El pago figura a nombre de otra cuenta de Mercado Pago. Pagá desde la misma cuenta con la que verificás, o escribinos.'
    case 'ya_reclamada':
      return 'Esta suscripción ya está asociada a otro negocio. Escribinos y lo resolvemos.'
    case 'plan_desconocido':
      return 'No reconocimos el plan pagado. Escribinos y lo resolvemos enseguida.'
    default:
      return 'Tuvimos un problema al confirmar tu pago. Si ya pagaste, no vuelvas a pagar: reintentá o escribinos.'
  }
}
