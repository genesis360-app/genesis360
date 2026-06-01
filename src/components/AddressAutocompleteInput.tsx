import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { getGoogleMapsLoader } from '@/hooks/useGoogleMaps'
import { importLibrary } from '@googlemaps/js-api-loader'

interface Props {
  value: string
  onChange: (address: string) => void
  onPlaceSelected?: (address: string, placeId: string, postcode?: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  savedAddresses?: string[]
}

type Sugg = { label: string; value: string; placeId: string; postcode?: string }

// ── Nominatim mejorado: usa display_name limpio + coordenadas ─────────────────
async function searchNominatim(q: string): Promise<Sugg[]> {
  if (q.length < 2) return []
  try {
    const params = new URLSearchParams({
      q, format: 'jsonv2', limit: '6', countrycodes: 'ar',
      'accept-language': 'es', addressdetails: '1',
    })
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'User-Agent': 'Genesis360App/1.0' } }
    )
    const data: any[] = await res.json()
    return data.map(d => {
      // Usamos display_name directo (más completo) solo limpiando el sufijo ", Argentina"
      const full = (d.display_name as string).replace(/, Argentina$/, '')
      // Label corto para mostrar: "Calle Número, Localidad, Provincia"
      const a = d.address ?? {}
      const calle  = a.road ?? a.pedestrian ?? a.street ?? ''
      const num    = a.house_number ?? ''
      const local  = a.suburb ?? a.city_district ?? a.town ?? a.city ?? a.municipality ?? ''
      const prov   = a.state ?? ''
      const parts  = [calle ? (num ? `${calle} ${num}` : calle) : '', local, prov !== local ? prov : ''].filter(Boolean)
      const label  = parts.length >= 2 ? parts.join(', ') : full
      return { label, value: full, placeId: `${d.lat},${d.lon}`, postcode: a.postcode ?? undefined }
    })
  } catch { return [] }
}

// ── Google Places — intenta nueva API primero, legacy como fallback ─────────────
async function searchGoogle(
  newApi: any,           // AutocompleteSuggestion class (Maps v3.55+)
  legacyApi: any,        // AutocompleteService instance (legacy)
  sessionToken: any,     // AutocompleteSessionToken
  q: string,
): Promise<Sugg[]> {

  // 1. Nueva API AutocompleteSuggestion (misma que Google Maps)
  if (newApi) {
    try {
      const { suggestions } = await newApi.fetchAutocompleteSuggestions({
        input: q,
        includedRegionCodes: ['ar'],
        sessionToken,
      })
      return (suggestions ?? []).map((s: any) => ({
        label: s.placePrediction?.text?.text ?? s.placePrediction?.mainText?.text ?? '',
        value: s.placePrediction?.text?.text ?? '',
        placeId: s.placePrediction?.placeId ?? '',
      })).filter((s: Sugg) => s.label)
    } catch { /* fallback a legacy */ }
  }

  // 2. API legacy AutocompleteService (callback-only, sin carrera con Promise)
  if (legacyApi) {
    try {
      return await new Promise<Sugg[]>(resolve => {
        const timer = setTimeout(() => resolve([]), 5000)
        legacyApi.getPlacePredictions(
          { input: q, componentRestrictions: { country: 'ar' } },
          (preds: any[], status: string) => {
            clearTimeout(timer)
            if (preds?.length && status === 'OK') {
              resolve(preds.map(p => ({ label: p.description, value: p.description, placeId: p.place_id ?? '' })))
            } else {
              resolve([])
            }
          }
        )
      })
    } catch { /* fallback a Nominatim */ }
  }

  return []
}

export function AddressAutocompleteInput({
  value, onChange, onPlaceSelected,
  placeholder = 'Escribí una dirección...',
  className = '',
  disabled = false,
  savedAddresses = [],
}: Props) {
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // APIs de Google
  const newApiRef     = useRef<any>(null)   // AutocompleteSuggestion class
  const legacyApiRef  = useRef<any>(null)   // AutocompleteService instance
  const sessionRef    = useRef<any>(null)   // AutocompleteSessionToken

  const [mapsLoading, setMapsLoading] = useState(false)
  const [suggs,       setSuggs]       = useState<Sugg[]>([])
  const [loading,     setLoading]     = useState(false)
  const [open,        setOpen]        = useState(false)

  // Inicializa APIs de Google una sola vez
  useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return
    setMapsLoading(true)
    getGoogleMapsLoader()
      .then(() => importLibrary('places'))
      .then((places: any) => {
        // Nueva API (Maps JS v3.55+ / v:weekly)
        if (places.AutocompleteSuggestion) {
          newApiRef.current    = places.AutocompleteSuggestion
          sessionRef.current   = places.AutocompleteSessionToken ? new places.AutocompleteSessionToken() : null
        }
        // Legacy API (siempre disponible como fallback)
        if (places.AutocompleteService) {
          legacyApiRef.current = new places.AutocompleteService()
        }
      })
      .catch(() => { /* sin Google, usa Nominatim */ })
      .finally(() => setMapsLoading(false))
  }, [])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  // El tipeo actualiza el padre inmediatamente; búsqueda en background
  const handleChange = (raw: string) => {
    onChange(raw)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (raw.length < 2) { setSuggs([]); setLoading(false); return }
    setLoading(true)
    searchTimer.current = setTimeout(async () => {
      let results: Sugg[] = []

      // Google Places (nueva API preferida → legacy → Nominatim)
      if (newApiRef.current || legacyApiRef.current) {
        results = await searchGoogle(newApiRef.current, legacyApiRef.current, sessionRef.current, raw)
      }

      // Nominatim si Google no da resultados o no está disponible
      if (results.length === 0) {
        results = await searchNominatim(raw)
      }

      setSuggs(results)
      setLoading(false)
    }, 250)   // 250ms debounce — más ágil
  }

  const filteredSaved = savedAddresses.filter(
    a => a.toLowerCase().includes(value.toLowerCase()) && a !== value
  )
  const showDrop = open && (filteredSaved.length > 0 || suggs.length > 0)

  const pick = (label: string, placeId = '', postcode?: string) => {
    onChange(label)
    onPlaceSelected?.(label, placeId, postcode)
    setSuggs([])
    setOpen(false)
    // Resetear sesión de Google para la próxima búsqueda (billing)
    if (newApiRef.current) {
      try {
        const { AutocompleteSessionToken } = (window as any).google?.maps?.places ?? {}
        if (AutocompleteSessionToken) sessionRef.current = new AutocompleteSessionToken()
      } catch { /* silencioso */ }
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
        <input
          value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={`w-full pl-8 pr-8 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:border-accent ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {(mapsLoading || loading) && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {showDrop && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden max-h-64 overflow-y-auto">

          {filteredSaved.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wide">
                Guardadas del cliente
              </p>
              {filteredSaved.map((a, i) => (
                <button key={`s${i}`} onMouseDown={e => { e.preventDefault(); pick(a) }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent shrink-0" />
                  <span className="truncate text-gray-700 dark:text-gray-300">{a}</span>
                </button>
              ))}
              {suggs.length > 0 && <div className="border-t border-gray-100 dark:border-gray-700" />}
            </>
          )}

          {suggs.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wide">
                Sugerencias
              </p>
              {suggs.map((s, i) => (
                <button key={`g${i}`} onMouseDown={e => { e.preventDefault(); pick(s.value, s.placeId, s.postcode) }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 leading-snug">{s.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
