import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, startOfDay, endOfDay, subDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { ClipboardList, Filter, X, Download, ChevronRight, User, Package, ShoppingCart, Tag, Truck, MapPin, CircleDot, MessageSquare, TrendingDown, Gift } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'

type Filtros = {
  entidad: string
  accion: string
  usuario_id: string
  desde: string
  hasta: string
  buscar: string
}

const ENTIDAD_ICONS: Record<string, any> = {
  producto: Package,
  inventario_linea: Package,
  venta: ShoppingCart,
  categoria: Tag,
  proveedor: Truck,
  ubicacion: MapPin,
  estado: CircleDot,
  motivo: MessageSquare,
  usuario: User,
  gasto: TrendingDown,
  combo: Gift,
}

const ENTIDAD_LABELS: Record<string, string> = {
  producto: 'Producto',
  inventario_linea: 'LPN',
  venta: 'Venta',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  ubicacion: 'Ubicación',
  estado: 'Estado',
  motivo: 'Motivo',
  usuario: 'Usuario',
  gasto: 'Gasto',
  combo: 'Combo',
}

const ACCION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  crear:         { label: 'Creó',         color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/30' },
  editar:        { label: 'Editó',         color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30'  },
  eliminar:      { label: 'Eliminó',       color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/30'   },
  cambio_estado: { label: 'Cambió estado', color: 'text-purple-700', bg: 'bg-purple-100'},
}

function describir(log: any): string {
  const entidad = ENTIDAD_LABELS[log.entidad] ?? log.entidad
  const nombre = log.entidad_nombre ? `"${log.entidad_nombre}"` : ''

  switch (log.accion) {
    case 'crear':
      if (log.entidad === 'venta') return `Creó ${entidad} ${nombre} con estado ${log.valor_nuevo ?? ''}`
      return `Creó ${entidad} ${nombre}`
    case 'eliminar':
      return `Eliminó ${entidad} ${nombre}`
    case 'cambio_estado':
      return `Cambió estado de ${entidad} ${nombre}: ${log.valor_anterior ?? '—'} → ${log.valor_nuevo ?? '—'}`
    case 'editar': {
      const campo = log.campo
      if (!campo) return `Editó ${entidad} ${nombre}`
      if (log.valor_anterior && log.valor_nuevo)
        return `Editó ${campo} de ${entidad} ${nombre}: "${log.valor_anterior}" → "${log.valor_nuevo}"`
      if (log.valor_nuevo)
        return `Editó ${campo} de ${entidad} ${nombre}: → "${log.valor_nuevo}"`
      if (log.valor_anterior)
        return `Editó ${campo} de ${entidad} ${nombre}: "${log.valor_anterior}" → eliminado`
      return `Editó ${campo} de ${entidad} ${nombre}`
    }
    default:
      return `${log.accion} en ${entidad} ${nombre}`
  }
}

const FILTROS_VACIOS: Filtros = { entidad: '', accion: '', usuario_id: '', desde: '', hasta: '', buscar: '' }
const PAGE_SIZE = 50

export default function HistorialPage() {
  const { limits } = usePlanLimits()
  const { tenant, user } = useAuthStore()

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [page, setPage] = useState(0)
  const [showFiltros, setShowFiltros] = useState(false)
  const [selectedLog, setSelectedLog] = useState<any>(null)

  // Rol check
  const puedeVer = user?.rol === 'OWNER' || user?.rol === 'SUPERVISOR' || user?.rol === 'ADMIN'

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['actividad_log', tenant?.id, filtros, page],
    queryFn: async () => {
      let q = supabase.from('actividad_log')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (filtros.entidad)    q = q.eq('entidad', filtros.entidad)
      if (filtros.accion)     q = q.eq('accion', filtros.accion)
      if (filtros.usuario_id) q = q.eq('usuario_id', filtros.usuario_id)
      if (filtros.desde)      q = q.gte('created_at', startOfDay(parseISO(filtros.desde)).toISOString())
      if (filtros.hasta)      q = q.lte('created_at', endOfDay(parseISO(filtros.hasta)).toISOString())
      if (filtros.buscar)     q = q.ilike('entidad_nombre', `%${filtros.buscar}%`)

      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && puedeVer,
  })

  const { data: usuarios = [] } = useQuery({
    queryKey: ['actividad_log_usuarios', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('actividad_log')
        .select('usuario_id, usuario_nombre')
        .eq('tenant_id', tenant!.id)
        .not('usuario_id', 'is', null)
      // Deduplicate
      const seen = new Set()
      return (data ?? []).filter((x: any) => {
        if (seen.has(x.usuario_id)) return false
        seen.add(x.usuario_id); return true
      })
    },
    enabled: !!tenant && puedeVer,
  })

  const hayFiltros = Object.values(filtros).some(Boolean)

  const limpiar = () => { setFiltros(FILTROS_VACIOS); setPage(0) }

  const exportarExcel = () => {
    const rows = (logs as any[]).map(l => ({
      Fecha: format(parseISO(l.created_at), 'dd/MM/yyyy HH:mm', { locale: es }),
      Usuario: l.usuario_nombre ?? '',
      Entidad: ENTIDAD_LABELS[l.entidad] ?? l.entidad,
      Nombre: l.entidad_nombre ?? '',
      Acción: ACCION_LABELS[l.accion]?.label ?? l.accion,
      Campo: l.campo ?? '',
      Antes: l.valor_anterior ?? '',
      Después: l.valor_nuevo ?? '',
      Página: l.pagina ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Historial')
    XLSX.writeFile(wb, `historial_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }

  // Agrupar logs por día
  const grouped: Record<string, any[]> = {}
  for (const log of logs as any[]) {
    const dia = format(parseISO(log.created_at), 'yyyy-MM-dd')
    if (!grouped[dia]) grouped[dia] = []
    grouped[dia].push(log)
  }

  if (limits && !limits.puede_historial) return <UpgradePrompt feature="historial" />

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <ClipboardList size={48} className="mb-4 text-gray-300 dark:text-gray-600 dark:text-gray-400" />
        <p className="text-lg font-medium">Sin acceso</p>
        <p className="text-sm mt-1">Esta sección es solo para supervisores y dueños.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <ClipboardList size={22} /> Historial de actividad
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Todo lo que pasó en tu negocio — quién, qué, cuándo</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFiltros(!showFiltros)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border-2 transition-all
              ${showFiltros || hayFiltros ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            <Filter size={15} /> Filtros {hayFiltros && '●'}
          </button>
          <button onClick={exportarExcel}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-accent hover:bg-accent/90 text-white rounded-xl transition-all">
            <Download size={15} /> Excel
          </button>
        </div>
      </div>

      {/* Panel de filtros */}
      {showFiltros && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Buscar nombre</label>
              <input type="text" placeholder="Nombre de la entidad..." value={filtros.buscar}
                onChange={e => { setFiltros(f => ({ ...f, buscar: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tipo</label>
              <select value={filtros.entidad} onChange={e => { setFiltros(f => ({ ...f, entidad: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="">Todos</option>
                {Object.entries(ENTIDAD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Acción</label>
              <select value={filtros.accion} onChange={e => { setFiltros(f => ({ ...f, accion: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="">Todas</option>
                {Object.entries(ACCION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Usuario</label>
              <select value={filtros.usuario_id} onChange={e => { setFiltros(f => ({ ...f, usuario_id: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                <option value="">Todos</option>
                {(usuarios as any[]).map(u => <option key={u.usuario_id} value={u.usuario_id}>{u.usuario_nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Desde</label>
              <input type="date" value={filtros.desde} onChange={e => { setFiltros(f => ({ ...f, desde: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hasta</label>
              <input type="date" value={filtros.hasta} onChange={e => { setFiltros(f => ({ ...f, hasta: e.target.value })); setPage(0) }}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
          {hayFiltros && (
            <button onClick={limpiar} className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      {isLoading ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Cargando historial...</div>
      ) : (logs as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <ClipboardList size={44} className="mb-3 text-gray-200" />
          <p className="font-medium">Sin actividad registrada</p>
          <p className="text-sm mt-1">Las acciones aparecerán aquí a medida que se realicen.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([dia, items]) => (
            <div key={dia}>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">
                {format(parseISO(dia), "EEEE d 'de' MMMM", { locale: es })}
              </p>
              <div className="space-y-2">
                {items.map((log: any) => {
                  const accionInfo = ACCION_LABELS[log.accion] ?? { label: log.accion, color: 'text-gray-700 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700' }
                  const EntidadIcon = ENTIDAD_ICONS[log.entidad] ?? ClipboardList
                  return (
                    <div key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3.5 hover:shadow-sm hover:border-accent/30 transition-all cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <EntidadIcon size={15} className="text-gray-500 dark:text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-100">{describir(log)}</p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${accionInfo.bg} ${accionInfo.color}`}>
                              {accionInfo.label}
                            </span>
                            {log.usuario_nombre && (
                              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                <User size={10} /> {log.usuario_nombre}
                              </span>
                            )}
                            {log.pagina && (
                              <span className="text-xs text-gray-300">{log.pagina}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {format(parseISO(log.created_at), 'HH:mm')}
                          </span>
                          <ChevronRight size={14} className="text-gray-300 dark:text-gray-600" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {(logs as any[]).length > 0 && (
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40 transition-all">
            ← Anterior
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">Página {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={(logs as any[]).length < PAGE_SIZE}
            className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-40 transition-all">
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal detalle */}
      {selectedLog && (() => {
        const log = selectedLog
        const accionInfo = ACCION_LABELS[log.accion] ?? { label: log.accion, color: 'text-gray-700 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700' }
        const EntidadIcon = ENTIDAD_ICONS[log.entidad] ?? ClipboardList
        const rows: { label: string; value: string }[] = [
          { label: 'Entidad', value: ENTIDAD_LABELS[log.entidad] ?? log.entidad },
          ...(log.entidad_nombre ? [{ label: 'Nombre', value: log.entidad_nombre }] : []),
          ...(log.entidad_id ? [{ label: 'ID', value: log.entidad_id }] : []),
          { label: 'Acción', value: accionInfo.label },
          ...(log.campo ? [{ label: 'Campo', value: log.campo }] : []),
          ...(log.valor_anterior ? [{ label: 'Valor anterior', value: log.valor_anterior }] : []),
          ...(log.valor_nuevo ? [{ label: 'Valor nuevo', value: log.valor_nuevo }] : []),
          { label: 'Fecha', value: format(parseISO(log.created_at), "dd/MM/yyyy 'a las' HH:mm:ss", { locale: es }) },
          ...(log.usuario_nombre ? [{ label: 'Usuario', value: log.usuario_nombre }] : []),
          ...(log.pagina ? [{ label: 'Módulo', value: log.pagina }] : []),
        ]
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedLog(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <EntidadIcon size={16} className="text-gray-500 dark:text-gray-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">Detalle del registro</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{log.id?.slice(0, 8)}…</p>
                  </div>
                </div>
                <button onClick={() => setSelectedLog(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5">
                <p className="text-sm text-gray-700 dark:text-gray-200 mb-4 leading-relaxed">{describir(log)}</p>
                <div className="space-y-2">
                  {rows.map(r => (
                    <div key={r.label} className="flex items-start gap-2">
                      <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-28 flex-shrink-0 pt-0.5">{r.label}</span>
                      <span className="text-xs text-gray-700 dark:text-gray-200 font-mono break-all">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-5 pb-5">
                <span className={`text-xs font-medium px-3 py-1 rounded-full ${accionInfo.bg} ${accionInfo.color}`}>
                  {accionInfo.label}
                </span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
