import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2, AlertTriangle } from 'lucide-react'
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

// Singleton: evita reintentar Maps si ya falló en esta sesión
let mapsErrorDetected = false

function destroyAutocomplete(autocompleteRef: React.MutableRefObject<any>, inputEl: HTMLInputElement | null) {
  try {
    if (autocompleteRef.current) {
      const g = (window as any).google
      if (g?.maps?.event) g.maps.event.clearInstanceListeners(inputEl)
      autocompleteRef.current = null
    }
  } catch { /* silencioso */ }
}

// Nominatim (OpenStreetMap) — fallback gratuito sin API key
async function buscarNominatim(query: string): Promise<{ label: string; value: string }[]> {
  if (query.length < 3) return []
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({ q: query, format: 'jsonv2', limit: '6',
        countrycodes: 'ar', 'accept-language': 'es', addressdetails: '0' })
    const res = await fetch(url, { headers: { 'User-Agent': 'Genesis360App/1.0' } })
    const data: any[] = await res.json()
    return data.map(d => {
      // Quitar el último token ", Argentina" para mostrar más compacto
      const label = (d.display_name as string).replace(/, Argentina$/, '')
      return { label, value: d.display_name }
    })
  } catch {
    return []
  }
}

export function AddressAutocompleteInput({
  value, onChange, onPlaceSelected,
  placeholder = 'Escribí una dirección...',
  className = '',
  disabled = false,
  savedAddresses = [],
}: Props) {
  const inputRef        = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const nominatimTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [mapsReady,    setMapsReady]    = useState(false)
  const [mapsLoading,  setMapsLoading]  = useState(false)
  const [mapsError,    setMapsError]    = useState(mapsErrorDetected)
  const [showSaved,    setShowSaved]    = useState(false)
  const [nominatimRes, setNominatimRes] = useState<{ label: string; value: string }[]>([])
  const [loadingNom,   setLoadingNom]   = useState(false)

  // Detecta errores de Maps (ApiNotActivatedMapError, gm_authFailure, etc.)
  useEffect(() => {
    if (mapsErrorDetected) return
    const onError = (e: ErrorEvent) => {
      const msg = (e.message ?? '').toLowerCase()
      if (msg.includes('notactivated') || msg.includes('api not activated') ||
          msg.includes('apierror') || msg.includes('mapsapi')) {
        mapsErrorDetected = true
        destroyAutocomplete(autocompleteRef, inputRef.current)
        setMapsReady(false)
        setMapsError(true)
      }
    }
    const prevAuthFail = (window as any).gm_authFailure
    ;(window as any).gm_authFailure = () => {
      mapsErrorDetected = true
      destroyAutocomplete(autocompleteRef, inputRef.current)
      setMapsReady(false)
      setMapsError(true)
      prevAuthFail?.()
    }
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('error', onError)
      if ((window as any).gm_authFailure === (window as any).gm_authFailure)
        (window as any).gm_authFailure = prevAuthFail
    }
  }, [])

  // Cargar Maps JS API
  useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY || mapsError) return
    setMapsLoading(true)
    getGoogleMapsLoader()
      .then(() => { if (!mapsErrorDetected) setMapsReady(true) })
      .catch(() => { mapsErrorDetected = true; setMapsError(true) })
      .finally(() => setMapsLoading(false))
  }, [mapsError])

  // Inicializar Google Places Autocomplete
  useEffect(() => {
    if (!mapsReady || !inputRef.current || autocompleteRef.current || mapsError) return
    importLibrary('places').then((places: any) => {
      if (mapsErrorDetected) return
      try {
        autocompleteRef.current = new places.Autocomplete(inputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'ar' },
          fields: ['formatted_address', 'place_id'],
        })
        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current?.getPlace()
          if (!place) return
          const address = place.formatted_address ?? inputRef.current!.value
          onChange(address)
          onPlaceSelected?.(address, place.place_id ?? '')
          setNominatimRes([])
        })
      } catch { mapsErrorDetected = true; setMapsError(true) }
    }).catch(() => { mapsErrorDetected = true; setMapsError(true) })
  }, [mapsReady, mapsError])

  // Cleanup al desmontar
  useEffect(() => () => {
    destroyAutocomplete(autocompleteRef, inputRef.current)
    if (nominatimTimer.current) clearTimeout(nominatimTimer.current)
  }, [])

  // Nominatim fallback: buscar cuando Maps no está disponible
  useEffect(() => {
    if (!mapsError) return
    if (nominatimTimer.current) clearTimeout(nominatimTimer.current)
    if (value.length < 3) { setNominatimRes([]); return }
    setLoadingNom(true)
    nominatimTimer.current = setTimeout(async () => {
      const results = await buscarNominatim(value)
      setNominatimRes(results)
      setLoadingNom(false)
    }, 450)
  }, [value, mapsError])

  // Dropdown: direcciones guardadas del cliente (filtradas por lo que se escribió)
  const filteredSaved = savedAddresses.filter(a =>
    a.toLowerCase().includes(value.toLowerCase()) && a !== value
  )

  const showDropdown = showSaved && (filteredSaved.length > 0 || (mapsError && nominatimRes.length > 0))

  const selectAddress = (addr: string) => {
    onChange(addr)
    onPlaceSelected?.(addr, '')
    setNominatimRes([])
    setShowSaved(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
        <input
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setShowSaved(true)}
          onBlur={() => setTimeout(() => setShowSaved(false), 200)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full pl-8 pr-8 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:border-accent ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {(mapsLoading || loadingNom) && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Dropdown unificado: guardadas + Nominatim fallback */}
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
            </>
          )}

          {mapsError && nominatimRes.length > 0 && (
            <>
              {filteredSaved.length > 0 && <div className="border-t border-gray-100 dark:border-gray-700" />}
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wide">
                Sugerencias
              </p>
              {nominatimRes.map((r, i) => (
                <button key={`n${i}`}
                  onMouseDown={e => { e.preventDefault(); selectAddress(r.value) }}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-sm hover:bg-accent/5 transition-colors">
                  <MapPin size={12} className="text-accent flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700 dark:text-gray-300 leading-snug line-clamp-2">{r.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {mapsError && (
        <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
          <AlertTriangle size={10} /> Usando sugerencias de OpenStreetMap (Google Maps no disponible)
        </p>
      )}
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && !mapsError && (
        <p className="text-[10px] text-amber-500 mt-1">
          ⚠ Google Maps no configurado — ingresá la dirección manualmente
        </p>
      )}
    </div>
  )
}
