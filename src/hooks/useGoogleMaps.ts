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

// Parsea "lat,lon" a objeto LatLng si corresponde, si no devuelve el string original
function parseDestino(s: string): any {
  const m = s.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  return s
}

function parseDistancia(response: any): number | null {
  const element = response?.rows?.[0]?.elements?.[0]
  if (!element || element.status !== 'OK') return null
  return Math.round((element.distance.value / 1000) * 10) / 10
}

/** Calcula la distancia en km entre dos puntos/direcciones usando Distance Matrix API.
 *  Acepta texto libre ("Av. Corrientes 1515") o coordenadas ("lat,lon") como destino.
 *  Maneja tanto la API clásica (callback) como la nueva (Promise) de Maps v:weekly.
 */
export async function calcularDistanciaKm(origen: string, destino: string): Promise<number | null> {
  if (!origen || !destino) return null
  try {
    await getGoogleMapsLoader()
    const { DistanceMatrixService } = await importLibrary('routes') as any
    const service = new DistanceMatrixService()
    const request = {
      origins:      [parseDestino(origen)],
      destinations: [parseDestino(destino)],
      travelMode:   'DRIVING',
    }
    return await new Promise<number | null>(resolve => {
      // Safety: si en 8s no responde, devolver null
      const timer = setTimeout(() => resolve(null), 8000)
      const done  = (val: number | null) => { clearTimeout(timer); resolve(val) }

      try {
        const result = service.getDistanceMatrix(
          request,
          (response: any, status: string) => {   // callback — API clásica
            if (status === 'OK') done(parseDistancia(response))
            else done(null)
          }
        )
        // API nueva (v:weekly) devuelve Promise además del callback
        if (result?.then) {
          result
            .then((r: any) => done(parseDistancia(r)))
            .catch(() => done(null))
        }
      } catch { done(null) }
    })
  } catch {
    return null
  }
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
