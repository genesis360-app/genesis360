/**
 * RepositoresPage — módulo NUEVO "Repositores" (Fase 1, mig 352).
 * Relevado con Fede/GO — ver G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md.
 *
 * Fase 1 = solo tareas de "cambiar el cartel de precio en la góndola", generadas automáticamente
 * por trigger de DB (cambio de precio o entrada a un estado con descuento) — nunca a mano. Prioridad
 * automática (C1-C3): vendida con el cartel desactualizado > precio subió > vencimiento cercano >
 * más vieja primero. NO incluye todavía: reposición física a góndola, asignación/reasignación,
 * etiquetas/impresión, notificaciones, reportes — quedan para fases siguientes.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Tags, Flame, TrendingUp, Clock, Check, X, Tag, CircleDot } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { moduloOculto, puedeEditarModulo } from '@/lib/permisosModulo'
import { logActividad } from '@/lib/actividadLog'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'

type FiltroEstado = 'activas' | 'completada' | 'cancelada'

const MOTIVOS_CANCELACION = ['Ya no aplica', 'Producto retirado de góndola', 'Error de carga', 'Otro']

export default function RepositoresPage() {
  const navigate = useNavigate()
  const { user, tenant } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const { avanzado: modoAvanzado } = useModoOperacion()
  const confirmar = useConfirm()
  const preguntar = usePrompt()
  const qc = useQueryClient()

  const [filtro, setFiltro] = useState<FiltroEstado>('activas')

  const oculto = moduloOculto(user, 'repositores')
  const puedeEditar = puedeEditarModulo(user, 'repositores')

  const { data: tareas = [], isLoading } = useQuery({
    queryKey: ['tareas-repositor', tenant?.id, sucursalId, filtro],
    queryFn: async () => {
      let q = supabase.from('vw_tareas_repositor')
        .select('*')
        .eq('tenant_id', tenant!.id)
      q = applyFilter(q)
      q = filtro === 'activas' ? q.in('estado', ['pendiente', 'en_curso']) : q.eq('estado', filtro)
      q = q
        .order('vendido_con_tag_desactualizado', { ascending: false })
        .order('precio_subio', { ascending: false })
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(200)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && modoAvanzado && !oculto,
  })

  const completarTarea = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await supabase.from('tareas_repositor')
        .update({ estado: 'completada', completed_at: new Date().toISOString() })
        .eq('id', t.id)
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: t.id, entidad_nombre: `Cartel ${t.producto_nombre}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'completada',
        pagina: '/repositores', sucursal_id: t.sucursal_id, producto_id: t.producto_id,
      })
    },
    onSuccess: () => {
      toast.success('Tarea completada')
      qc.invalidateQueries({ queryKey: ['tareas-repositor'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelarTarea = useMutation({
    mutationFn: async ({ t, motivo }: { t: any; motivo: string }) => {
      const { error } = await supabase.from('tareas_repositor')
        .update({ estado: 'cancelada', cancelled_at: new Date().toISOString(), motivo_cancelacion: motivo })
        .eq('id', t.id)
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: t.id, entidad_nombre: `Cartel ${t.producto_nombre}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'cancelada',
        pagina: '/repositores', sucursal_id: t.sucursal_id, producto_id: t.producto_id,
      })
    },
    onSuccess: () => {
      toast.success('Tarea cancelada')
      qc.invalidateQueries({ queryKey: ['tareas-repositor'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleCancelar = async (t: any) => {
    const motivo = await preguntar('¿Por qué se cancela esta tarea?', {
      titulo: 'Cancelar tarea', placeholder: MOTIVOS_CANCELACION[0],
    })
    if (motivo == null) return
    if (!(await confirmar(`¿Cancelar la tarea de "${t.producto_nombre}"?`, { danger: true }))) return
    cancelarTarea.mutate({ t, motivo: motivo.trim() || 'Sin motivo especificado' })
  }

  const handleCompletar = async (t: any) => {
    if (!(await confirmar(`¿Marcar como lista la tarea de "${t.producto_nombre}"?`))) return
    completarTarea.mutate(t)
  }

  if (oculto) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <Tags size={48} className="mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-lg font-medium">Sin acceso</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Tags size={22} className="text-accent-text" /> Repositores
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Cambios de precio y de estado que necesitan actualizar el cartel en la góndola.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {([['activas', 'Pendientes'], ['completada', 'Completadas'], ['cancelada', 'Canceladas']] as [FiltroEstado, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFiltro(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === key ? 'bg-accent text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Cargando tareas…</div>
      ) : (tareas as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <Tags size={40} className="mb-3 text-gray-200 dark:text-gray-700" />
          <p className="font-medium">{filtro === 'activas' ? 'No hay tareas pendientes' : 'Sin tareas en este filtro'}</p>
          {filtro === 'activas' && <p className="text-sm mt-1">Aparecen solas cuando cambia un precio o un producto entra en descuento.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {(tareas as any[]).map(t => (
            <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {t.tipo === 'cambio_precio' ? <Tag size={15} className="text-gray-500 dark:text-gray-400" /> : <CircleDot size={15} className="text-gray-500 dark:text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.producto_nombre}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t.producto_sku}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {t.tipo === 'cambio_precio'
                      ? <>Precio: ${Number(t.precio_anterior ?? 0).toLocaleString('es-AR')} → <strong>${Number(t.precio_nuevo ?? 0).toLocaleString('es-AR')}</strong></>
                      : <>Entra en estado <strong>{t.estado_nombre}</strong>{t.descuento_pct ? ` (-${t.descuento_pct}%)` : ''}</>}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {t.vendido_con_tag_desactualizado && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 inline-flex items-center gap-1">
                        <Flame size={10} /> Se vendió con el cartel desactualizado
                      </span>
                    )}
                    {t.precio_subio && (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 inline-flex items-center gap-1">
                        <TrendingUp size={10} /> Precio subió
                      </span>
                    )}
                    {t.fecha_vencimiento && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                        <Clock size={10} /> Vence {new Date(t.fecha_vencimiento).toLocaleDateString('es-AR')}
                      </span>
                    )}
                  </div>
                </div>
                {filtro === 'activas' && puedeEditar && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleCompletar(t)} disabled={completarTarea.isPending}
                      title="Marcar como lista"
                      className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-50 transition-colors">
                      <Check size={16} />
                    </button>
                    <button onClick={() => handleCancelar(t)} disabled={cancelarTarea.isPending}
                      title="Cancelar"
                      className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 disabled:opacity-50 transition-colors">
                      <X size={16} />
                    </button>
                  </div>
                )}
                {filtro === 'cancelada' && t.motivo_cancelacion && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 max-w-[140px] text-right">{t.motivo_cancelacion}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
