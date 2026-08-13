import { useState, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, UserCog, History, BarChart3 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { puedeSupervisarModulo } from '@/lib/permisosModulo'
import { AUT_PAGE_SIZES, type EstadoAutorizacion } from '@/hooks/useSupervisorAutorizaciones'

// Patrón "Pestaña de Supervisor" reusable (relevamiento derivado #2 hacia Repositores, decisiones
// A3/A4/B1/B2/E1/E2 — 2026-08-09). Sub-secciones: Aprobaciones (contenido específico del módulo,
// pasado como children) / Reasignar (genérico, vía asignado_a) / Trazabilidad (actividad_log filtrado)
// / KPIs (mini-dashboard del equipo). Un único componente reusable por otros módulos el día que se
// retrofiteen al patrón (hoy solo Inventario lo usa).

type SubTab = 'aprobaciones' | 'reasignar' | 'trazabilidad' | 'kpis'

interface Props {
  modulo: string
  autEstado: EstadoAutorizacion
  onEstadoChange: (e: EstadoAutorizacion) => void
  autorizaciones: any[]
  isLoading: boolean
  onReasignar: (id: string, usuarioId: string | null, usuarioNombre: string | null, entidadNombre: string) => Promise<void>
  resumenDe: (aut: any) => string
  children: ReactNode
  // Paginación (mismo patrón que HistorialPage.tsx) — opcional para no romper otros consumidores
  // del componente si algún día lo llaman sin pasarla.
  totalCount?: number
  page?: number
  pageSize?: number
  setPage?: (p: number | ((prev: number) => number)) => void
  setPageSize?: (n: number) => void
}

export function SupervisionPanel({
  modulo, autEstado, onEstadoChange, autorizaciones, isLoading, onReasignar, resumenDe, children,
  totalCount, page, pageSize, setPage, setPageSize,
}: Props) {
  const { tenant, user } = useAuthStore()
  const [subTab, setSubTab] = useState<SubTab>('aprobaciones')
  const [reasignando, setReasignando] = useState<string | null>(null)
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [cantidadInput, setCantidadInput] = useState('')
  const paginado = totalCount !== undefined && page !== undefined && pageSize !== undefined && !!setPage && !!setPageSize
  const totalPages = paginado ? Math.max(1, Math.ceil(totalCount! / pageSize!)) : 1

  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios-supervisa', modulo, tenant?.id],
    queryFn: async () => {
      // permisos_custom NO es una columna de `users` — se resuelve vía rol_custom_id → roles_custom.permisos
      // (mismo join que hace authStore.ts al cargar la sesión).
      const { data } = await supabase.from('users')
        .select('id, nombre_display, rol, rol_custom_id, roles_custom(permisos)')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return (data ?? [])
        .map((u: any) => ({ ...u, permisos_custom: u.roles_custom?.permisos ?? null }))
        .filter((u: any) => puedeSupervisarModulo(u, modulo))
    },
    enabled: !!tenant && subTab === 'reasignar',
  })

  const { data: trazabilidad = [] } = useQuery({
    queryKey: ['trazabilidad-supervision', modulo, tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('actividad_log')
        .select('id, accion, entidad_nombre, campo, valor_anterior, valor_nuevo, usuario_nombre, created_at')
        .eq('tenant_id', tenant!.id).eq('entidad', 'autorizacion').eq('pagina', `/${modulo}`)
        .order('created_at', { ascending: false }).limit(100)
      return data ?? []
    },
    enabled: !!tenant && subTab === 'trazabilidad',
  })

  const { data: kpis } = useQuery({
    queryKey: ['kpis-supervision', modulo, tenant?.id],
    queryFn: async () => {
      const desde = new Date(); desde.setDate(desde.getDate() - 30)
      const { data } = await supabase.from('autorizaciones')
        .select('estado, aprobado_por, users:aprobado_por(nombre_display)')
        .eq('tenant_id', tenant!.id).eq('modulo', modulo).gte('created_at', desde.toISOString())
      const rows = (data ?? []) as any[]
      const porPersona: Record<string, { nombre: string; aprobadas: number; rechazadas: number }> = {}
      let pendientesTotal = 0
      for (const r of rows) {
        if (r.estado === 'pendiente') { pendientesTotal++; continue }
        if (!r.aprobado_por) continue
        const nombre = r.users?.nombre_display ?? '—'
        porPersona[r.aprobado_por] ??= { nombre, aprobadas: 0, rechazadas: 0 }
        if (r.estado === 'aprobada') porPersona[r.aprobado_por].aprobadas++
        else if (r.estado === 'rechazada') porPersona[r.aprobado_por].rechazadas++
      }
      return { pendientesTotal, porPersona: Object.values(porPersona) }
    },
    enabled: !!tenant && subTab === 'kpis',
  })

  const SUB_TABS: { id: SubTab; label: string; icon: typeof ClipboardList }[] = [
    { id: 'aprobaciones', label: 'Aprobaciones', icon: ClipboardList },
    { id: 'reasignar', label: 'Reasignar', icon: UserCog },
    { id: 'trazabilidad', label: 'Trazabilidad', icon: History },
    { id: 'kpis', label: 'KPIs', icon: BarChart3 },
  ]

  // Footer "Mostrando X de Y" (mismo patrón que HistorialPage.tsx) — compartido entre las
  // sub-pestañas Aprobaciones y Reasignar, que muestran la MISMA lista paginada.
  const paginacionFooter = paginado && autorizaciones.length > 0 && (
    <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span>Mostrar</span>
        {editandoCantidad ? (
          <input autoFocus type="number" min="1" max="500" value={cantidadInput}
            onChange={e => setCantidadInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(cantidadInput)
              if (n > 0 && n <= 500) { setPageSize!(n); setPage!(0) }
              setEditandoCantidad(false)
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-16 px-2 py-1 border border-accent-text rounded-lg text-center focus:outline-none" />
        ) : (
          <span
            onDoubleClick={() => { setEditandoCantidad(true); setCantidadInput(String(pageSize)) }}
            className="font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:text-accent-text"
            title="Doble click para ingresar número custom">
            {pageSize}
          </span>
        )}
        <div className="flex gap-0.5">
          {AUT_PAGE_SIZES.map(s => (
            <button key={s} onClick={() => { setPageSize!(s); setPage!(0) }}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${pageSize === s ? 'bg-accent text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setPage!(0)} disabled={page === 0}
          className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">
          «
        </button>
        <button onClick={() => setPage!(p => Math.max(0, p - 1))} disabled={page === 0}
          className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">
          ←
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {page! + 1} / {totalPages}
          <span className="text-xs ml-1">({totalCount} en total)</span>
        </span>
        <button onClick={() => setPage!(p => Math.min(totalPages - 1, p + 1))} disabled={page! >= totalPages - 1}
          className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">
          →
        </button>
        <button onClick={() => setPage!(totalPages - 1)} disabled={page! >= totalPages - 1}
          className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40">
          »
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {SUB_TABS.map(st => (
          <button key={st.id} onClick={() => setSubTab(st.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${subTab === st.id ? 'border-accent text-accent-text' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <st.icon size={14} /> {st.label}
          </button>
        ))}
      </div>

      {subTab === 'aprobaciones' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['pendiente', 'aprobada', 'rechazada'] as const).map(e => (
              <button key={e} onClick={() => onEstadoChange(e)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize
                  ${autEstado === e ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {e === 'pendiente' ? 'Pendientes' : e === 'aprobada' ? 'Aprobadas' : 'Rechazadas'}
              </button>
            ))}
          </div>
          {children}
          {paginacionFooter}
        </div>
      )}

      {subTab === 'reasignar' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : autorizaciones.filter(a => a.estado === 'pendiente' || autEstado === 'pendiente').length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500">
              <UserCog size={32} className="mx-auto mb-3 opacity-30" />
              <p>No hay solicitudes pendientes para reasignar</p>
            </div>
          ) : (
            autorizaciones.map(aut => (
              <div key={aut.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{resumenDe(aut)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {aut.asignado?.nombre_display ? `Asignado a ${aut.asignado.nombre_display}` : 'Sin asignar — disponible para cualquiera'}
                    {aut.asignado_a === user?.id && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent-text text-[10px] font-medium">Asignada a mí</span>}
                  </p>
                </div>
                {reasignando === aut.id ? (
                  <select autoFocus defaultValue={aut.asignado_a ?? ''}
                    onChange={async (e) => {
                      const usuarioId = e.target.value || null
                      const usuarioNombre = usuarioId ? (usuarios.find((u: any) => u.id === usuarioId)?.nombre_display || usuarios.find((u: any) => u.id === usuarioId)?.rol || null) : null
                      await onReasignar(aut.id, usuarioId, usuarioNombre, resumenDe(aut))
                      setReasignando(null)
                    }}
                    onBlur={() => setReasignando(null)}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">Sin asignar</option>
                    {usuarios.map((u: any) => <option key={u.id} value={u.id}>{u.nombre_display || u.rol}</option>)}
                  </select>
                ) : (
                  <button onClick={() => setReasignando(aut.id)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent-text/50">
                    <UserCog size={13} /> Reasignar
                  </button>
                )}
              </div>
            ))
          )}
          {paginacionFooter}
        </div>
      )}

      {subTab === 'trazabilidad' && (
        <div className="space-y-2">
          {trazabilidad.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500">
              <History size={32} className="mx-auto mb-3 opacity-30" />
              <p>Sin actividad registrada todavía</p>
            </div>
          ) : (
            trazabilidad.map((t: any) => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 px-4 py-2.5 text-sm">
                <span className="font-medium text-gray-800 dark:text-gray-100">{t.usuario_nombre ?? 'Sistema'}</span>
                {' '}
                <span className="text-gray-500 dark:text-gray-400">
                  {t.accion === 'aprobar' ? 'aprobó' : t.accion === 'rechazar' ? 'rechazó' : t.accion === 'reasignar' ? 'reasignó' : t.accion}
                </span>
                {' '}<span className="text-gray-700 dark:text-gray-300">{t.entidad_nombre}</span>
                {t.accion === 'reasignar' && <span className="text-gray-400"> → {t.valor_nuevo}</span>}
                <span className="text-xs text-gray-400 ml-2">{new Date(t.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'kpis' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Pendientes ahora</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{kpis?.pendientesTotal ?? 0}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <p className="text-xs text-gray-400 uppercase tracking-wide px-4 pt-3">Últimos 30 días, por persona</p>
            {(kpis?.porPersona ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 p-4">Sin resoluciones en este período</p>
            ) : (
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-4 py-2 font-medium">Persona</th>
                    <th className="text-right px-4 py-2 font-medium">Aprobadas</th>
                    <th className="text-right px-4 py-2 font-medium">Rechazadas</th>
                  </tr>
                </thead>
                <tbody>
                  {(kpis?.porPersona ?? []).map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{p.nombre}</td>
                      <td className="px-4 py-2 text-right text-green-600 dark:text-green-400 font-medium">{p.aprobadas}</td>
                      <td className="px-4 py-2 text-right text-red-500 dark:text-red-400 font-medium">{p.rechazadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
