// Rate limiting compartido por las Edge Functions públicas (mig 432).
//
// Por qué existe: hasta el 2026-09-22 cada función llevaba la cuenta en un `Map` en memoria del
// isolate. Eso no limitaba nada real — el contador se pierde en cada cold start y Supabase corre
// varios isolates en paralelo, cada uno con su propio `Map`. El contador de verdad vive ahora en
// `public.rate_limit_contadores`, que es el único lugar que todos los isolates comparten.
//
// El `Map` local se conserva igual, pero como PISO, no como límite: frena una ráfaga del mismo
// isolate sin ir a la base, y sigue limitando algo si la base no contesta.

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
}

export type ResultadoRateLimit = {
  permitido: boolean
  contador: number
  limite: number
  retryAfterSeg: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad del cliente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IP del cliente, en el orden en que se puede confiar en cada header.
 *
 * 🛑 El orden importa: `x-forwarded-for` lo puede PREFIJAR el cliente (el proxy le agrega la IP
 * real al final, no la reemplaza). Leerlo entero —o quedarse con el primer hop— deja que cualquiera
 * mande un valor distinto en cada request y estrene cubo cada vez, salteándose el límite por
 * completo. Ese era el bug del limitador viejo de `marketplace-api`.
 */
export function ipDelCliente(req: Request): string {
  // Lo escribe el borde de Cloudflare pisando lo que haya mandado el cliente: no es falseable.
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf

  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real

  // Último recurso: el ÚLTIMO hop es el que agregó el proxy de confianza.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }

  return 'desconocido'
}

// ─────────────────────────────────────────────────────────────────────────────
// Piso local (por isolate)
// ─────────────────────────────────────────────────────────────────────────────

const cubosLocales = new Map<string, { contador: number; venceEn: number }>()
const MAX_CUBOS_LOCALES = 10_000

function pisoLocalSuperado(clave: string, limite: number, ventanaMs: number): boolean {
  const ahora = Date.now()

  // Sin esto el Map crece sin techo cuando llegan muchas identidades distintas.
  if (cubosLocales.size > MAX_CUBOS_LOCALES) cubosLocales.clear()

  const cubo = cubosLocales.get(clave)
  if (!cubo || ahora > cubo.venceEn) {
    cubosLocales.set(clave, { contador: 1, venceEn: ahora + ventanaMs })
    return false
  }
  cubo.contador++
  return cubo.contador > limite
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consume una unidad del cubo `bucket` para `identidad`.
 *
 * `supabase` tiene que ser un cliente con service_role: `fn_rate_limit_consumir` solo tiene EXECUTE
 * para ese rol.
 */
export async function consumirRateLimit(
  supabase: ClienteRpc,
  bucket: string,
  identidad: string,
  limite: number,
  ventanaSeg = 60,
): Promise<ResultadoRateLimit> {
  const clave = `${bucket}|${identidad}`

  // Si el propio isolate ya lo vio pasarse, no hace falta ir a la base.
  if (pisoLocalSuperado(clave, limite, ventanaSeg * 1000)) {
    return { permitido: false, contador: limite + 1, limite, retryAfterSeg: ventanaSeg }
  }

  const { data, error } = await supabase.rpc('fn_rate_limit_consumir', {
    p_bucket: bucket,
    p_identidad: identidad,
    p_limite: limite,
    p_ventana_seg: ventanaSeg,
  })

  if (error || !data) {
    // Fail-open a propósito: si la base no contesta, devolver 429 convertiría un hipo de la base en
    // la caída total de la API pública. Queda el rastro en los logs y el piso local sigue vigente,
    // que es exactamente lo que había antes de esta migración.
    console.error(`[rate-limit] ${bucket}: no se pudo consumir, se deja pasar`, error)
    return { permitido: true, contador: 0, limite, retryAfterSeg: 0 }
  }

  const r = data as { permitido: boolean; contador: number; limite: number; retry_after_seg: number }
  return {
    permitido: r.permitido,
    contador: r.contador,
    limite: r.limite,
    retryAfterSeg: r.retry_after_seg,
  }
}

/** Respuesta 429 estándar, con el `Retry-After` que corresponde. */
export function respuesta429(
  resultado: ResultadoRateLimit,
  mensaje: string,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: mensaje }), {
    status: 429,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Retry-After': String(resultado.retryAfterSeg || 60),
    },
  })
}
