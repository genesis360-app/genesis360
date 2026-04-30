/**
 * Normaliza un número de teléfono argentino al formato requerido por WhatsApp API.
 * Regla: 54 (país) + 9 (mobile) + código de área sin 0 + número sin 15
 * Ej: "011 15-4444-5555" → "5491144445555"
 */
export function normalizeWhatsApp(phone: string): string {
  if (!phone) return ''

  // Solo dígitos
  let num = phone.replace(/\D/g, '')
  if (!num) return ''

  // Si ya tiene formato correcto: 549XXXXXXXXXX (12-13 dígitos)
  if (num.startsWith('549') && num.length >= 12) return num

  // Si tiene código de país 54 sin el 9 → agrega 9
  if (num.startsWith('54') && !num.startsWith('549')) {
    num = '549' + num.slice(2)
    return num
  }

  // Número local — remover 0 inicial del área
  if (num.startsWith('0')) num = num.slice(1)

  // Detectar y remover el 15 de celulares (ej: 1115XXXXXXX → 11XXXXXXX)
  // El 15 aparece después del código de área (2 o 3 dígitos)
  // Áreas de 2 dígitos (CABA=11, BA=11): pos 2-3 sería '15'
  // Áreas de 3 dígitos (Córdoba=351, Rosario=341): pos 3-4 sería '15'
  if (num.length >= 10) {
    // Intento área 2 dígitos: num[2..3] === '15'
    if (num.slice(2, 4) === '15') {
      num = num.slice(0, 2) + num.slice(4)
    }
    // Intento área 3 dígitos: num[3..4] === '15'
    else if (num.slice(3, 5) === '15') {
      num = num.slice(0, 3) + num.slice(5)
    }
  }

  return '549' + num
}

/**
 * Reemplaza variables en la plantilla con datos reales.
 * Variables soportadas: {{Nombre_Cliente}}, {{Nombre_Negocio}},
 * {{Numero_Orden}}, {{Tracking}}, {{Courier}}, {{Fecha_Entrega}}
 */
export function expandirPlantilla(
  plantilla: string,
  vars: {
    nombre_cliente?: string
    nombre_negocio?: string
    numero_orden?: string | number
    tracking?: string
    courier?: string
    fecha_entrega?: string
  }
): string {
  return plantilla
    .replace(/\{\{Nombre_Cliente\}\}/gi,  vars.nombre_cliente  ?? '')
    .replace(/\{\{Nombre_Negocio\}\}/gi,  vars.nombre_negocio  ?? '')
    .replace(/\{\{Numero_Orden\}\}/gi,    String(vars.numero_orden ?? ''))
    .replace(/\{\{Tracking\}\}/gi,        vars.tracking        ?? '')
    .replace(/\{\{Courier\}\}/gi,         vars.courier         ?? '')
    .replace(/\{\{Fecha_Entrega\}\}/gi,   vars.fecha_entrega   ?? '')
}

/**
 * Construye la URL de WhatsApp Click-to-Chat.
 * Abre WhatsApp Web (desktop) o la app nativa (mobile) con el mensaje pre-escrito.
 */
export function buildWhatsAppUrl(phone: string, mensaje: string): string {
  const numero = normalizeWhatsApp(phone)
  if (!numero) return ''
  const texto = encodeURIComponent(mensaje)
  return `https://api.whatsapp.com/send?phone=${numero}&text=${texto}`
}

/** Plantilla por defecto si el tenant no configuró una propia */
export const PLANTILLA_DEFAULT = `Hola {{Nombre_Cliente}}! 🎉 Somos {{Nombre_Negocio}}.

Tu pedido #{{Numero_Orden}} está listo para ser enviado. 📦

🚚 Courier: {{Courier}}
📍 Tracking: {{Tracking}}
📅 Fecha estimada: {{Fecha_Entrega}}

¿Hay alguien para recibirlo? Avisanos cualquier duda. ¡Gracias!`
