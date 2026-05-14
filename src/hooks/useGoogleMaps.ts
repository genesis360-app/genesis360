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

/** Calcula la distancia en km entre dos direcciones usando Distance Matrix API */
export async function calcularDistanciaKm(origen: string, destino: string): Promise<number | null> {
  try {
    await getGoogleMapsLoader()
    // importar DistanceMatrixService
    const { DistanceMatrixService } = await importLibrary('routes') as any
    return new Promise(resolve => {
      const service = new DistanceMatrixService()
      service.getDistanceMatrix(
        { origins: [origen], destinations: [destino], travelMode: 'DRIVING' },
        (response: any, status: any) => {
          if (status !== 'OK' || !response) { resolve(null); return }
          const element = response.rows[0]?.elements[0]
          if (element?.status !== 'OK') { resolve(null); return }
          resolve(Math.round((element.distance.value / 1000) * 10) / 10)
        }
      )
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
