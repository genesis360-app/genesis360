// ISS-174 — tipos compartidos del Edge Function de couriers (cotizar/generar/tracking).
// Cada adapter (Andreani/Correo/OCA) implementa CourierAdapter.

export type CourierCred = Record<string, string>

export interface CotizarParams {
  origen_cp: string
  destino_cp: string
  peso_kg: number
  largo_cm?: number
  ancho_cm?: number
  alto_cm?: number
  valor_declarado?: number
}

export interface CotizacionOpcion {
  courier: string
  servicio: string
  codigo_servicio: string
  precio: number
  plazo_dias: number | null
  disponible: boolean
  moneda: string
}

export interface DireccionEnvio {
  calle?: string
  numero?: string
  localidad?: string
  provincia?: string
  codigo_postal: string
  pais?: string
}

export interface GenerarParams {
  servicio?: string
  codigo_servicio?: string
  origen: DireccionEnvio
  destino: DireccionEnvio
  bulto: { peso_kg: number; largo_cm?: number; ancho_cm?: number; alto_cm?: number; valor_declarado?: number }
  destinatario: { nombre: string; email?: string; telefono?: string; documento?: string }
}

export interface GenerarResult {
  tracking_number: string | null
  tracking_url: string | null
  etiqueta_url: string | null
  courier_orden_id: string | null
  costo_real: number | null
}

export interface TrackingEvento { fecha?: string; estado: string; detalle?: string }
export interface TrackingResult { estado: string | null; eventos: TrackingEvento[] }

export interface ProbarResult {
  ok: boolean
  detalle?: string
}

export interface CourierAdapter {
  cotizar(cred: CourierCred, p: CotizarParams): Promise<CotizacionOpcion[]>
  generar(cred: CourierCred, p: GenerarParams): Promise<GenerarResult>
  tracking(cred: CourierCred, trackingNumber: string): Promise<TrackingResult>
  /** Valida las credenciales con el paso de auth más barato del courier (sin generar nada). */
  probar(cred: CourierCred): Promise<ProbarResult>
}

// Error de negocio que el router traduce a 400 con mensaje accionable.
export class CourierError extends Error {
  constructor(message: string) { super(message); this.name = 'CourierError' }
}

/** Volumen en cm³ a partir de las dimensiones (fallback 1000 cm³ si faltan). */
export function volumenCm3(p: { largo_cm?: number; ancho_cm?: number; alto_cm?: number }): number {
  const l = p.largo_cm ?? 10, a = p.ancho_cm ?? 10, h = p.alto_cm ?? 10
  return Math.max(1, Math.round(l * a * h))
}

// ── Logging diagnóstico ───────────────────────────────────────────────────────
// Capturamos el intercambio HTTP crudo (método/URL/status + body recortado) en los
// logs de la Edge Function para debuggear la PRIMERA prueba real con cuenta B2B.
// ⚠ Nunca logueamos las credenciales (cred): solo la respuesta del courier.
const DIAG_BODY_MAX = 600

/** Log estructurado de un paso del courier (visible en Supabase → Edge Function logs). */
export function courierLog(label: string, detail: string): void {
  console.log(`[courier-api] ${label} :: ${detail}`)
}

/**
 * fetch con logging diagnóstico. Loguea el request (método+URL) y la respuesta
 * (status + body recortado ante error). Clona la respuesta para no consumir el
 * stream que luego lee el adapter. Devuelve la Response intacta.
 */
export async function courierFetch(label: string, url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    console.error(`[courier-api] ${label} ${method} ${url} → ERROR de red: ${String(e)}`)
    throw e
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.clone().text()).slice(0, DIAG_BODY_MAX) } catch { /* body ilegible */ }
    console.error(`[courier-api] ${label} ${method} ${url} → ${res.status} ${res.statusText} :: ${body}`)
  } else {
    console.log(`[courier-api] ${label} ${method} ${url} → ${res.status}`)
  }
  return res
}
