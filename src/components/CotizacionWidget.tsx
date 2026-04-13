import { useState, useRef, useEffect } from 'react'
import { DollarSign, RefreshCw, Check, X, ChevronDown } from 'lucide-react'
import { useCotizacion, TIPOS_DOLAR } from '@/hooks/useCotizacion'

export function CotizacionWidget() {
  const { cotizacion, updatedAt, guardar, fetchDesdeApi, loadingApi } = useCotizacion()
  const [editing, setEditing]     = useState(false)
  const [inputVal, setInputVal]   = useState('')
  const [showMenu, setShowMenu]   = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const startEdit = () => {
    setInputVal(cotizacion > 0 ? cotizacion.toString() : '')
    setEditing(true)
  }

  const handleSave = async () => {
    const val = parseFloat(inputVal)
    if (!isNaN(val) && val > 0) await guardar(val)
    else if (inputVal === '' || val === 0) await guardar(0)
    setEditing(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  handleSave()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1.5 mb-1">
        <DollarSign size={12} className="text-blue-500 dark:text-blue-300 flex-shrink-0" />
        <span className="text-blue-500 dark:text-blue-300 text-xs font-medium tracking-wide">Cotización USD</span>
      </div>

      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-blue-700 dark:text-blue-200 text-xs whitespace-nowrap">$1 USD =</span>
          <input
            type="number" onWheel={e => e.currentTarget.blur()} min="0" step="1"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKey}
            autoFocus
            className="flex-1 px-2 py-1 bg-accent/20 dark:bg-accent/30 text-gray-900 dark:text-white text-xs rounded-lg border border-accent focus:outline-none min-w-0"
            placeholder="ej: 1250"
          />
          <button onClick={handleSave} className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex-shrink-0">
            <Check size={13} />
          </button>
          <button onClick={() => setEditing(false)} className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 flex-shrink-0">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-1">
          <button
            onClick={startEdit}
            className="text-gray-900 dark:text-white text-sm font-semibold hover:text-blue-600 dark:hover:text-blue-200 transition-colors text-left truncate"
          >
            {cotizacion > 0
              ? `$${cotizacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS`
              : <span className="text-blue-500 dark:text-blue-400 text-xs font-normal italic">Sin cotización</span>
            }
          </button>

          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowMenu(v => !v)}
              disabled={loadingApi}
              title="Actualizar desde API"
              className="flex items-center gap-0.5 text-blue-500 dark:text-blue-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingApi ? 'animate-spin' : ''} />
              <ChevronDown size={10} />
            </button>

            {showMenu && (
              <div className="absolute bottom-full right-0 mb-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 py-1 z-[60] w-36">
                <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-1">Obtener automático:</p>
                {TIPOS_DOLAR.map(t => (
                  <button
                    key={t.casa}
                    onClick={() => { fetchDesdeApi(t.casa); setShowMenu(false) }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {cotizacion > 0 && updatedAt && !editing && (
        <p className="text-blue-500 dark:text-blue-400 text-xs mt-0.5 truncate">
          {new Date(updatedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      )}
    </div>
  )
}
