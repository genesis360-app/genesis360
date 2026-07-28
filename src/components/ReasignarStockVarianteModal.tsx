import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, Package, MapPin, Split, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import {
  cantidadDe, totalAsignado, restanteDeLinea, totalAMover,
  construirAsignaciones, validarBorrador, repartirEnPartesIguales,
  type BorradorAsignacion, type LineaSinAsignar,
} from '@/lib/reasignacionVariante'
import toast from 'react-hot-toast'

interface Hijo {
  id: string
  variante_diferenciador: string | null
  sku: string
}

interface Props {
  madreId: string
  madreNombre: string
  hijos: Hijo[]
  onClose: () => void
}

/**
 * Pantalla de resolución del stock "sin variante asignada" (Fase 4 del rediseño UoM).
 * Reparte el stock que quedó colgando de la madre agrupadora entre sus variantes hijo.
 *
 * 🛑 Regla #0: la UI solo arma el pedido — todo lo mueve `fn_reasignar_stock_variante` (mig 309)
 * en UNA transacción, con las líneas bloqueadas y un par de `movimientos_stock` por asignación.
 */
export function ReasignarStockVarianteModal({ madreId, madreNombre, hijos, onClose }: Props) {
  const { tenant } = useAuthStore()
  const qc = useQueryClient()
  const [borrador, setBorrador] = useState<BorradorAsignacion>({})

  // Líneas de stock que todavía cuelgan de la MADRE. Sin filtro de sucursal a propósito: el stock
  // sin asignar hay que verlo COMPLETO, esté en la sucursal que esté (si no, quedaría stock
  // invisible e irresoluble para el usuario parado en otra sucursal).
  const { data: lineas = [], isLoading } = useQuery({
    queryKey: ['stock-sin-variante', madreId],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventario_lineas')
        .select('id, lpn, cantidad, cantidad_reservada, nro_lote, sucursales(nombre), ubicaciones(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', madreId)
        .eq('activo', true)
        .gt('cantidad', 0)
        .order('lpn')
      if (error) throw error
      return (data ?? []).map((l: any): LineaSinAsignar & { cantidad_reservada: number } => ({
        id: l.id,
        lpn: l.lpn,
        cantidad: l.cantidad,
        cantidad_reservada: l.cantidad_reservada ?? 0,
        nro_lote: l.nro_lote,
        sucursal_nombre: l.sucursales?.nombre ?? null,
        ubicacion_nombre: l.ubicaciones?.nombre ?? null,
      }))
    },
    enabled: !!tenant,
  })

  // Las líneas con reserva no se pueden mover (la RPC las rechaza): se listan aparte, informadas.
  const asignables = useMemo(() => lineas.filter(l => l.cantidad_reservada === 0), [lineas])
  const reservadas = useMemo(() => lineas.filter(l => l.cantidad_reservada > 0), [lineas])

  const totalSinAsignar = lineas.reduce((a, l) => a + l.cantidad, 0)
  const totalMoviendo = totalAMover(asignables, borrador)

  const setCant = (lineaId: string, hijoId: string, valor: string) => {
    setBorrador(prev => ({ ...prev, [lineaId]: { ...(prev[lineaId] ?? {}), [hijoId]: valor.replace(/[^0-9]/g, '') } }))
  }

  const reasignar = useMutation({
    mutationFn: async () => {
      const error = validarBorrador(asignables, borrador)
      if (error) throw new Error(error)
      const asignaciones = construirAsignaciones(asignables, borrador)
      const { data, error: rpcErr } = await supabase.rpc('fn_reasignar_stock_variante', {
        p_madre_id: madreId,
        p_asignaciones: asignaciones,
      })
      if (rpcErr) throw rpcErr
      return data as any
    },
    onSuccess: (data) => {
      toast.success(`${data?.unidades_reasignadas ?? 0} unidad(es) reasignadas a las variantes`)
      logActividad({
        entidad: 'producto', entidad_id: madreId, entidad_nombre: madreNombre,
        accion: 'editar', pagina: '/productos',
        campo: 'stock_sin_variante_asignada',
        valor_nuevo: `${data?.unidades_reasignadas ?? 0} u repartidas entre variantes`,
        tipo_transaccion: 'ajuste',
        producto_id: madreId,
      })
      qc.invalidateQueries({ queryKey: ['stock-sin-variante', madreId] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['producto-hijos'] })
      qc.removeQueries({ queryKey: ['producto', madreId] })
      if ((data?.stock_sin_asignar_restante ?? 0) === 0) onClose()
      else setBorrador({})
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Repartir stock sin variante asignada</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{madreNombre}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Explicación */}
        <div className="px-6 pt-4">
          <div className="flex gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Este producto pasó a ser un <strong>agrupador</strong> al crearle variantes, así que su stock
              propio <strong>ya no se puede vender</strong>. Sigue contando en inventario y en los reportes,
              pero recién vuelve a estar disponible cuando lo repartas entre las variantes.
            </p>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Cargando stock…</p>
          ) : lineas.length === 0 ? (
            <div className="text-center py-8">
              <Check size={32} className="mx-auto text-green-500 mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-300">No queda stock sin variante asignada.</p>
            </div>
          ) : (
            <>
              {asignables.length > 1 && hijos.length > 0 && (
                <button type="button"
                  onClick={() => setBorrador(repartirEnPartesIguales(asignables, hijos.map(h => h.id)))}
                  className="flex items-center gap-2 text-xs text-accent-text hover:underline">
                  <Split size={13} /> Repartir todo en partes iguales
                </button>
              )}

              {asignables.map(linea => {
                const restante = restanteDeLinea(linea, borrador)
                const excedido = restante < 0
                return (
                  <div key={linea.id} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-700/40">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-gray-100">
                        <Package size={14} className="text-gray-400" /> {linea.lpn}
                      </span>
                      {linea.sucursal_nombre && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <MapPin size={11} /> {linea.sucursal_nombre}
                        </span>
                      )}
                      {linea.ubicacion_nombre && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{linea.ubicacion_nombre}</span>
                      )}
                      {linea.nro_lote && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Lote {linea.nro_lote}</span>
                      )}
                      <span className={`ml-auto text-xs font-medium ${excedido ? 'text-red-600 dark:text-red-400' : restante === 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        {excedido
                          ? `Te pasaste por ${-restante} de ${linea.cantidad}`
                          : `${restante} de ${linea.cantidad} sin repartir`}
                      </span>
                    </div>
                    <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {hijos.map(h => (
                        <label key={h.id} className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 text-xs text-gray-600 dark:text-gray-300 truncate"
                            title={h.variante_diferenciador ?? h.sku}>
                            {h.variante_diferenciador ?? h.sku}
                          </span>
                          <input
                            type="text" inputMode="numeric"
                            value={borrador[linea.id]?.[h.id] ?? ''}
                            onChange={e => setCant(linea.id, h.id, e.target.value)}
                            placeholder="0"
                            className="w-16 shrink-0 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-right bg-white dark:bg-gray-700 focus:outline-none focus:border-accent-text"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}

              {reservadas.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    Con unidades reservadas (no se pueden repartir todavía)
                  </p>
                  {reservadas.map(l => (
                    <p key={l.id} className="text-xs text-gray-500 dark:text-gray-400">
                      {l.lpn} — {l.cantidad} u, {l.cantidad_reservada} reservada(s) para un pedido.
                      Liberá la reserva y volvé.
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {lineas.length > 0 && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <p className="flex-1 text-xs text-gray-500 dark:text-gray-400">
              {totalSinAsignar} unidad(es) sin asignar · repartiendo <strong>{totalMoviendo}</strong>
            </p>
            <button onClick={onClose}
              className="border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 px-4 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
              Cerrar
            </button>
            <button
              onClick={() => reasignar.mutate()}
              disabled={reasignar.isPending || totalMoviendo === 0 || !!validarBorrador(asignables, borrador)}
              className="bg-accent hover:bg-accent/90 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50">
              {reasignar.isPending ? 'Repartiendo…' : 'Repartir'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
