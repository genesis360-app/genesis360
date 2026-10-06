/**
 * Política de contraseñas — la ÚNICA fuente del lado de la app.
 *
 * Supabase Auth (DEV y PROD, Config → Auth) exige **10 caracteres como mínimo** y rechaza las contraseñas que
 * aparecieron en filtraciones (HaveIBeenPwned). La app decía "mínimo 8": una contraseña de 8 o 9 pasaba el formulario
 * y la rechazaba el servidor con un mensaje en inglés o con un genérico "Edge Function returned a non-2xx status code"
 * (GO, 2026-10-06, al elegir la contraseña de un empleado). Si se cambia la política en Supabase, cambiar `PASSWORD_MIN`
 * acá y en las EFs `usuarios-sin-correo` y `admin-api` (Deno no importa de `src/`).
 */
export const PASSWORD_MIN = 10

/** Problema de formato que la app puede ver ANTES de mandar (la filtración solo la sabe el servidor). */
export function problemaPassword(p: string): string | null {
  if (p.length > 0 && p.length < PASSWORD_MIN) return `Tiene que tener al menos ${PASSWORD_MIN} caracteres`
  return null
}

/** Los errores de Supabase Auth llegan en inglés. */
export function traducirErrorPassword(msg: string): string {
  if (/different from the old password/i.test(msg)) return 'La contraseña nueva tiene que ser distinta de la que tenías'
  if (/at least \d+ characters|too short/i.test(msg)) {
    const n = msg.match(/at least (\d+) characters/i)?.[1] ?? String(PASSWORD_MIN)
    // Supabase junta los dos motivos en un mismo mensaje: si además es conocida, decirlo también.
    const debil = /weak|easy to guess|pwned/i.test(msg) ? ' y no puede ser una contraseña conocida o fácil de adivinar' : ''
    return `La contraseña tiene que tener al menos ${n} caracteres${debil}`
  }
  if (/weak|easy to guess|pwned/i.test(msg)) return 'Esa contraseña es muy conocida o apareció en filtraciones de datos: elegí otra'
  return msg
}

/**
 * Mensaje real de una Edge Function que respondió con error. `supabase.functions.invoke` deja `data` en null y el
 * `error` con un texto genérico ("Edge Function returned a non-2xx status code"); el `{ error }` que mandó la función
 * está en el cuerpo de la respuesta (`error.context`).
 */
export async function mensajeErrorEdgeFunction(error: unknown, data?: { error?: string } | null): Promise<string> {
  if (data?.error) return data.error
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (ctx?.json) {
    try {
      const body = await ctx.json() as { error?: string } | null
      if (body?.error) return body.error
    } catch { /* cuerpo sin JSON */ }
  }
  return (error as { message?: string } | null)?.message ?? 'Error desconocido'
}
