import { supabase } from '@/lib/supabase'

/**
 * CL4 — Notificaciones de cuenta corriente al cliente (event-driven, configurable).
 * Sin pg_cron: se disparan en el momento del evento (alta de deuda / pago).
 * Fire-and-forget: nunca bloquean ni lanzan errores al flujo de venta/cobranza.
 * El canal WhatsApp no se auto-envía (requiere acción manual); acá se cubre el email.
 */
function emailHabilitado(tenant: any): boolean {
  return Array.isArray(tenant?.cc_notif_canales) && tenant.cc_notif_canales.includes('email')
}

async function clienteEmail(clienteId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('clientes').select('email').eq('id', clienteId).maybeSingle()
    return data?.email ?? null
  } catch { return null }
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

/** C1 — al registrar una venta a cuenta corriente. */
export async function notificarRegistroDeudaCC(tenant: any, clienteId: string | null, clienteNombre: string, monto: number) {
  if (!clienteId || !tenant?.cc_notif_registro_deuda || !emailHabilitado(tenant) || monto <= 0.5) return
  const email = await clienteEmail(clienteId)
  if (!email) return
  void supabase.functions.invoke('send-email', {
    body: {
      type: 'notificacion', to: email,
      data: {
        titulo: `Compra en cuenta corriente — ${tenant.nombre}`,
        mensaje: `Hola ${clienteNombre},\n\nRegistramos una compra de ${fmt(monto)} en tu cuenta corriente con ${tenant.nombre}.\n\n¡Gracias por tu compra!`,
      },
    },
  }).catch(() => {})
}

/** C4 — al registrar un pago/cobranza de cuenta corriente. */
export async function notificarPagoCC(tenant: any, clienteId: string | null, clienteNombre: string, monto: number) {
  if (!clienteId || !tenant?.cc_notif_pago || !emailHabilitado(tenant) || monto <= 0.5) return
  const email = await clienteEmail(clienteId)
  if (!email) return
  void supabase.functions.invoke('send-email', {
    body: {
      type: 'notificacion', to: email,
      data: {
        titulo: `Pago recibido — ${tenant.nombre}`,
        mensaje: `Hola ${clienteNombre},\n\nRecibimos tu pago de ${fmt(monto)} en cuenta corriente. ¡Muchas gracias!`,
      },
    },
  }).catch(() => {})
}
