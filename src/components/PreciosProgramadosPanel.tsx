import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useConfirm } from '@/hooks/useConfirm'
import { fmtPesos } from '@/lib/formato'
import { formatearVigencia } from '@/lib/precioProgramado'

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  aplicado: { texto: 'Aplicado', clase: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  cancelado: { texto: 'Cancelado', clase: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  fallido: { texto: 'No se aplicó', clase: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

/**
 * E2 del relevamiento de precio programado — dónde se ven los cambios pendientes (y los últimos 30 días),
 * con la opción de cancelarlos antes de la fecha (A3). La escritura va por `fn_cancelar_precio_programado`
 * (mig 422), que valida el mismo permiso que cambiar un precio.
 */
export function PreciosProgramadosPanel({ puedeEditar }: { puedeEditar: boolean }) {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const confirmar = useConfirm()

  // `precios_programados` tiene DOS FK a `users` (creado_por, cancelado_por): el embed va calificado por
  // columna o PostgREST responde "más de una relación".
  const SELECT = 'id, precio_venta, precio_anterior, vigente_desde, estado, created_at, aplicado_at, cancelado_at, error, ' +
    'productos(id, nombre, sku, precio_venta), creador:users!creado_por(nombre_display)'

  const { data: pendientes = [], isLoading: cargandoPendientes } = useQuery({
    queryKey: ['precios-programados', tenant?.id, 'pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('precios_programados').select(SELECT)
        .eq('tenant_id', tenant!.id).eq('estado', 'pendiente')
        .order('vigente_desde', { ascending: true }).limit(500)
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!tenant,
  })

  const { data: historial = [] } = useQuery({
    queryKey: ['precios-programados', tenant?.id, 'historial'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const { data, error } = await supabase.from('precios_programados').select(SELECT)
        .eq('tenant_id', tenant!.id).neq('estado', 'pendiente').gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(50)
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!tenant,
  })

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('fn_cancelar_precio_programado', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cambio de precio cancelado')
      qc.invalidateQueries({ queryKey: ['precios-programados'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <CalendarClock size={18} className="text-accent-text" />
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Cambios de precio programados</h2>
          <span className="ml-auto text-xs text-gray-400">{pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}</span>
        </div>
        {cargandoPendientes ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-gray-400" size={20} /></div>
        ) : pendientes.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            No hay cambios de precio programados. Se programan desde la ficha del producto, al cambiar el precio de
            venta y elegir "Programar fecha y hora".
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium text-right">Precio hoy</th>
                  <th className="px-3 py-2 font-medium text-right">Precio nuevo</th>
                  <th className="px-3 py-2 font-medium">Rige desde</th>
                  <th className="px-3 py-2 font-medium">Programó</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {pendientes.map(pp => (
                  <tr key={pp.id} data-precio-programado={pp.id}>
                    <td className="px-5 py-2.5">
                      <Link to={`/productos/${pp.productos?.id}/editar`} className="font-medium text-gray-800 dark:text-gray-100 hover:underline">
                        {pp.productos?.nombre ?? '—'}
                      </Link>
                      <span className="block text-xs text-gray-400">{pp.productos?.sku}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtPesos(Number(pp.productos?.precio_venta ?? 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtPesos(Number(pp.precio_venta))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatearVigencia(pp.vigente_desde)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{pp.creador?.nombre_display ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      {puedeEditar && (
                        <button type="button" disabled={cancelar.isPending}
                          onClick={async () => {
                            if (await confirmar(`¿Cancelar el cambio de "${pp.productos?.nombre}" a ${fmtPesos(Number(pp.precio_venta))}? Sigue rigiendo el precio actual.`, { danger: true })) {
                              cancelar.mutate(pp.id)
                            }
                          }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {historial.length > 0 && (
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Últimos 30 días</h3>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {historial.map(pp => {
              const et = ETIQUETA_ESTADO[pp.estado] ?? { texto: pp.estado, clase: '' }
              return (
                <li key={pp.id} className="px-5 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${et.clase}`}>{et.texto}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-100">{pp.productos?.nombre ?? '—'}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {pp.precio_anterior != null && <>{fmtPesos(Number(pp.precio_anterior))} → </>}{fmtPesos(Number(pp.precio_venta))}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {pp.estado === 'aplicado' && pp.aplicado_at ? `aplicado ${formatearVigencia(pp.aplicado_at)}`
                      : pp.estado === 'cancelado' && pp.cancelado_at ? `cancelado ${formatearVigencia(pp.cancelado_at)}`
                        : `para ${formatearVigencia(pp.vigente_desde)}`}
                  </span>
                  {pp.estado === 'fallido' && pp.error && (
                    <span className="basis-full text-xs text-red-600 dark:text-red-400">{pp.error}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
