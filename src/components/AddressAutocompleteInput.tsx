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

type Sugg = { label: string; value: string; placeId: string }

// Nominatim con addressdetails=1 → dirección limpia + coordenadas
async function searchNominatim(q: string): Promise<Sugg[]> {
  try {
    const params = new URLSearchParams({
      q, format: 'jsonv2', limit: '6', countrycodes: 'ar',
      'accept-language': 'es', addressdetails: '1',
    })
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'User-Agent': 'Genesis360App/1.0' } }
    )
    const data: any[] = await res.json()
    return data.map(d => {
      const a = d.address ?? {}
      const calle  = a.road ?? a.pedestrian ?? a.street ?? ''
      const num    = a.house_number ?? ''
      const local  = a.suburb ?? a.city_district ?? a.town ?? a.city ?? a.municipality ?? ''
      const prov   = a.state ?? ''
      const parts  = [
        calle ? (num ? `${calle} ${num}` : calle) : '',
        local,
        prov !== local ? prov : '',
      ].filter(Boolean)
      const label = parts.join(', ') || d.display_name.replace(/, Argentina$/, '')
      return { label, value: label, placeId: `${d.lat},${d.lon}` }
    })
  } catch { return [] }
}

// Google Places AutocompleteService — maneja API clásica (callback) y nueva (Promise)
async function searchGoogle(svc: any, q: string): Promise<Sugg[]> {
  return new Promise(resolve => {
    // Safety: si en 2s no responde nada, devolver vacío
    const timer = setTimeout(() => resolve([]), 2000)
    const done  = (items: Sugg[]) => { clearTimeout(timer); resolve(items) }
    const map   = (preds: any[]) => preds.map(p => ({
      label: p.description, value: p.description, placeId: p.place_id ?? '',
    }))
    try {
      const result = svc.getPlacePredictions(
        { input: q, componentRestrictions: { country: 'ar' } },
        (preds: any[], status: string) => {   // callback (API clásica)
          if (preds?.length && status === 'OK') done(map(preds))
          else done([])
        }
      )
      // API nueva (v:weekly) devuelve Promise además del callback
      if (result?.then) {
        result
          .then((r: any) => { if (r?.predictions?.length) done(map(r.predictions)) })
          .catch(() => {})
      }
    } catch { done([]) }
  })
}

export function AddressAutocompleteInput({
  value, onChange, onPlaceSelected,
  placeholder = 'Escribí una dirección...',
  className = '',
  disabled = false,
  savedAddresses = [],
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const svcRef   = useRef<any>(null)     // AutocompleteService de Google

  const [suggs,   setSuggs]   = useState<Sugg[]>([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)

  // Inicializar AutocompleteService una sola vez
  useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return
    getGoogleMapsLoader()
      .then(() => importLibrary('places'))
      .then((places: any) => { svcRef.current = new places.AutocompleteService() })
      .catch(() => { /* sin Google, usa Nominatim */ })
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // El tipeo actualiza el padre inmediatamente; la búsqueda ocurre en background
  const handleChange = (raw: string) => {
    onChange(raw)                          // actualiza el input en React al instante
    if (timerRef.current) clearTimeout(timerRef.current)
    if (raw.length < 2) { setSuggs([]); setLoading(false); return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      let results: Sugg[] = []
      if (svcRef.current) {
        results = await searchGoogle(svcRef.current, raw)
      }
      if (results.length === 0) {
        results = await searchNominatim(raw)
      }
      setSuggs(results)
      setLoading(false)
    }, 300)
  }

  const filteredSaved = savedAddresses.filter(
    a => a.toLowerCase().includes(value.toLowerCase()) && a !== value
  )
  const showDrop = open && (filteredSaved.length > 0 || suggs.length > 0)

  const pick = (label: string, placeId = '') => {
    onChange(label)
    onPlaceSelected?.(label, placeId)
    setSuggs([])
    setOpen(false)
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
        {loading && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
      </div>

      {showDrop && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto">

          {filteredSaved.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wide">Guardadas del cliente</p>
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
              <p className="text-[10px] font-semibold text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wide">Sugerencias</p>
              {suggs.map((s, i) => (
                <button key={`g${i}`} onMouseDown={e => { e.preventDefault(); pick(s.value, s.placeId) }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 leading-snug line-clamp-2">{s.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
