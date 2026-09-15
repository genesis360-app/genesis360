// Consultas de soporte desde la app (Ayuda, mig 426) — lógica pura, sin I/O.
//
// Los guards autoritativos están en la base (`fn_soporte_crear_consulta` / `fn_soporte_responder`): largo del asunto y
// del mensaje, tipo, urgencia, topes y adjuntos. Esto es el espejo de la pantalla, para avisar antes de enviar.

export type TipoConsulta = 'problema' | 'consulta' | 'sugerencia'
export type Urgencia = 'baja' | 'media' | 'alta'
export type EstadoTicket = 'abierto' | 'en_progreso' | 'esperando' | 'resuelto' | 'cerrado'

export const TIPOS_CONSULTA: { valor: TipoConsulta; etiqueta: string }[] = [
  { valor: 'problema', etiqueta: 'Algo no funciona' },
  { valor: 'consulta', etiqueta: 'Tengo una duda' },
  { valor: 'sugerencia', etiqueta: 'Quiero sugerir algo' },
]

export const URGENCIAS: { valor: Urgencia; etiqueta: string }[] = [
  { valor: 'baja', etiqueta: 'Puede esperar' },
  { valor: 'media', etiqueta: 'Normal' },
  { valor: 'alta', etiqueta: 'Me frena el trabajo' },
]

export const MAX_ADJUNTOS = 3
export const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024
export const TIPOS_ARCHIVO_ADJUNTO = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

/** Espejo de `fn_soporte_crear_consulta`: asunto de 3 a 120 caracteres y mensaje de 1 a 4000. */
export function validarNuevaConsulta(c: { asunto: string; cuerpo: string }): string | null {
  const asunto = (c.asunto ?? '').trim()
  const cuerpo = (c.cuerpo ?? '').trim()
  if (asunto.length < 3) return 'Poné un asunto de al menos 3 letras.'
  if (asunto.length > 120) return 'El asunto puede tener hasta 120 caracteres.'
  if (!cuerpo) return 'Contanos qué pasa.'
  if (cuerpo.length > 4000) return 'El mensaje puede tener hasta 4000 caracteres.'
  return null
}

/** Espejo de `fn_soporte_responder`. */
export function validarRespuesta(cuerpo: string): string | null {
  const t = (cuerpo ?? '').trim()
  if (!t) return 'Escribí tu respuesta.'
  if (t.length > 4000) return 'La respuesta puede tener hasta 4000 caracteres.'
  return null
}

/** Mismo límite que el bucket `soporte-adjuntos`: imágenes o PDF de hasta 5 MB. */
export function validarAdjunto(archivo: { name: string; size: number; type: string }): string | null {
  if (!TIPOS_ARCHIVO_ADJUNTO.includes(archivo.type)) return `"${archivo.name}": solo imágenes (PNG, JPG, WEBP) o PDF.`
  if (archivo.size > MAX_BYTES_ADJUNTO) return `"${archivo.name}" pesa más de 5 MB.`
  return null
}

/**
 * Ruta del adjunto en el bucket: `<negocio>/<usuario>/<id>-<nombre>`. La política de Storage exige las dos primeras
 * carpetas; el nombre se limpia (sin tildes, espacios ni caracteres raros) para que la ruta sea estable.
 */
export function rutaAdjunto(tenantId: string, userId: string, nombreArchivo: string, id: string): string {
  const partes = (nombreArchivo ?? '').split('.')
  const ext = partes.length > 1 ? partes.pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : ''
  // Sin tildes (NFD + sacar las marcas combinables) y sin puntos: `fn_soporte_adjuntos_validos` rechaza cualquier `..`.
  const base = Array.from(partes.join('.').normalize('NFD'))
    .filter((ch) => { const c = ch.charCodeAt(0); return c < 0x300 || c > 0x36f })
    .join('')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'archivo'
  return `${tenantId}/${userId}/${id}-${base}${ext ? `.${ext}` : ''}`
}

export type EstadoCliente = { etiqueta: string; tono: 'revision' | 'respondida' | 'resuelta' | 'cerrada' }

/** Cómo ve el cliente el estado de su consulta. `ultimoAutor` = autor del último mensaje que puede ver. */
export function estadoParaCliente(estado: string, ultimoAutor: string | null | undefined): EstadoCliente {
  if (estado === 'cerrado') return { etiqueta: 'Cerrada', tono: 'cerrada' }
  if (estado === 'resuelto') return { etiqueta: 'Resuelta', tono: 'resuelta' }
  if (ultimoAutor === 'agente') return { etiqueta: 'Te respondimos', tono: 'respondida' }
  return { etiqueta: 'En revisión', tono: 'revision' }
}

/** Una consulta cerrada no se responde: se abre otra. */
export function puedeResponder(estado: string): boolean {
  return estado !== 'cerrado'
}
