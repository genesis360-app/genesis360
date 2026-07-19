// Bandeja de autorizaciones de CC pendientes (v1.8.44) — solo DUEÑO aprueba
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X, Clock, ShieldAlert, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'

type Estado = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada'

export default function BandejaAutorizacionesCC() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [filtroEstado, setFiltroEstado] = useState<Estado>('pendiente')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState<Record<string, string>>({})
  const [procesando, setProcesando] = useState<string | null>(null)

  const esDueno = ['DUEÑO', 'ADMIN', 'SUPER_USUARIO'].includes(user?.rol ?? '')

  const { data: autorizaciones = [], isLoading } = useQuery({
    queryKey: ['autorizaciones-cc', tenant?.id, filtroEstado],
    queryFn: async () => {
      const { data } = await supabase.from('autorizaciones_cc')
        .select('*, proveedor:proveedores(nombre), solicitante:users!autorizaciones_cc_solicitante_id_fkey(nombre_display, rol), aprobador:users!autorizaciones_cc_aprobador_id_fkey(nombre_display, rol)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', filtroEstado)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  const aprobar = async (auth: any) => {
    if (!esDueno) return toast.error('Solo el DUEÑO puede aprobar overrides de CC')
    setProcesando(auth.id)
    try {
      const { error } = await supabase.from('autorizaciones_cc').update({
        estado: 'aprobada',
        aprobador_id: user!.id,
        aprobador_rol: user!.rol,
        resolved_at: new Date().toISOString(),
      }).eq('id', auth.id)
      if (error) throw error
      logActividad({ entidad: 'autorizacion_gasto', entidad_id: auth.id, entidad_nombre: `CC ${auth.proveedor?.nombre}`, accion: 'aprobar', pagina: '/gastos' })
      toast.success('Override CC aprobado. El solicitante puede registrar el pago.')
      qc.invalidateQueries({ queryKey: ['autorizaciones-cc'] })
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo aprobar')
    } finally {
      setProcesando(null)
    }
  }

  const rechazar = async (auth: any) => {
    if (!esDueno) return toast.error('Solo el DUEÑO puede rechazar')
    const motivo = (motivoRechazo[auth.id] ?? '').trim()
    if (!motivo) return toast.error('Ingresá un motivo del rechazo')
    setProcesando(auth.id)
    try {
      const { error } = await supabase.from('autorizaciones_cc').update({
        estado: 'rechazada',
        aprobador_id: user!.id,
        aprobador_rol: user!.rol,
        resolved_at: new Date().toISOString(),
        motivo_rechazo: motivo,
      }).eq('id', auth.id)
      if (error) throw error
      logActividad({ entidad: 'autorizacion_gasto', entidad_id: auth.id, entidad_nombre: `CC ${auth.proveedor?.nombre}`, accion: 'rechazar', valor_nuevo: motivo, pagina: '/gastos' })
      toast.success('Solicitud rechazada')
      qc.invalidateQueries({ queryKey: ['autorizaciones-cc'] })
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo rechazar')
    } finally {
      setProcesando(null)
    }
  }

  const fmtMonto = (n: number | null | undefined) =>
    n == null ? '—' : `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`

  const fmtFecha = (s: string) => new Date(s).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const motivoLabel: Record<string, string> = { limite_excedido: 'Límite CC excedido', oc_vencida: 'OC con CC vencida' }
  const estadoCls: Record<Estado, string> = {
    pendiente:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    aprobada:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    rechazada:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    cancelada:  'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        {(['pendiente', 'aprobada', 'rechazada'] as Estado[]).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors capitalize ${
              filtroEstado === e
                ? 'bg-accent text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {e}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">{autorizaciones.length} solicitud{autorizaciones.length === 1 ? '' : 'es'}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-text" /></div>
      ) : autorizaciones.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <ShieldAlert size={36} className="mb-3 opacity-30" />
          <p className="text-sm">No hay solicitudes de CC {filtroEstado === 'pendiente' ? 'pendientes' : filtroEstado === 'aprobada' ? 'aprobadas' : 'rechazadas'}</p>
          {filtroEstado === 'pendiente' && <p className="text-xs mt-1">Cuando alguien intenta crear una CC con un proveedor bloqueado (OC vencida o límite excedido), la solicitud aparece acá.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {(autorizaciones as any[]).map((a: any) => {
            const expanded = expandedId === a.id
            return (
              <div key={a.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpandedId(expanded ? null : a.id)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">Override CC: {a.proveedor?.nombre ?? '—'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${estadoCls[a.estado as Estado]}`}>{a.estado}</span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-red-600 dark:text-red-400 font-medium">{motivoLabel[a.motivo_bloqueo] ?? a.motivo_bloqueo}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200 mt-0.5 truncate">
                      {a.solicitante_rol}: {a.solicitante?.nombre_display ?? '—'}
                    </p>
                    <div className="flex gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                      <span>Monto: <strong className="text-gray-700 dark:text-gray-200">{fmtMonto(a.monto)}</strong></span>
                      <span><Clock size={11} className="inline -mt-0.5 mr-0.5" />{fmtFecha(a.created_at)}</span>
                    </div>
                  </div>
                  {a.estado === 'pendiente' && esDueno && (
                    <button onClick={() => aprobar(a)} disabled={procesando === a.id}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                      <Check size={12} /> Aprobar
                    </button>
                  )}
                  {a.estado === 'pendiente' && !esDueno && (
                    <span className="text-xs text-gray-400 italic">Solo DUEÑO</span>
                  )}
                </div>

                {expanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                    {a.motivo && (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Motivo de la solicitud</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200">{a.motivo}</p>
                      </div>
                    )}
                    {a.motivo_rechazo && (
                      <div>
                        <p className="text-xs text-red-500 mb-0.5 flex items-center gap-1"><AlertCircle size={12} /> Motivo del rechazo</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200">{a.motivo_rechazo}</p>
                      </div>
                    )}
                    {a.aprobador && (
                      <p className="text-xs text-gray-400">
                        Resuelto por <strong>{a.aprobador.nombre_display}</strong> ({a.aprobador_rol}) — {a.resolved_at ? fmtFecha(a.resolved_at) : ''}
                      </p>
                    )}
                    {a.estado === 'pendiente' && esDueno && (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input value={motivoRechazo[a.id] ?? ''}
                          onChange={e => setMotivoRechazo(m => ({ ...m, [a.id]: e.target.value }))}
                          placeholder="Motivo del rechazo (obligatorio si rechazás)"
                          className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <button onClick={() => rechazar(a)} disabled={procesando === a.id || !(motivoRechazo[a.id] ?? '').trim()}
                          className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                          <X size={14} /> Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
