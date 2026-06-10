// ISS-174 — cliente del Edge Function courier-api (cotizar / generar / tracking).
// Todas las llamadas pasan por la Edge Function (las credenciales nunca tocan el front).

import { supabase } from '@/lib/supabase'

export interface CotizacionOpcion {
  courier: string
  servicio: string
  codigo_servicio: string
  precio: number
  plazo_dias: number | null
  disponible: boolean
  moneda: string
}

export interface CotizarInput {
  courier: string
  origen_cp: string
  destino_cp: string
  peso_kg: number
  largo_cm?: number
  ancho_cm?: number
  alto_cm?: number
  valor_declarado?: number
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

// supabase.functions.invoke devuelve el body de error en error.context (Response).
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('courier-api', { body })
  if (error) {
    let msg = error.message
    try {
      const ctx = (error as any).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      }
    } catch { /* usa error.message */ }
    throw new Error(msg)
  }
  if ((data as any)?.error) throw new Error((data as any).error)
  return data as T
}

export async function cotizarEnvio(input: CotizarInput): Promise<CotizacionOpcion[]> {
  const data = await invoke<{ opciones: CotizacionOpcion[] }>({ action: 'cotizar', ...input })
  return data.opciones ?? []
}

export async function generarEnvioCourier(envioId: string, codigoServicio?: string): Promise<GenerarResult> {
  const data = await invoke<{ resultado: GenerarResult }>({ action: 'generar', envio_id: envioId, codigo_servicio: codigoServicio })
  return data.resultado
}

export async function trackingEnvioCourier(envioId: string): Promise<TrackingResult> {
  const data = await invoke<{ tracking: TrackingResult }>({ action: 'tracking', envio_id: envioId })
  return data.tracking
}

export interface ProbarResult {
  ok: boolean
  detalle?: string
}

/** Valida las credenciales GUARDADAS del courier (solo el paso de auth, no genera nada). */
export async function probarCredencialesCourier(courier: string): Promise<ProbarResult> {
  const data = await invoke<{ resultado: ProbarResult }>({ action: 'probar', courier })
  return data.resultado
}
