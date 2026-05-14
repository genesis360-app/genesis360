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

export function AddressAutocompleteInput({
  value, onChange, onPlaceSelected,
  placeholder = 'Escribí una dirección...',
  className = '',
  disabled = false,
  savedAddresses = [],
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [mapsReady, setMapsReady] = useState(false)
  const [mapsLoading, setMapsLoading] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return
    setMapsLoading(true)
    getGoogleMapsLoader()
      .then(() => setMapsReady(true))
      .catch(() => {})
      .finally(() => setMapsLoading(false))
  }, [])

  useEffect(() => {
    if (!mapsReady || !inputRef.current || autocompleteRef.current) return

    importLibrary('places').then((places: any) => {
      autocompleteRef.current = new places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'ar' },
        fields: ['formatted_address', 'place_id'],
      })

      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace()
        const address = place.formatted_address ?? inputRef.current!.value
        onChange(address)
        onPlaceSelected?.(address, place.place_id ?? '')
      })
    }).catch(() => {})
  }, [mapsReady])

  const filteredSaved = savedAddresses.filter(a =>
    a.toLowerCase().includes(value.toLowerCase()) && a !== value
  )

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
        {mapsLoading && (
          <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Direcciones guardadas del cliente */}
      {showSaved && filteredSaved.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden">
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 px-3 pt-2 pb-1 uppercase tracking-wide">
            Direcciones guardadas del cliente
          </p>
          {filteredSaved.map((addr, i) => (
            <button key={i}
              onMouseDown={e => { e.preventDefault(); onChange(addr); onPlaceSelected?.(addr, '') }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <MapPin size={12} className="text-accent flex-shrink-0" />
              <span className="truncate text-gray-700 dark:text-gray-300">{addr}</span>
            </button>
          ))}
        </div>
      )}

      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="text-[10px] text-amber-500 mt-1">
          ⚠ Google Maps no configurado — ingresá la dirección manualmente y calculá el costo en forma manual
        </p>
      )}
    </div>
  )
}
