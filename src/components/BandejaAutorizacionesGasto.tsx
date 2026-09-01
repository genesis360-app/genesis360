// Bandeja de autorizaciones de gasto pendientes (v1.8.43)
// SUPERVISOR ve las solicitudes de CAJEROs · DUEÑO/ADMIN ven todas.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X, Clock, ShieldCheck, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { puedeAprobar } from '@/lib/umbralGasto'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'

type Estado = 'pendiente' | 'aprobada' | 'rechazada'

export default function BandejaAutorizacionesGasto() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [filtroEstado, setFiltroEstado] = useState<Estado>('pendiente')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState<Record<string, string>>({})
  const [procesando, setProcesando] = useState<string | null>(null)

  // C1 (Supervisión, mig 389): vive en la tabla genérica `autorizaciones` (modulo='gastos'), no
  // en `autorizaciones_gasto` (eliminada) — monto/descripcion/payload/sucursal_id/gasto_id/
  // solicitante_rol quedan dentro de `datos_cambio` jsonb. Jerarquía de aprobación propia de
  // Gastos (puedeAprobar()) — a propósito NO usa `useSupervisorAutorizaciones`/
  // `SupervisionPanel` (esos asumen el permiso `supervisa` fijo, no una jerarquía relativa
  // solicitante-vs-aprobador).
  const { data: autorizaciones = [], isLoading } = useQuery({
    queryKey: ['autorizaciones-gasto', tenant?.id, filtroEstado],
    queryFn: async () => {
      const { data } = await supabase.from('autorizaciones')
        .select('*, solicitante:users!solicitado_por(nombre_display, rol), aprobador:users!aprobado_por(nombre_display, rol)')
        .eq('tenant_id', tenant!.id)
        .eq('modulo', 'gastos')
        .eq('estado', filtroEstado)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Filtrar según rol del usuario actual (SUPERVISOR solo ve CAJERO)
  const visibles = (autorizaciones as any[]).filter((a: any) => {
    if (!user) return false
    if (filtroEstado !== 'pendiente') return true // historial: todos ven todo
    return puedeAprobar(a.datos_cambio?.solicitante_rol, user.rol)
  })

  const aprobar = async (auth: any) => {
    if (!puedeAprobar(auth.datos_cambio?.solicitante_rol, user!.rol)) return toast.error('Tu rol no puede aprobar esta solicitud')
    setProcesando(auth.id)
    try {
      const p = auth.datos_cambio?.payload ?? {}
      const gastoId: string | null = auth.datos_cambio?.gasto_id ?? null
      let resultGastoId: string | null = gastoId

      if (auth.tipo === 'crear') {
        const { data: ins, error } = await supabase.from('gastos').insert(p).select('id').single()
        if (error) throw error
        resultGastoId = ins.id
      } else if (auth.tipo === 'editar' && gastoId) {
        const { error } = await supabase.from('gastos').update(p).eq('id', gastoId)
        if (error) throw error
      } else if (auth.tipo === 'eliminar' && gastoId) {
        const { error } = await supabase.from('gastos').delete().eq('id', gastoId)
        if (error) throw error
      }

      const { error: updErr } = await supabase.from('autorizaciones').update({
        estado: 'aprobada',
        aprobado_por: user!.id,
        datos_cambio: { ...auth.datos_cambio, gasto_id: resultGastoId },
      }).eq('id', auth.id)
      if (updErr) throw updErr

      logActividad({ entidad: 'autorizacion_gasto', entidad_id: auth.id, entidad_nombre: auth.datos_cambio?.descripcion, accion: 'aprobar', pagina: '/gastos' })
      toast.success(`Solicitud aprobada · ${auth.tipo} ejecutado`)
      qc.invalidateQueries({ queryKey: ['autorizaciones-gasto'] })
      qc.invalidateQueries({ queryKey: ['gastos'] })
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo aprobar')
    } finally {
      setProcesando(null)
    }
  }

  const rechazar = async (auth: any) => {
    if (!puedeAprobar(auth.datos_cambio?.solicitante_rol, user!.rol)) return toast.error('Tu rol no puede rechazar esta solicitud')
    const motivo = (motivoRechazo[auth.id] ?? '').trim()
    if (!motivo) return toast.error('Ingresá un motivo del rechazo')
    setProcesando(auth.id)
    try {
      const { error } = await supabase.from('autorizaciones').update({
        estado: 'rechazada',
        aprobado_por: user!.id,
        motivo_rechazo: motivo,
      }).eq('id', auth.id)
      if (error) throw error
      logActividad({ entidad: 'autorizacion_gasto', entidad_id: auth.id, entidad_nombre: auth.datos_cambio?.descripcion, accion: 'rechazar', valor_nuevo: motivo, pagina: '/gastos' })
      toast.success('Solicitud rechazada')
      qc.invalidateQueries({ queryKey: ['autorizaciones-gasto'] })
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

  const labelTipo: Record<string, string> = { crear: 'Crear gasto', editar: 'Editar gasto', eliminar: 'Eliminar gasto' }
  const estadoCls: Record<Estado, string> = {
    pendiente:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    aprobada:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    rechazada:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
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
        <span className="ml-auto text-xs text-gray-400">{visibles.length} solicitud{visibles.length === 1 ? '' : 'es'}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-text" /></div>
      ) : visibles.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <ShieldCheck size={36} className="mb-3 opacity-30" />
          <p className="text-sm">No hay solicitudes {filtroEstado === 'pendiente' ? 'pendientes' : filtroEstado === 'aprobada' ? 'aprobadas' : 'rechazadas'}</p>
          {filtroEstado === 'pendiente' && <p className="text-xs mt-1">Cuando un CAJERO/SUPERVISOR supera su umbral, las solicitudes aparecen acá.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map((a: any) => {
            const expanded = expandedId === a.id
            const puedeYo = puedeAprobar(a.datos_cambio?.solicitante_rol, user?.rol ?? '')
            return (
              <div key={a.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpandedId(expanded ? null : a.id)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{labelTipo[a.tipo] ?? a.tipo}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${estadoCls[a.estado as Estado]}`}>{a.estado}</span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{a.datos_cambio?.solicitante_rol}: {a.solicitante?.nombre_display ?? '—'}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200 mt-0.5 truncate">{a.datos_cambio?.descripcion}</p>
                    <div className="flex gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                      <span>Monto: <strong className="text-gray-700 dark:text-gray-200">{fmtMonto(a.datos_cambio?.monto)}</strong></span>
                      <span><Clock size={11} className="inline -mt-0.5 mr-0.5" />{fmtFecha(a.created_at)}</span>
                    </div>
                  </div>
                  {a.estado === 'pendiente' && puedeYo && (
                    <button onClick={() => aprobar(a)} disabled={procesando === a.id}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                      <Check size={12} /> Aprobar
                    </button>
                  )}
                  {a.estado === 'pendiente' && !puedeYo && (
                    <span className="text-xs text-gray-400 italic" title="Tu rol no puede aprobar esta solicitud">No autorizado</span>
                  )}
                </div>

                {expanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                    {a.notas && (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Motivo de la solicitud</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200">{a.notas}</p>
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
                        Resuelto por <strong>{a.aprobador.nombre_display}</strong> ({a.aprobador.rol}) — {a.updated_at ? fmtFecha(a.updated_at) : ''}
                      </p>
                    )}
                    {a.datos_cambio?.payload && (
                      <details className="text-xs text-gray-400">
                        <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Ver payload completo</summary>
                        <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-x-auto font-mono text-[10px]">{JSON.stringify(a.datos_cambio.payload, null, 2)}</pre>
                      </details>
                    )}
                    {a.estado === 'pendiente' && puedeYo && (
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
