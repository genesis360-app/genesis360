// U-2 (decisión de GO 2026-10-01): en modo avanzado el stock que vuelve sin pasar por una pantalla de ingreso (anular una
// venta despachada, cancelar un traslado cuya línea de origen ya no existe) entra con la ubicación que ELIGE la persona —
// el sistema no presupone dónde quedó físicamente. Modal con desplegable (puede haber muchas ubicaciones).
//
//   const { pedirUbicacion, modalUbicacion } = useElegirUbicacion()
//   const ubic = await pedirUbicacion({ titulo, mensaje, sucursalId })   // null = canceló
//   ... {modalUbicacion} en el JSX
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface PedidoUbicacion {
  titulo: string
  mensaje: string
  /** Sucursal donde queda el stock: se ofrecen sus ubicaciones y las globales. */
  sucursalId: string | null
  confirmText?: string
}

export function useElegirUbicacion() {
  const [pedido, setPedido] = useState<(PedidoUbicacion & { resolver: (v: string | null) => void }) | null>(null)

  const pedirUbicacion = useCallback((p: PedidoUbicacion) =>
    new Promise<string | null>(resolve => setPedido({ ...p, resolver: resolve })), [])

  const cerrar = (v: string | null) => { pedido?.resolver(v); setPedido(null) }

  const modalUbicacion = pedido ? <ElegirUbicacionModal pedido={pedido} onCerrar={cerrar} /> : null
  return { pedirUbicacion, modalUbicacion }
}

function ElegirUbicacionModal({ pedido, onCerrar }: { pedido: PedidoUbicacion; onCerrar: (v: string | null) => void }) {
  const { tenant } = useAuthStore()
  const [elegida, setElegida] = useState('')
  const { data: ubicaciones = [], isLoading } = useQuery({
    queryKey: ['ubicaciones-elegir', tenant?.id, pedido.sucursalId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ubicaciones').select('id, nombre, sucursal_id, disponible_surtido')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      if (error) throw error
      return (data ?? []).filter((u: any) => !u.sucursal_id || !pedido.sucursalId || u.sucursal_id === pedido.sucursalId)
    },
    enabled: !!tenant,
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => onCerrar(null)}>
      <div role="dialog" aria-modal="true" aria-label={pedido.titulo}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-accent/10">
            <MapPin size={20} className="text-accent-text" />
          </div>
          <div className="min-w-0 pt-1.5">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">{pedido.titulo}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{pedido.mensaje}</p>
          </div>
        </div>
        <select value={elegida} onChange={e => setElegida(e.target.value)} aria-label="Ubicación" disabled={isLoading}
          className="w-full px-3 py-2 mb-4 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text">
          <option value="" disabled>{isLoading ? 'Cargando…' : 'Elegí la ubicación…'}</option>
          {(ubicaciones as any[]).map((u: any) => (
            <option key={u.id} value={u.id}>{u.nombre}{u.disponible_surtido === false ? ' (no habilitada para venta)' : ''}</option>
          ))}
        </select>
        {!isLoading && (ubicaciones as any[]).length === 0 && (
          <p className="text-xs text-red-500 mb-3">No hay ubicaciones activas en esta sucursal. Creá una en Configuración → Inventario → Ubicaciones.</p>
        )}
        <div className="flex gap-2">
          <button onClick={() => onCerrar(null)}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Volver
          </button>
          <button onClick={() => onCerrar(elegida)} disabled={!elegida}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
            {pedido.confirmText ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
