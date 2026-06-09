// ── EN3 — Reparto: repartidores + hoja de ruta + transportista ───────────────
// Lógica pura (testeable). G1 productividad · G3 cumplimiento + orden por proximidad
// E1 expiración de token · E2 incidencias · E4 identidad · E5 notif "en camino".
import { haversineKm } from './enviosPod'

export const NOTIF_EN_CAMINO = [
  { v: 'no',          t: 'No notificar' },
  { v: 'wa',          t: 'WhatsApp "en camino" (recomendado)' },
  { v: 'wa_tracking', t: 'WhatsApp + link de seguimiento' },
] as const

export const IDENTIDAD_MODOS = [
  { v: 'anonimo',   t: 'Anónimo por link (default)' },
  { v: 'nombre_dni', t: 'Pedir nombre + DNI al abrir' },
] as const

export const HOJA_RUTA_MODOS = [
  { v: 'por_envio',            t: 'Un link por envío' },
  { v: 'agrupada',            t: 'Hoja agrupada por chofer' },
  { v: 'agrupada_proximidad', t: 'Hoja agrupada + orden por proximidad' },
] as const

export const INCIDENCIA_TIPOS = [
  { v: 'rotura',    t: 'Paquete roto / dañado' },
  { v: 'direccion', t: 'Problema con la dirección' },
  { v: 'cliente',   t: 'Problema con el cliente' },
  { v: 'otro',      t: 'Otro' },
] as const

export interface EnvioReparto {
  id: string
  repartidor_id?: string | null
  estado: string
  lat?: number | null
  lon?: number | null
  zona_entrega?: string | null
  hora_entrega_acordada?: string | null
}

export interface ProductividadRepartidor {
  repartidorId: string | null
  asignados: number
  entregados: number
  devueltos: number
  pendientes: number
  pctCumplimiento: number
}

/** G1 — Productividad por repartidor: asignados / entregados / devueltos / pendientes / % cumplimiento. */
export function productividadRepartidor(envios: EnvioReparto[]): ProductividadRepartidor[] {
  const map = new Map<string | null, ProductividadRepartidor>()
  for (const e of envios) {
    const id = e.repartidor_id ?? null
    const acc = map.get(id) ?? { repartidorId: id, asignados: 0, entregados: 0, devueltos: 0, pendientes: 0, pctCumplimiento: 0 }
    acc.asignados++
    if (e.estado === 'entregado') acc.entregados++
    else if (e.estado === 'devolucion' || e.estado === 'cancelado') acc.devueltos++
    else acc.pendientes++
    map.set(id, acc)
  }
  return [...map.values()].map(a => ({
    ...a,
    pctCumplimiento: a.asignados > 0 ? Math.round((a.entregados / a.asignados) * 100) : 0,
  }))
}

/** G3 — Cumplimiento del día: entregados sobre el total planificado. */
export function cumplimientoDia(envios: EnvioReparto[]): { total: number; entregados: number; pendientes: number; pct: number } {
  const total = envios.length
  const entregados = envios.filter(e => e.estado === 'entregado').length
  const pendientes = envios.filter(e => !['entregado', 'devolucion', 'cancelado'].includes(e.estado)).length
  return { total, entregados, pendientes, pct: total > 0 ? Math.round((entregados / total) * 100) : 0 }
}

/**
 * G3/E3 — Ordena los envíos para la hoja de ruta.
 *   Si hay coordenadas y `proximidad`, usa vecino más cercano (nearest-neighbor) desde el origen.
 *   Si no hay coords, ordena estable por zona y hora acordada.
 */
export function ordenarHojaRuta(
  envios: EnvioReparto[],
  opts: { proximidad?: boolean; origen?: { lat: number; lon: number } | null } = {},
): EnvioReparto[] {
  const conCoords = envios.filter(e => e.lat != null && e.lon != null)
  if (opts.proximidad && conCoords.length >= 2 && opts.origen) {
    const restantes = [...conCoords]
    const ruta: EnvioReparto[] = []
    let actual = opts.origen
    while (restantes.length > 0) {
      let mejorIdx = 0
      let mejorDist = Infinity
      for (let i = 0; i < restantes.length; i++) {
        const d = haversineKm(actual.lat, actual.lon, restantes[i].lat!, restantes[i].lon!)
        if (d < mejorDist) { mejorDist = d; mejorIdx = i }
      }
      const sig = restantes.splice(mejorIdx, 1)[0]
      ruta.push(sig)
      actual = { lat: sig.lat!, lon: sig.lon! }
    }
    // los sin coords van al final, en orden estable
    return [...ruta, ...envios.filter(e => e.lat == null || e.lon == null)]
  }
  // Fallback estable por zona + hora
  return [...envios].sort((a, b) => {
    const za = (a.zona_entrega ?? '').localeCompare(b.zona_entrega ?? '')
    if (za !== 0) return za
    return (a.hora_entrega_acordada ?? '99:99').localeCompare(b.hora_entrega_acordada ?? '99:99')
  })
}

/**
 * E1 — Fecha de expiración del token al compartir con el transportista.
 *   'dias'        → ahora + N días.
 *   'al_entregar' → null (lo limpia el cron al marcar entregado/cancelado/devolución).
 */
export function tokenExpiraAt(politica: string, dias: number, ahora: Date = new Date()): string | null {
  if (politica === 'dias') {
    const d = new Date(ahora)
    d.setDate(d.getDate() + (Number(dias) || 30))
    return d.toISOString()
  }
  return null
}
