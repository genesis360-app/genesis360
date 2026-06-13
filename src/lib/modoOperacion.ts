// ─── Modo de operación: Básico vs Avanzado (WMS) ─────────────────────────────
// 'basico'   = experiencia simplificada (kiosco/almacén/pyme chica): nav reducido,
//              productos sin tracking, stock simple. Solo capa de PRESENTACIÓN.
// 'avanzado' = sistema completo (WMS, OC/recepciones, envíos, trazabilidad).
//              Feature de plan Pro+ (el trial lo prueba vía features de Pro).
//
// Invariante: el modo gatea UI, nunca datos. Los flujos de datos se gatean por
// producto (tiene_series/tiene_lote/tiene_vencimiento), como siempre. Un producto
// heredado con tracking sigue pidiendo sus datos aun en básico.

export type ModoOperacion = 'basico' | 'avanzado'
export type MotivoBasico = 'toggle_off' | 'plan_insuficiente' | null

/**
 * Avanzado EFECTIVO = el tenant lo activó Y el plan lo permite (puede_wms).
 * Si el tenant baja de plan o se le vence el trial con el toggle activo,
 * cae a básico automáticamente (sin tocar datos).
 * `killSwitchOn` viene de MODO_BASICO_ENABLED: en false todo el SaaS opera
 * en avanzado como antes de v1.55 (rollback global sin tocar la DB).
 */
export function esModoAvanzado(
  modoOperacion: string | null | undefined,
  puedeWms: boolean,
  killSwitchOn: boolean = true,
): boolean {
  if (!killSwitchOn) return true
  return modoOperacion === 'avanzado' && puedeWms
}

/** Por qué el tenant está operando en básico (para mensajes en Config). */
export function motivoBasico(
  modoOperacion: string | null | undefined,
  puedeWms: boolean,
  killSwitchOn: boolean = true,
): MotivoBasico {
  if (esModoAvanzado(modoOperacion, puedeWms, killSwitchOn)) return null
  if (modoOperacion === 'avanzado' && !puedeWms) return 'plan_insuficiente'
  return 'toggle_off'
}

/**
 * Regla de integridad: un producto que YA tiene tracking activado sigue
 * exigiendo sus datos (serie/lote/vencimiento) en cada movimiento, aun en
 * modo básico. Nunca se mueve stock trackeado "a ciegas".
 */
export function productoRequiereTracking(producto: {
  tiene_series?: boolean | null
  tiene_lote?: boolean | null
  tiene_vencimiento?: boolean | null
} | null | undefined): boolean {
  if (!producto) return false
  return !!(producto.tiene_series || producto.tiene_lote || producto.tiene_vencimiento)
}

// Rubros que suelen necesitar trazabilidad completa (series/lotes/vencimientos
// o depósito formal) — se usa para SUGERIR el modo avanzado tras el onboarding.
const TIPOS_SUGIEREN_AVANZADO = [
  'Casa de repuestos',          // números de serie
  'Construcción / Materiales',  // depósito + volumen
  'Electrónica / Tecnología',   // series / IMEI
  'Farmacia',                   // lotes + vencimientos (regulatorio)
  'Ferretería',                 // depósito + ubicaciones
  'Perfumería / Cosmética',     // lotes + vencimientos
  'Veterinaria',                // medicamentos: lotes + vencimientos
]

/** ¿El tipo de comercio sugiere activar el modo avanzado? (solo sugerencia, queda en básico) */
export function sugiereModoAvanzado(tipoComercio: string | null | undefined): boolean {
  if (!tipoComercio) return false
  return TIPOS_SUGIEREN_AVANZADO.includes(tipoComercio)
}
