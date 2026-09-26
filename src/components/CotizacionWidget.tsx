import { DollarSign, RefreshCw, AlertTriangle } from 'lucide-react'
import { useCotizacion } from '@/hooks/useCotizacion'
import { fechaCorta } from '@/lib/cotizacionBna'

// D-1 fase 2 (GO, 2026-09-25): el dólar sale solo del BNA (vendedor divisa del día hábil anterior)
// y ya no se carga a mano (A-4: "automática si hay fuente"). Se muestra SIEMPRE la fecha de la
// cotización en uso: si la captura falla se sigue con la anterior (A-2), y así se ve de qué día es.
export function CotizacionWidget() {
  const { cotizacion, fecha, aviso, cargando, actualizando, refrescar } = useCotizacion()

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1.5 mb-1">
        <DollarSign size={12} className="text-blue-500 dark:text-blue-300 flex-shrink-0" />
        <span className="text-blue-500 dark:text-blue-300 text-xs font-medium tracking-wide">Dólar BNA divisa</span>
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="text-gray-900 dark:text-white text-sm font-semibold text-left truncate">
          {cotizacion > 0
            ? <>${cotizacion.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS</>
            : <span className="text-blue-500 dark:text-blue-400 text-xs font-normal italic">{cargando ? 'Cargando…' : 'Sin cotización'}</span>
          }
        </span>
        <button
          onClick={() => refrescar()}
          disabled={actualizando}
          title="Actualizar cotización (Banco Nación, vendedor divisa)"
          className="flex-shrink-0 text-blue-500 dark:text-blue-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={actualizando ? 'animate-spin' : ''} />
        </button>
      </div>

      {fecha && (
        <p className="text-blue-500 dark:text-blue-400 text-[11px] mt-0.5 truncate" title="Vendedor divisa del día hábil anterior">
          Vendedor · del {fechaCorta(fecha)}
        </p>
      )}

      {aviso && (
        <p className={`text-[11px] mt-0.5 flex items-start gap-1 ${aviso.tipo === 'sin_cotizacion' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
          <AlertTriangle size={11} className="flex-shrink-0 mt-px" />
          <span>{aviso.texto}</span>
        </p>
      )}
    </div>
  )
}
