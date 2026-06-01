// Catálogo compartido de couriers y servicios.
// Fuente única usada por EnviosPage (módulo Envíos) y VentasPage (POS) para que
// el select de "Servicio" sea idéntico en ambos lados (ISS-174 Parte 1).
//
// Cuando entren las APIs directas (ISS-174 F2+), los servicios reales que devuelva
// cada courier por cotización pueden superar a esta lista; esta queda como fallback
// para alta manual / couriers sin API.

export const COURIERS = ['OCA', 'Correo Argentino', 'Andreani', 'DHL Express', 'Otro'] as const

export type Courier = (typeof COURIERS)[number]

export const SERVICIOS_POR_COURIER: Record<string, string[]> = {
  'OCA':              ['Estándar', 'Urgente', 'OCA al Centro', 'Plus', 'Internacional'],
  'Correo Argentino': ['Encomienda Clásica', 'Encomienda Plus', 'Small Pack', 'Express'],
  'Andreani':         ['Estándar', 'Urgente', 'Expreso'],
  'DHL Express':      ['Express Worldwide', 'Economy Select', 'Express Easy'],
  'Otro':             ['Estándar', 'Urgente', 'Personalizado'],
}

/** Servicios disponibles para un courier; [] si no se reconoce. */
export function serviciosDe(courier: string | null | undefined): string[] {
  if (!courier) return []
  return SERVICIOS_POR_COURIER[courier] ?? []
}

// ── Credenciales de API por courier (ISS-174 F1) ──────────────────────────────
// Couriers con integración de API directa planificada, en orden de implementación.
export const COURIERS_API = ['Andreani', 'Correo Argentino', 'OCA'] as const

export interface CampoCredencial {
  key: string
  label: string
  secreto?: boolean
  placeholder?: string
}

// Campos que se piden por courier. Los nombres de campo definitivos se confirman al
// integrar cada API (F2+); el storage es JSONB en courier_credenciales.credenciales,
// así que ajustar esta lista no requiere migración.
export const CAMPOS_CREDENCIALES: Record<string, CampoCredencial[]> = {
  // Andreani: API REST. Login Basic (usuario/password) → token; cotización/orden usan contrato + cliente.
  'Andreani': [
    { key: 'usuario',      label: 'Usuario API' },
    { key: 'password',     label: 'Contraseña API', secreto: true },
    { key: 'nro_contrato', label: 'Nº de contrato' },
    { key: 'nro_cliente',  label: 'Nº de cliente / sucursal origen', placeholder: 'opcional' },
  ],
  // Correo Argentino (Mi Correo Empresas / Paq.ar): REST con usuario + password + nº de cliente.
  'Correo Argentino': [
    { key: 'usuario',     label: 'Usuario' },
    { key: 'password',    label: 'Contraseña', secreto: true },
    { key: 'nro_cliente', label: 'Nº de cliente' },
  ],
  // OCA ePak: web service SOAP. Usuario(email) + password + CUIT + nº de cuenta/operativa.
  'OCA': [
    { key: 'usuario',    label: 'Usuario / Email' },
    { key: 'password',   label: 'Contraseña', secreto: true },
    { key: 'cuit',       label: 'CUIT' },
    { key: 'nro_cuenta', label: 'Nº de cuenta / operativa' },
  ],
}

export function camposCredencialesDe(courier: string): CampoCredencial[] {
  return CAMPOS_CREDENCIALES[courier] ?? []
}

/** True si el courier tiene integración de API (cotizar/generar). */
export function esCourierApi(courier: string | null | undefined): boolean {
  return !!courier && (COURIERS_API as readonly string[]).includes(courier)
}
