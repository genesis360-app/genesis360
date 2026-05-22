import { useState, useEffect } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

let initialized = false
let loadPromise: Promise<void> | null = null

export function getGoogleMapsLoader(): Promise<void> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY no configurada'))
  if (initialized) return Promise.resolve()

  if (!loadPromise) {
    setOptions({ key: apiKey, v: 'weekly', language: 'es', region: 'AR' })
    loadPromise = importLibrary('places').then(() => { initialized = true })
  }
  return loadPromise
}

// Haversine — distancia en línea recta (fallback sin Maps)
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10
}

// Geocodifica una dirección con Nominatim → lat/lon
async function geocodeNominatim(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const params = new URLSearchParams({
      q: address, format: 'jsonv2', limit: '1', countrycodes: 'ar',
    })
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'User-Agent': 'Genesis360App/1.0' } }
    )
    const data = await res.json()
    if (!data?.[0]) return null
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
  } catch { return null }
}

// Parsea "lat,lon" string → LatLng object de Maps (o devuelve el string original)
function toMapsLocation(s: string): any {
  const m = s.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  return s
}

function parseResponseKm(r: any): number | null {
  const el = r?.rows?.[0]?.elements?.[0]
  if (!el || el.status !== 'OK') return null
  return Math.round((el.distance.value / 1000) * 10) / 10
}

/**
 * Calcula la distancia en km entre dos puntos.
 * Intenta en orden:
 * 1. Google Maps DistanceMatrixService (global google.maps o importLibrary routes)
 * 2. Haversine usando coordenadas de Nominatim como fallback
 */
export async function calcularDistanciaKm(origen: string, destino: string): Promise<number | null> {
  if (!origen || !destino) return null

  // ─── Intento 1: Google Maps DistanceMatrixService ──────────────────────────
  try {
    await getGoogleMapsLoader()

    // Preferir el global google.maps (siempre disponible tras cargar Maps JS)
    const g = (window as any).google
    let DistanceMatrixService = g?.maps?.DistanceMatrixService
    if (!DistanceMatrixService) {
      // Fallback: importLibrary routes
      const routes = await importLibrary('routes') as any
      DistanceMatrixService = routes?.DistanceMatrixService
    }

    if (DistanceMatrixService) {
      const svc = new DistanceMatrixService()
      const request = {
        origins:      [toMapsLocation(origen)],
        destinations: [toMapsLocation(destino)],
        travelMode:   'DRIVING',
      }
      const km = await new Promise<number | null>(resolve => {
        const timer = setTimeout(() => resolve(null), 6000)
        const done  = (v: number | null) => { clearTimeout(timer); resolve(v) }
        try {
          // API nueva (Promise) — la preferimos
          const p = svc.getDistanceMatrix(request)
          if (p?.then) {
            p.then((r: any) => done(parseResponseKm(r))).catch(() => done(null))
          } else {
            // API clásica (callback) como último recurso
            svc.getDistanceMatrix(request, (r: any, status: string) => {
              done(status === 'OK' ? parseResponseKm(r) : null)
            })
          }
        } catch { done(null) }
      })
      if (km !== null) return km
    }
  } catch { /* continúa con Haversine */ }

  // ─── Intento 2: Haversine con geocodificación Nominatim ───────────────────
  try {
    // Parsear destino si ya tiene coordenadas
    const destCoords = destino.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
    const destPt = destCoords
      ? { lat: parseFloat(destCoords[1]), lon: parseFloat(destCoords[2]) }
      : await geocodeNominatim(destino)

    const origenCoords = origen.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
    const origenPt = origenCoords
      ? { lat: parseFloat(origenCoords[1]), lon: parseFloat(origenCoords[2]) }
      : await geocodeNominatim(origen)

    if (origenPt && destPt) {
      // Haversine × 1.35 = aproximación de distancia por carretera
      const lineal = haversineKm(origenPt.lat, origenPt.lon, destPt.lat, destPt.lon)
      return Math.round(lineal * 1.35 * 10) / 10
    }
  } catch { /* silencioso */ }

  return null
}

export function useGoogleMapsReady() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getGoogleMapsLoader()
      .then(() => setReady(true))
      .catch(e => setError(e.message))
  }, [])

  return { ready, error }
}
