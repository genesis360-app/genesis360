import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { getGoogleMapsLoader } from '@/hooks/useGoogleMaps'
import { importLibrary } from '@googlemaps/js-api-loader'

interface Props {
  value: string
  onChange: (address: string) => void
  onPlaceSelected?: (address: string, placeId: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  savedAddresses?: string[]
}

// placeId = google place_id O "lat,lon" para resultados de Nominatim
type Suggestion = { label: string; value: string; placeId?: string }

// Nominatim con addressdetails=1 → dirección limpia + coordenadas exactas
async function nominatimSearch(query: string): Promise<Suggestion[]> {
  if (query.length < 2) return []
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({ q: query, format: 'jsonv2', limit: '6',
        countrycodes: 'ar', 'accept-language': 'es', addressdetails: '1' })
    const res = await fetch(url, { headers: { 'User-Agent': 'Genesis360App/1.0' } })
    const data: any[] = await res.json()
    return data.map(d => {
      const addr = d.address ?? {}
      const parts: string[] = []
      const calle = addr.road ?? addr.pedestrian ?? addr.street ?? ''
      const numero = addr.house_number ?? ''
      if (calle) parts.push(numero ? `${calle} ${numero}` : calle)
      const localidad = addr.suburb ?? addr.city_district ?? addr.town ?? addr.city ?? addr.municipality ?? ''
      if (localidad) parts.push(localidad)
      const provincia = addr.state ?? ''
      if (provincia && provincia !== localidad) parts.push(provincia)
      const label = parts.length > 0 ? parts.join(', ') : (d.display_name as string).replace(/, Argentina$/, '')
      return { label, value: label, placeId: `${d.lat},${d.lon}` }
    })
  } catch { return [] }
}

export function AddressAutocompleteInput({
  value, onChange, onPlaceSelected,
  placeholder = 'Escribí una dirección...',
  className = '',
  disabled = false,
  savedAddresses = [],
}: Props) {
  const searchTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapsServiceRef = useRef<any>(null)   // google.maps.places.AutocompleteService

  const [mapsLoading, setMapsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading,     setLoading]     = useState(false)
  const [showDrop,    setShowDrop]    = useState(false)

  // ── Inicializar AutocompleteService una sola vez ────────────────────────────
  useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY || mapsServiceRef.current) return
    setMapsLoading(true)
    getGoogleMapsLoader()
      .then(() => importLibrary('places'))
      .then((places: any) => {
        try { mapsServiceRef.current = new places.AutocompleteService() }
        catch { /* usar Nominatim */ }
      })
      .catch(() => { /* usar Nominatim */ })
      .finally(() => setMapsLoading(false))
  }, [])

  // ── Buscar sugerencias cuando el usuario escribe ────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value || value.length < 2) { setSuggestions([]); return }

    setLoading(true)
    searchTimer.current = setTimeout(async () => {
      try {
        // Intentar Google Places AutocompleteService
        if (mapsServiceRef.current) {
          const svc = mapsServiceRef.current
          const googleResults = await new Promise<Suggestion[]>((resolve) => {
            svc.getPlacePredictions(
              { input: value, componentRestrictions: { country: 'ar' } },
              (preds: any[], status: string) => {
                if (preds && preds.length > 0 && status === 'OK') {
                  resolve(preds.map((p: any) => ({
                    label: p.description,
                    value: p.description,
                    placeId: p.place_id,
                  })))
                } else {
                  resolve([])
                }
              }
            )
          })
          if (googleResults.length > 0) {
            setSuggestions(googleResults)
            setLoading(false)
            return
          }
        }
      } catch { /* caer a Nominatim */ }

      // Fallback Nominatim
      const nominatim = await nominatimSearch(value)
      setSuggestions(nominatim)
      setLoading(false)
    }, 300)
  }, [value])

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
  }, [])

  const filteredSaved = savedAddresses.filter(a =>
    a.toLowerCase().includes(value.toLowerCase()) && a !== value
  )
  const showDropdown = showDrop && (filteredSaved.length > 0 || suggestions.length > 0)

  const selectAddress = (addr: string, placeId = '') => {
    onChange(addr)
    onPlaceSelected?.(addr, placeId)
    setSuggestions([])
    setShowDrop(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setShowDrop(true)}
          onBlur={() => setTimeout(() => setShowDrop(false), 200)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={`w-full pl-8 pr-8 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:border-accent ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {(mapsLoading || loading) && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto">
          {filteredSaved.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wide">
                Guardadas del cliente
              </p>
              {filteredSaved.map((addr, i) => (
                <button key={`s${i}`}
                  onMouseDown={e => { e.preventDefault(); selectAddress(addr) }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent flex-shrink-0" />
                  <span className="truncate text-gray-700 dark:text-gray-300">{addr}</span>
                </button>
              ))}
              {suggestions.length > 0 && <div className="border-t border-gray-100 dark:border-gray-700" />}
            </>
          )}
          {suggestions.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wide">
                Sugerencias
              </p>
              {suggestions.map((s, i) => (
                <button key={`g${i}`}
                  onMouseDown={e => { e.preventDefault(); selectAddress(s.value, s.placeId ?? '') }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 leading-snug line-clamp-2">{s.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="text-[10px] text-amber-500 mt-1">⚠ Ingresá la dirección manualmente</p>
      )}
    </div>
  )
}
