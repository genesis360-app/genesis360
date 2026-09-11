import { useState } from 'react'
import { DollarSign, RefreshCw, Check, X } from 'lucide-react'
import { useCotizacion } from '@/hooks/useCotizacion'

export function CotizacionWidget() {
  const { cotizacion, cotizacionCompra, updatedAt, puedeElegirTipo, guardar, fetchDesdeApi, loadingApi } = useCotizacion()
  const [editing, setEditing]     = useState(false)
  const [inputVal, setInputVal]   = useState('')

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

  // Compras/Gastos en USD (relevamiento B2, 2026-08-21): "si no se actualizó ese día, debe aparecer
  // una notificación avisando que hay que actualizarla — salvo que ya lo haya hecho otro usuario".
  // cotizacion_usd_updated_at es UN valor por tenant (no por usuario) — si cualquiera la actualizó
  // hoy, todos ven la misma fecha de hoy acá, así que comparar contra "hoy" ya cubre el "salvo que
  // ya lo haya hecho otro usuario" sin necesitar tracking extra.
  const desactualizada = cotizacion > 0 && updatedAt
    ? new Date(updatedAt).toDateString() !== new Date().toDateString()
    : false

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
            className="flex-1 px-2 py-1 bg-accent/20 dark:bg-accent/30 text-gray-900 dark:text-white text-xs rounded-lg border border-accent-text focus:outline-none min-w-0"
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
          {puedeElegirTipo ? (
            <button
              onClick={startEdit}
              className="text-gray-900 dark:text-white text-sm font-semibold hover:text-blue-600 dark:hover:text-blue-200 transition-colors text-left truncate"
            >
              {cotizacion > 0
                ? <>{cotizacionCompra > 0 && <span className="text-blue-400 dark:text-blue-500 font-normal text-xs">Venta: </span>}${cotizacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS</>
                : <span className="text-blue-500 dark:text-blue-400 text-xs font-normal italic">Sin cotización</span>
              }
            </button>
          ) : (
            <span className="text-gray-900 dark:text-white text-sm font-semibold text-left truncate">
              {cotizacion > 0
                ? <>{cotizacionCompra > 0 && <span className="text-blue-400 dark:text-blue-500 font-normal text-xs">Venta: </span>}${cotizacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS</>
                : <span className="text-blue-500 dark:text-blue-400 text-xs font-normal italic">Sin cotización</span>
              }
            </span>
          )}

          {/* Fede 2026-09-04: ya no hay tipo de dólar para elegir (siempre Oficial BNA) — un único
              botón de refresco para cualquier rol, ya no hace falta el menú desplegable. */}
          <button
            onClick={() => fetchDesdeApi()}
            disabled={loadingApi}
            title="Actualizar cotización (Oficial BNA)"
            className="flex-shrink-0 text-blue-500 dark:text-blue-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingApi ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {cotizacionCompra > 0 && !editing && (
        <p className="text-blue-500 dark:text-blue-400 text-[11px] mt-0.5 truncate">
          Compra: ${cotizacionCompra.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </p>
      )}

      {cotizacion > 0 && updatedAt && !editing && (
        <p className={`text-xs mt-0.5 truncate ${desactualizada ? 'text-amber-500 dark:text-amber-400 font-medium' : 'text-blue-500 dark:text-blue-400'}`}>
          {new Date(updatedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
          {desactualizada && ' · ⚠ actualizala'}
        </p>
      )}
    </div>
  )
}
