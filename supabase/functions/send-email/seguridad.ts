// Reglas de seguridad de `send-email`, sin imports de Deno para poder testearlas con vitest
// (tests/unit/sendEmailSeguridad.test.ts).
//
// Por qué existen (2026-09-15): la EF tenía `verify_jwt` activo pero no validaba quién llamaba. La clave anon pública
// de la app ya es un JWT válido, así que cualquiera podía mandar mails con el remitente de Genesis360, al destinatario
// que quisiera y con HTML propio metido en los datos (phishing con nuestro dominio y consumo de la cuota de Resend).

export const SOPORTE = 'soporte@genesis360.pro'

/** Tipos que puede pedir un usuario logueado desde la app. `invitacion_proveedor` solo lo manda el servidor. */
export const TIPOS_USUARIO = new Set([
  'welcome', 'venta_confirmada', 'alerta_stock', 'notificacion', 'factura_emitida', 'oc', 'bug_report', 'soporte_consulta',
])

/** Tipos que van siempre a soporte, diga lo que diga el pedido. */
const TIPOS_A_SOPORTE = new Set(['bug_report', 'soporte_consulta'])

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Escapa texto para insertarlo en HTML. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/** Texto de una línea (asunto): sin saltos de línea ni caracteres de control, recortado. */
export function textoPlano(v: unknown, max = 200): string {
  // Los caracteres de control se filtran por código (0-31 y 127): escribirlos en una regex dejó bytes invisibles.
  const sinControl = Array.from(String(v ?? ''))
    .map((ch) => {
      const codigo = ch.charCodeAt(0)
      return codigo < 32 || codigo === 127 ? ' ' : ch
    })
    .join('')
  const s = sinControl.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Ruta interna de la app para el botón del mail. Acepta `/caja?tab=historial`; rechaza `//sitio.com`, `@sitio.com`,
 * URLs absolutas y barras invertidas (con `https://genesis360.pro` delante, `@evil.com` armaba un link a otro sitio).
 */
export function rutaInterna(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#[\]]*$/.test(v)) return null
  return v
}

export type Llamador = 'servicio' | 'usuario'

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; error: string }

/** Lista de destinatarios válida. `to` puede ser un mail o una lista. */
export function normalizarDestinatarios(to: unknown, max: number): Resultado<string[]> {
  const lista = (Array.isArray(to) ? to : [to]).map((e) => String(e ?? '').trim()).filter(Boolean)
  if (lista.length === 0) return { ok: false, status: 400, error: 'Falta el destinatario.' }
  if (lista.length > max) return { ok: false, status: 400, error: `Demasiados destinatarios (máximo ${max}).` }
  const invalido = lista.find((e) => e.length > 254 || !EMAIL_RE.test(e))
  if (invalido) return { ok: false, status: 400, error: 'Destinatario inválido.' }
  return { ok: true, valor: lista }
}

/** A quién se manda, según el tipo y quién llama. */
export function destinatariosSegunTipo(
  tipo: string, llamador: Llamador, toPedido: unknown, emailUsuario: string | null,
): Resultado<string[]> {
  if (llamador === 'usuario' && !TIPOS_USUARIO.has(tipo)) {
    return { ok: false, status: 403, error: 'Este tipo de mail no se puede enviar desde la app.' }
  }
  if (TIPOS_A_SOPORTE.has(tipo)) return { ok: true, valor: [SOPORTE] }
  if (tipo === 'welcome' && llamador === 'usuario') {
    if (!emailUsuario) return { ok: false, status: 400, error: 'La cuenta no tiene mail.' }
    return { ok: true, valor: [emailUsuario] }
  }
  return normalizarDestinatarios(toPedido, llamador === 'usuario' ? 5 : 50)
}

export type Adjunto = { filename: string; content: string }

/** Adjuntos de Resend (`{ filename, content }` en base64). A un usuario: hasta 3 y ~7 MB en total. */
export function validarAdjuntos(adjuntos: unknown, llamador: Llamador): Resultado<Adjunto[]> {
  if (adjuntos == null) return { ok: true, valor: [] }
  if (!Array.isArray(adjuntos)) return { ok: false, status: 400, error: 'Adjuntos inválidos.' }
  if (adjuntos.length === 0) return { ok: true, valor: [] }
  const max = llamador === 'usuario' ? 3 : 10
  if (adjuntos.length > max) return { ok: false, status: 400, error: `Demasiados adjuntos (máximo ${max}).` }
  const limpios: Adjunto[] = []
  let total = 0
  for (const a of adjuntos) {
    const filename = textoPlano((a as Adjunto)?.filename, 120)
    const content = (a as Adjunto)?.content
    if (!filename || typeof content !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(content)) {
      return { ok: false, status: 400, error: 'Adjunto inválido.' }
    }
    total += content.length
    limpios.push({ filename, content })
  }
  if (llamador === 'usuario' && total > 10_000_000) return { ok: false, status: 400, error: 'Los adjuntos pesan demasiado.' }
  return { ok: true, valor: limpios }
}
