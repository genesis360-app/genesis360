// Compartir un ticket / factura / NC por WhatsApp con un link al comprobante (mig 451, pedido de GO 2026-10-01).
//
// La API oficial de WhatsApp espera la aprobación de Meta: se abre el chat del cliente (click-to-chat) con el mensaje
// armado y un link a /c/<código>, una página pública que muestra el comprobante y regenera el PDF a partir de la foto
// de datos guardada en `comprobantes_compartidos`.
import { supabase } from '@/lib/supabase'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

export type TipoCompartido = 'ticket' | 'factura' | 'nc'

/** Código de 128 bits aleatorio (hex, 32). Se genera acá para no tener que leer la fila después del INSERT. */
export function generarCodigoCompartido(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

/** Link público al comprobante. Siempre a la app de producción (VITE_APP_URL), no al preview donde se generó. */
export function urlCompartido(codigo: string, base: string = import.meta.env.VITE_APP_URL || window.location.origin): string {
  return `${base.replace(/\/$/, '')}/c/${codigo}`
}

const NOMBRE_TIPO: Record<TipoCompartido, string> = { ticket: 'el comprobante de tu compra', factura: 'tu factura', nc: 'tu nota de crédito' }

/** Mensaje de WhatsApp. `etiqueta` = "Factura B 0001-00000023", "Venta #123", etc. */
export function mensajeComprobante(o: {
  tipo: TipoCompartido
  negocio: string
  cliente?: string | null
  etiqueta: string
  total?: number | null
  url: string
}): string {
  const saludo = o.cliente?.trim() ? `Hola ${o.cliente.trim().split(/\s+/)[0]}!` : 'Hola!'
  const total = Number.isFinite(o.total as number)
    ? ` por $${(o.total as number).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : ''
  return `${saludo} Te enviamos ${NOMBRE_TIPO[o.tipo]} de ${o.negocio} (${o.etiqueta})${total}.\n\nPodés verlo y descargarlo acá: ${o.url}`
}

/**
 * URL de WhatsApp. Con teléfono → abre el chat de ese número; sin teléfono (o inválido) → WhatsApp pide elegir el
 * contacto, con el mensaje ya escrito.
 */
export function urlWhatsApp(telefono: string | null | undefined, mensaje: string): string {
  return buildWhatsAppUrl(telefono ?? '', mensaje) || `https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`
}

/** Guarda la foto del comprobante y devuelve el link público. */
export async function crearLinkCompartido(o: {
  tenantId: string
  tipo: TipoCompartido
  ventaId?: string | null
  devolucionId?: string | null
  datos: unknown
}): Promise<string> {
  const codigo = generarCodigoCompartido()
  const { error } = await supabase.from('comprobantes_compartidos').insert({
    token: codigo, tenant_id: o.tenantId, tipo: o.tipo,
    venta_id: o.ventaId ?? null, devolucion_id: o.devolucionId ?? null, datos: o.datos,
  })
  if (error) throw new Error(`No se pudo generar el link del comprobante: ${error.message}`)
  return urlCompartido(codigo)
}

/**
 * Abrir WhatsApp DESPUÉS de un await (guardar el link) lo bloquea el navegador: se pierde el gesto del usuario. Por
 * eso se abre la pestaña en el click (vacía) y se le pone la dirección cuando el link está listo.
 */
export function abrirPestanaParaWhatsApp(): Window | null {
  return window.open('', '_blank')
}
export function navegarPestana(w: Window | null, url: string) {
  if (w && !w.closed) w.location.href = url
  else window.open(url, '_blank')
}
