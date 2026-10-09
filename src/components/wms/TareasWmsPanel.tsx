/**
 * Picking → pestaña "Tareas": la cola de tareas de Depósito (picking, reabastecimiento, armado) para
 * gestionarla desde el escritorio — por pedido o tarea por tarea, con selección múltiple para asignar,
 * completar o cancelar en masa. Antes vivía en Pedidos → "Tareas WMS" (pedido de GO 2026-10-08:
 * unificar con Picking). Misma fuente y mismas RPCs que la pestaña Picking (la del escáner).
 */
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ChevronDown, CalendarClock, ScanBarcode, CheckCircle2, XCircle, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useConfirm } from '@/hooks/useConfirm'
import { logActividad } from '@/lib/actividadLog'
import { ActionMenu } from '@/components/ActionMenu'
import { BuscadorPildoras, pildoraConCampoNuevo } from '@/components/BuscadorPildoras'
import { fechaEntregaLegible } from '@/lib/pedidoPrioridad'
import { ESTADO_BADGE } from '@/lib/pedidoEstados'
import { cantidadConUnidad } from '@/lib/cantidadUnidad'
import {
  CAMPOS_FILTRO_TAREAS_WMS, parsearPildoraTareaWms, evaluarPildorasTareaWms, tareaWmsFiltrable,
  type PildoraTareaWms, type CampoTareaWms,
} from '@/lib/wmsTareasFiltro'

// Tareas WMS en pantallas anchas: casilla · tipo · producto · cantidad · ubicación · asignada · acciones
// (la vista "Por tarea" suma la columna Pedido después del tipo).
const GRILLA_TAREA = 'lg:grid-cols-[1.75rem_8.5rem_minmax(12rem,1.6fr)_6rem_minmax(10rem,1.2fr)_13rem_10.5rem] lg:gap-x-4'
const GRILLA_TAREA_CON_PEDIDO = 'lg:grid-cols-[1.75rem_8.5rem_5.5rem_minmax(12rem,1.6fr)_6rem_minmax(10rem,1.2fr)_13rem_10.5rem] lg:gap-x-4'

/** Casilla con estado "algunas" (indeterminate), que en HTML solo se puede poner por JS. */
function Casilla({ checked, indeterminate = false, onChange, label }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string
}) {
  return (
    <input type="checkbox" checked={checked} aria-label={label} title={label}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={e => onChange(e.target.checked)}
      className="rounded w-4 h-4 cursor-pointer accent-[rgb(var(--color-accent))]" />
  )
}

export function TareasWmsPanel({ onIrAPicking, busquedaInicial }: {
  /** Pasa a la pestaña Picking (escáner), opcionalmente con una búsqueda ya cargada ("Pedido:20"). */
  onIrAPicking: (busqueda?: string) => void
  /** Filtro con el que arranca (ej. "Pedido:20" al venir de "Ver en Picking" de un pedido). */
  busquedaInicial?: string
}) {
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()
  const confirmar = useConfirm()
  const puedeAsignarTareas = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO'].includes(user?.rol ?? '')

  // ── Tab WMS: cola de tareas de picking/reabastecimiento (mig 289), mudada desde Inventario.
  // Misma fuente y RPCs que /picking (mobile); acá es una lista de escritorio sin escaneo, con
  // asignación manual a un operario (usuario_asignado_id, columna que ya existía sin uso).
  const { data: wmsTareas = [], isLoading: loadingWms } = useQuery({
    queryKey: ['wms_tareas', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('wms_tareas')
        .select('*, productos(nombre, sku, unidad_medida), ubicacion_origen:ubicaciones!wms_tareas_ubicacion_origen_id_fkey(nombre), ubicacion_destino:ubicaciones!wms_tareas_ubicacion_destino_id_fkey(nombre), envios(numero, venta:venta_id(numero)), usuario_asignado:users!wms_tareas_usuario_asignado_id_fkey(nombre_display), pedidos!wms_tareas_pedido_id_fkey(numero, estado, cliente_nombre, fecha_entrega_solicitada, clientes(nombre), venta:venta_origen_id(numero))')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['pendiente', 'en_curso'])
        // reposicion_gondola (mig 355) es trabajo del Repositor, vive en /repositores — nunca se mezcla
        // con la tab WMS de Pedidos.
        .neq('tipo', 'reposicion_gondola')
        .order('prioridad', { ascending: false })
        .order('created_at')
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Operarios asignables — cualquier usuario activo del tenant (no se restringe por rol: en
  // equipos chicos el mismo DUEÑO/SUPERVISOR también hace picking/armado).
  const { data: usuariosAsignables = [] } = useQuery({
    queryKey: ['usuarios-asignables-wms', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('users')
        .select('id, nombre_display, rol').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre_display')
      return data ?? []
    },
    enabled: !!tenant && puedeAsignarTareas,
  })

  // Todas las tareas (también las ya hechas) de los pedidos que tienen algo pendiente: para la vista
  // "Por pedido" (progreso del pedido y qué falta). Solo lectura.
  const pedidoIdsWms = useMemo(
    () => [...new Set((wmsTareas as any[]).map(t => t.pedido_id).filter(Boolean))].sort() as string[],
    [wmsTareas])
  const { data: tareasDePedidosWms = [] } = useQuery({
    queryKey: ['wms_tareas_pedidos', pedidoIdsWms.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_tareas')
        .select('id, pedido_id, estado, tipo, cantidad, completed_at, productos(nombre, sku, unidad_medida)')
        .in('pedido_id', pedidoIdsWms)
        .neq('tipo', 'reposicion_gondola')
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && pedidoIdsWms.length > 0,
  })

  const [completandoWms, setCompletandoWms] = useState<string | null>(null)
  // Completa UNA tarea con la misma RPC que /picking (cada una es atómica en la base y la base
  // exige que el reabastecimiento previo esté hecho). Devuelve el error o null; no avisa.
  const completarTareaCore = async (t: any): Promise<string | null> => {
    const esReab = t.tipo === 'replenishment'
    const esArmado = t.tipo === 'armado'
    const rpc = esArmado ? 'fn_completar_tarea_armado' : esReab ? 'fn_completar_tarea_reabastecimiento' : 'fn_completar_tarea_picking'
    const { error } = await supabase.rpc(rpc, { p_tarea_id: t.id })
    if (error) return error.message
    logActividad({
      entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? t.lpn_origen ?? undefined,
      accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'completada',
      pagina: '/picking', tipo_transaccion: esReab ? 'traslado' : undefined,
      producto_id: t.producto_id, lpn: t.lpn_origen, sucursal_id: t.sucursal_id,
    })
    return null
  }
  const invalidarWms = () => {
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    qc.invalidateQueries({ queryKey: ['wms_tareas_pedidos'] })
    qc.invalidateQueries({ queryKey: ['pedidos'] })
  }
  const completarTareaWms = async (t: any) => {
    if (t.tarea_precedente_id) {
      const prec = (wmsTareas as any[]).find(x => x.id === t.tarea_precedente_id)
      if (prec && prec.estado !== 'completada') { toast.error('Primero hay que completar el reabastecimiento de esta tarea'); return }
    }
    setCompletandoWms(t.id)
    const error = await completarTareaCore(t)
    setCompletandoWms(null)
    if (error) { toast.error(error); return }
    invalidarWms()
    setSelWms(s => { const n = new Set(s); n.delete(t.id); return n })
    toast.success('Tarea completada')
  }

  // ── Selección múltiple de tareas (vista por pedido y por tarea) ──
  const [selWms, setSelWms] = useState<Set<string>>(new Set())
  const [completandoLote, setCompletandoLote] = useState(false)
  const alternarSelWms = (ids: string[], marcar: boolean) => setSelWms(s => {
    const n = new Set(s)
    ids.forEach(id => marcar ? n.add(id) : n.delete(id))
    return n
  })
  // Completa las tildadas DE A UNA, en orden: reabastecimientos → armados → pickings (un picking puede
  // depender del reabastecimiento de la misma tanda). Si una falla se frena: lo hecho queda hecho
  // (cada RPC es atómica) y se avisa cuál falló. Un picking cuyo reabastecimiento no está hecho ni
  // tildado se saltea con aviso, igual que el botón individual.
  const completarSeleccionWms = async () => {
    const orden: Record<string, number> = { replenishment: 0, armado: 1, picking: 2 }
    const tareas = (wmsTareas as any[]).filter(t => selWms.has(t.id))
      .sort((a, b) => (orden[a.tipo] ?? 3) - (orden[b.tipo] ?? 3))
    if (tareas.length === 0) return
    if (!(await confirmar(
      `¿Completar ${tareas.length} tarea${tareas.length !== 1 ? 's' : ''}? Cada una mueve el stock igual que si se confirmara en Picking.`,
    ))) return
    setCompletandoLote(true)
    const hechas = new Set<string>()
    const salteadas: any[] = []
    let fallo: { t: any; error: string } | null = null
    for (const t of tareas) {
      if (t.tarea_precedente_id) {
        const prec = (wmsTareas as any[]).find(x => x.id === t.tarea_precedente_id)
        if (prec && prec.estado !== 'completada' && !hechas.has(prec.id)) { salteadas.push(t); continue }
      }
      const error = await completarTareaCore(t)
      if (error) { fallo = { t, error }; break }
      hechas.add(t.id)
    }
    setCompletandoLote(false)
    invalidarWms()
    setSelWms(s => { const n = new Set(s); hechas.forEach(id => n.delete(id)); return n })
    if (hechas.size > 0) toast.success(`${hechas.size} tarea${hechas.size !== 1 ? 's' : ''} completada${hechas.size !== 1 ? 's' : ''}`)
    if (salteadas.length > 0) toast.error(`${salteadas.length} quedaron sin completar: esperan su reabastecimiento`)
    if (fallo) toast.error(`Se frenó en ${fallo.t.productos?.nombre ?? 'una tarea'}: ${fallo.error}`, { duration: 7000 })
  }
  const asignarSeleccionWms = async (usuarioId: string | null) => {
    const tareas = (wmsTareas as any[]).filter(t => selWms.has(t.id))
    if (tareas.length === 0) return
    const { error } = await supabase.from('wms_tareas').update({ usuario_asignado_id: usuarioId }).in('id', tareas.map(t => t.id))
    if (error) { toast.error(error.message); return }
    invalidarWms()
    tareas.forEach(t => logActividad({
      entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? t.lpn_origen ?? undefined,
      accion: 'editar', campo: 'usuario_asignado_id', valor_anterior: t.usuario_asignado_id, valor_nuevo: usuarioId,
      pagina: '/picking', producto_id: t.producto_id, lpn: t.lpn_origen, sucursal_id: t.sucursal_id,
    }))
    toast.success(usuarioId ? `${tareas.length} tarea${tareas.length !== 1 ? 's' : ''} asignada${tareas.length !== 1 ? 's' : ''}` : 'Asignación quitada')
  }

  const [vistaWms, setVistaWms] = useState<'pedido' | 'tarea'>(() => {
    try { return localStorage.getItem('wms-vista') === 'tarea' ? 'tarea' : 'pedido' } catch { return 'pedido' }
  })
  const [filtroTipoWms, setFiltroTipoWms] = useState<'' | 'picking' | 'replenishment' | 'armado'>('')
  const [pildorasWms, setPildorasWms] = useState<PildoraTareaWms[]>(() => {
    const p = busquedaInicial ? parsearPildoraTareaWms(busquedaInicial) : null
    return p ? [p] : []
  })
  const [entradaWms, setEntradaWms] = useState(() =>
    busquedaInicial && !parsearPildoraTareaWms(busquedaInicial) ? busquedaInicial : '')
  const [combinadorWms, setCombinadorWms] = useState<'Y' | 'O'>('Y')

  // Cancela las tildadas DE A UNA con la misma RPC que el botón individual. Primero pickings y armados,
  // después reabastecimientos (cancelar un reabastecimiento ya cancela el picking que depende de él: si
  // fuera primero, el picking tildado daría "ya está cancelada"). Si una falla se frena y avisa.
  const cancelarSeleccionWms = async () => {
    const orden: Record<string, number> = { picking: 0, armado: 1, replenishment: 2 }
    const tareas = (wmsTareas as any[]).filter(t => selWms.has(t.id))
      .sort((a, b) => (orden[a.tipo] ?? 3) - (orden[b.tipo] ?? 3))
    if (tareas.length === 0) return
    const nArmado = tareas.filter(t => t.tipo === 'armado').length
    const dependientes = (wmsTareas as any[]).filter(x =>
      x.tarea_precedente_id && !selWms.has(x.id) && tareas.some(t => t.id === x.tarea_precedente_id)).length
    // fn_cancelar_tarea_wms NO libera la reserva del pedido (se tomó al lanzar): avisarlo si el pedido
    // sigue activo, para que no se crea que cancelar la tarea devuelve la mercadería al disponible.
    const pedidosActivos = new Set(tareas
      .filter(t => t.pedido_id && ['en_preparacion', 'listo_para_entrega', 'entregado_parcial'].includes(t.pedidos?.estado))
      .map(t => t.pedidos?.numero))
    if (!(await confirmar(
      `¿Cancelar ${tareas.length} tarea${tareas.length !== 1 ? 's' : ''}? No mueve stock.` +
      (nArmado ? ' Se libera la reserva de los componentes de los armados.' : '') +
      (dependientes ? ` También se cancelan ${dependientes} picking${dependientes !== 1 ? 's' : ''} que dependen de esos reabastecimientos.` : '') +
      (pedidosActivos.size
        ? ` Ojo: ${pedidosActivos.size === 1 ? 'el pedido' : 'los pedidos'} ${[...pedidosActivos].map(n => `#${n}`).join(', ')} ${pedidosActivos.size === 1 ? 'sigue activo' : 'siguen activos'}: la mercadería queda reservada para el pedido. Para liberarla, usá "Deshacer lanzamiento" en la tab Pedidos.`
        : ''),
      { danger: true },
    ))) return
    setCompletandoLote(true)
    const hechas = new Set<string>()
    let fallo: { t: any; error: string } | null = null
    for (const t of tareas) {
      const { error } = await supabase.rpc('fn_cancelar_tarea_wms', { p_tarea_id: t.id })
      if (error) { fallo = { t, error: error.message }; break }
      hechas.add(t.id)
      logActividad({
        entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? t.lpn_origen ?? undefined,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'cancelada',
        pagina: '/picking', producto_id: t.producto_id, lpn: t.lpn_origen, sucursal_id: t.sucursal_id,
      })
    }
    setCompletandoLote(false)
    invalidarWms()
    setSelWms(s => { const n = new Set(s); hechas.forEach(id => n.delete(id)); return n })
    if (hechas.size > 0) toast.success(`${hechas.size} tarea${hechas.size !== 1 ? 's' : ''} cancelada${hechas.size !== 1 ? 's' : ''}`)
    if (fallo) toast.error(`Se frenó en ${fallo.t.productos?.nombre ?? 'una tarea'}: ${fallo.error}`, { duration: 7000 })
  }
  // Sin filtro, los pedidos arrancan COLAPSADOS (se abre el que se quiere ver); llegando desde "Ver en
  // Picking" de un pedido (búsqueda inicial) arrancan abiertos. El set guarda los que el usuario cambió.
  const abiertosPorDefault = !!busquedaInicial
  const [gruposCambiadosWms, setGruposCambiadosWms] = useState<Set<string>>(new Set())
  const cancelarTareaWms = async (t: any) => {
    const esReab = t.tipo === 'replenishment'
    const esArmado = t.tipo === 'armado'
    const tieneDependiente = esReab && (wmsTareas as any[]).some(x => x.tarea_precedente_id === t.id)
    const msg = `¿Cancelar esta tarea de ${esArmado ? 'armado' : esReab ? 'reabastecimiento' : 'picking'}?` +
      (esArmado ? ' Se libera la reserva de los componentes.' : '') +
      (tieneDependiente ? ' La tarea de picking que depende de este reabastecimiento también se va a cancelar.' : '')
    if (!(await confirmar(msg, { danger: true }))) return
    setCompletandoWms(t.id)
    const { error } = await supabase.rpc('fn_cancelar_tarea_wms', { p_tarea_id: t.id })
    setCompletandoWms(null)
    if (error) { toast.error(error.message); return }
    invalidarWms()
    logActividad({
      entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? t.lpn_origen ?? undefined,
      accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'cancelada',
      pagina: '/picking', producto_id: t.producto_id, lpn: t.lpn_origen, sucursal_id: t.sucursal_id,
    })
    toast.success('Tarea cancelada')
  }
  const asignarTareaWms = async (t: any, usuarioId: string | null) => {
    const { error } = await supabase.from('wms_tareas').update({ usuario_asignado_id: usuarioId }).eq('id', t.id)
    if (error) { toast.error(error.message); return }
    invalidarWms()
    logActividad({
      entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? t.lpn_origen ?? undefined,
      accion: 'editar', campo: 'usuario_asignado_id', valor_anterior: t.usuario_asignado_id, valor_nuevo: usuarioId,
      pagina: '/picking', producto_id: t.producto_id, lpn: t.lpn_origen, sucursal_id: t.sucursal_id,
    })
  }

        const entradaWmsTrim = entradaWms.trim()
        const pildorasWmsEfectivas = entradaWmsTrim
          ? [...pildorasWms, parsearPildoraTareaWms(entradaWmsTrim) ?? { id: '__entrada__', campo: 'libre' as const, operador: 'contiene' as const, valor: entradaWmsTrim }]
          : pildorasWms
        const tareasBuscadas = (wmsTareas as any[]).filter(t => evaluarPildorasTareaWms(tareaWmsFiltrable(t), pildorasWmsEfectivas, combinadorWms))
        const tareasVisibles = tareasBuscadas.filter(t => !filtroTipoWms || t.tipo === filtroTipoWms)
        const conteoTipo = tareasBuscadas.reduce<Record<string, number>>((acc, t) => { acc[t.tipo] = (acc[t.tipo] ?? 0) + 1; return acc }, {})
        const idsVisibles = tareasVisibles.map(t => t.id)
        const nSelVisibles = idsVisibles.filter(id => selWms.has(id)).length
        // Solo cuentan las tildadas que siguen pendientes (otra persona pudo completarlas en Picking).
        const nSelTotal = (wmsTareas as any[]).filter(t => selWms.has(t.id)).length

        // Grupos de la vista "Por pedido": pedido → envío → tareas sueltas. Conservan el orden de
        // prioridad de la consulta (el grupo aparece donde aparece su tarea más prioritaria).
        const grupos: { key: string; titulo: string; tareas: any[]; pedido: any | null; pedidoId: string | null; envioNumero: number | null }[] = []
        const porClave = new Map<string, (typeof grupos)[number]>()
        for (const t of tareasVisibles) {
          const key = t.pedido_id ? `p:${t.pedido_id}` : t.envio_id ? `e:${t.envio_id}` : 'otras'
          let g = porClave.get(key)
          if (!g) {
            g = {
              key, tareas: [], pedido: t.pedidos ?? null, pedidoId: t.pedido_id ?? null, envioNumero: t.envios?.numero ?? null,
              titulo: t.pedido_id ? `Pedido #${t.pedidos?.numero ?? '…'}` : t.envio_id ? `Envío #${t.envios?.numero ?? '…'}` : 'Tareas sin pedido',
            }
            porClave.set(key, g)
            grupos.push(g)
          }
          g.tareas.push(t)
        }
        const tipoInfo = (tipo: string) => tipo === 'armado'
          ? { label: 'Armado', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' }
          : tipo === 'replenishment'
            ? { label: 'Reabastecimiento', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
            : { label: 'Picking', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }

        // Una fila de tarea pendiente. `conPedido` agrega la columna Pedido (vista "Por tarea").
        const filaTarea = (t: any, conPedido: boolean) => {
          const esReab = t.tipo === 'replenishment'
          const esArmado = t.tipo === 'armado'
          const precedente = t.tarea_precedente_id ? (wmsTareas as any[]).find(x => x.id === t.tarea_precedente_id) : null
          const bloqueada = !!precedente && precedente.estado !== 'completada'
          const tipo = tipoInfo(t.tipo)
          const ubic = esArmado
            ? (t.ubicacion_destino?.nombre ? `Destino: ${t.ubicacion_destino.nombre}` : 'Sin ubicación de destino')
            : (t.ubicacion_origen?.nombre ?? 'Sin ubicación') + (esReab && t.ubicacion_destino ? ` → ${t.ubicacion_destino.nombre}` : '')
          const marcada = selWms.has(t.id)
          return (
            <div key={t.id}
              className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 items-center px-4 py-2.5 transition-colors ${conPedido ? GRILLA_TAREA_CON_PEDIDO : GRILLA_TAREA} ${marcada ? 'bg-accent/5' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
              <div className="row-start-1 col-start-1 lg:row-auto lg:col-auto flex items-center">
                <Casilla checked={marcada} onChange={v => alternarSelWms([t.id], v)}
                  label={`Seleccionar la tarea de ${tipo.label.toLowerCase()} de ${t.productos?.nombre ?? 'producto'}`} />
              </div>
              <div className="row-start-1 col-start-2 col-end-4 lg:row-auto lg:col-auto lg:col-end-auto min-w-0 flex items-center gap-2 lg:block">
                <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${tipo.cls}`}>{tipo.label}</span>
                <p className="lg:hidden text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.productos?.nombre ?? '—'}</p>
              </div>
              {conPedido && (
                <div className="hidden lg:block min-w-0 text-sm">
                  {t.pedido_id
                    ? <span className="font-medium text-primary dark:text-white tabular-nums">#{t.pedidos?.numero ?? '…'}</span>
                    : t.envios?.numero ? <span className="text-gray-600 dark:text-gray-300">Envío #{t.envios.numero}</span>
                    : <span className="text-gray-400 dark:text-gray-500">—</span>}
                </div>
              )}
              <div className="hidden lg:block min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.productos?.nombre ?? '—'}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{t.productos?.sku}{t.lpn_origen ? ` · LPN ${t.lpn_origen}` : ''}</p>
              </div>
              <div className="row-start-2 col-start-2 col-end-4 lg:row-auto lg:col-auto lg:col-end-auto min-w-0 flex items-baseline gap-2 lg:block">
                <span className="text-sm tabular-nums text-gray-800 dark:text-gray-100 whitespace-nowrap">{cantidadConUnidad(Number(t.cantidad), t.productos?.unidad_medida)}</span>
                <span className="lg:hidden text-xs text-gray-500 dark:text-gray-400 truncate">{ubic}</span>
              </div>
              <div className="hidden lg:block min-w-0">
                <p className="text-sm text-gray-600 dark:text-gray-300 truncate" title={ubic}>{ubic}</p>
                {bloqueada && <p className="text-[11px] text-amber-600 dark:text-amber-400">Espera su reabastecimiento</p>}
              </div>
              <div className="row-start-3 col-start-2 lg:row-auto lg:col-auto min-w-0">
                {puedeAsignarTareas ? (
                  <select value={t.usuario_asignado_id ?? ''} onChange={e => asignarTareaWms(t, e.target.value || null)}
                    aria-label="Asignar la tarea a un operario"
                    className="w-full max-w-[13rem] text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-200">
                    <option value="">Sin asignar</option>
                    {(usuariosAsignables as any[]).map(u => (
                      <option key={u.id} value={u.id}>{u.nombre_display ?? u.rol}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t.usuario_asignado?.nombre_display ?? 'Sin asignar'}
                  </span>
                )}
              </div>
              <div className="row-start-3 col-start-3 lg:row-auto lg:col-auto flex items-center justify-end gap-2">
                <button onClick={() => completarTareaWms(t)} disabled={bloqueada || completandoWms === t.id || completandoLote}
                  title={bloqueada ? 'Esperando que se complete el reabastecimiento' : 'Completar esta tarea'}
                  className="text-sm font-medium text-accent-text border border-accent-text/30 px-3 py-1.5 rounded-lg hover:bg-accent/10 transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed">
                  {completandoWms === t.id ? 'Completando…' : 'Completar'}
                </button>
                <ActionMenu compact label={`Más acciones de la tarea de ${t.productos?.nombre ?? 'producto'}`} items={[
                  { label: 'Ver en Picking', icon: ScanBarcode, onClick: () => onIrAPicking(t.pedidos?.numero ? `Pedido:${t.pedidos.numero}` : undefined) },
                  { label: 'Cancelar tarea', icon: XCircle, danger: true, disabled: completandoWms === t.id, onClick: () => cancelarTareaWms(t) },
                ]} />
              </div>
            </div>
          )
        }

        return (
        <div className="space-y-4">
          <div className="max-w-2xl">
            <BuscadorPildoras
              camposFiltro={CAMPOS_FILTRO_TAREAS_WMS}
              pildoras={pildorasWms}
              entrada={entradaWms}
              combinador={combinadorWms}
              placeholder="Buscar producto, SKU, LPN... o Pedido:20, Envío:52, Venta:1536"
              onEntradaChange={setEntradaWms}
              onCommitEntrada={() => {
                if (!entradaWmsTrim) return
                const nueva = parsearPildoraTareaWms(entradaWmsTrim) ?? { id: crypto.randomUUID(), campo: 'libre' as const, operador: 'contiene' as const, valor: entradaWmsTrim }
                setPildorasWms(ps => [...ps, nueva])
                setEntradaWms('')
              }}
              onCampoChange={(id, campo) => setPildorasWms(ps => ps.map(p => p.id === id ? pildoraConCampoNuevo(p, campo as CampoTareaWms, CAMPOS_FILTRO_TAREAS_WMS) as PildoraTareaWms : p))}
              onOperadorChange={(id, operador) => setPildorasWms(ps => ps.map(p => p.id === id ? { ...p, operador } : p))}
              onValorChange={(id, valor) => setPildorasWms(ps => ps.map(p => p.id === id ? { ...p, valor } : p))}
              onRemove={id => setPildorasWms(ps => ps.filter(p => p.id !== id))}
              onRemoveLast={() => setPildorasWms(ps => ps.slice(0, -1))}
              onCombinadorChange={setCombinadorWms}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Vista: agrupada por pedido o lista de tareas sueltas. Se recuerda en el navegador. */}
            <div role="radiogroup" aria-label="Cómo ver las tareas" className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-700/60 p-1">
              {([['pedido', 'Por pedido'], ['tarea', 'Por tarea']] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={vistaWms === id}
                  onClick={() => { setVistaWms(id); try { localStorage.setItem('wms-vista', id) } catch { /* sin storage */ } }}
                  className={`px-3.5 py-1.5 text-sm rounded-lg transition-[background-color,color,box-shadow] duration-150 ${
                    vistaWms === id
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-medium shadow-[0_1px_2px_rgb(15_23_42/0.08)]'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Filtrar por tipo de tarea" className="flex gap-1.5 overflow-x-auto">
              {([['', 'Todas', tareasBuscadas.length], ['picking', 'Picking', conteoTipo.picking ?? 0], ['replenishment', 'Reabastecimiento', conteoTipo.replenishment ?? 0], ['armado', 'Armado', conteoTipo.armado ?? 0]] as const)
                .filter(([id, , n]) => id === '' || n > 0 || filtroTipoWms === id)
                .map(([id, label, n]) => {
                  const activo = filtroTipoWms === id
                  return (
                    <button key={id || 'todas'} type="button" aria-pressed={activo}
                      onClick={() => setFiltroTipoWms(activo && id ? '' : id)}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                        activo ? 'bg-primary text-white dark:bg-white dark:text-gray-900 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60'}`}>
                      {label}
                      <span className={`tabular-nums text-xs ${activo ? 'opacity-70' : 'text-gray-400 dark:text-gray-500'}`}>{n}</span>
                    </button>
                  )
                })}
            </div>
            <button type="button" onClick={() => onIrAPicking()} className="ml-auto flex-shrink-0 text-sm text-accent-text font-medium hover:underline flex items-center gap-1.5">
              <ScanBarcode size={14} /> Pickear con escáner
            </button>
          </div>

          {loadingWms ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-3" aria-label="Cargando tareas">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-11 rounded-lg bg-gray-100 dark:bg-gray-700/50 animate-pulse" />)}
            </div>
          ) : wmsTareas.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 py-14 px-6 text-center">
              <ScanBarcode size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No hay tareas pendientes</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Aparecen cuando se lanza un pedido o hace falta reabastecer.</p>
            </div>
          ) : vistaWms === 'tarea' ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className={`hidden lg:grid ${GRILLA_TAREA_CON_PEDIDO} items-center px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400`}>
                <Casilla checked={idsVisibles.length > 0 && nSelVisibles === idsVisibles.length} indeterminate={nSelVisibles > 0 && nSelVisibles < idsVisibles.length}
                  onChange={v => alternarSelWms(idsVisibles, v)} label="Seleccionar todas las tareas de la lista" />
                <span>Tipo</span><span>Pedido</span><span>Producto</span><span>Cantidad</span><span>Ubicación</span><span>Asignada a</span><span />
              </div>
              {/* En angosto no hay encabezado: el "seleccionar todas" va arriba de la lista. */}
              <label className="lg:hidden flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300">
                <Casilla checked={idsVisibles.length > 0 && nSelVisibles === idsVisibles.length} indeterminate={nSelVisibles > 0 && nSelVisibles < idsVisibles.length}
                  onChange={v => alternarSelWms(idsVisibles, v)} label="Seleccionar todas las tareas de la lista" />
                Seleccionar todas ({idsVisibles.length})
              </label>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {tareasVisibles.map(t => filaTarea(t, true))}
              </div>
              {tareasVisibles.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Ninguna tarea coincide con el filtro.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {grupos.map(g => {
                const ids = g.tareas.map(t => t.id)
                const nSel = ids.filter(id => selWms.has(id)).length
                const abierto = abiertosPorDefault !== gruposCambiadosWms.has(g.key)
                const todasDelPedido = g.pedidoId ? (tareasDePedidosWms as any[]).filter(t => t.pedido_id === g.pedidoId) : []
                const hechas = todasDelPedido.filter(t => t.estado === 'completada')
                const totalActivas = todasDelPedido.filter(t => t.estado !== 'cancelada').length
                const pendPorTipo = g.tareas.reduce<Record<string, number>>((acc, t) => { acc[t.tipo] = (acc[t.tipo] ?? 0) + 1; return acc }, {})
                const cliente = g.pedido ? (g.pedido.clientes?.nombre ?? g.pedido.cliente_nombre ?? 'Sin cliente') : null
                const badge = g.pedido ? (ESTADO_BADGE[g.pedido.estado] ?? null) : null
                const alternarGrupo = () => setGruposCambiadosWms(s => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })
                return (
                  <section key={g.key} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <Casilla checked={nSel === ids.length} indeterminate={nSel > 0 && nSel < ids.length}
                        onChange={v => alternarSelWms(ids, v)} label={`Seleccionar todas las tareas pendientes de ${g.titulo}`} />
                      <button type="button" onClick={alternarGrupo} aria-expanded={abierto} className="flex items-center gap-2 text-left min-w-0">
                        <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${abierto ? '' : '-rotate-90'}`} />
                        <span className="font-semibold text-sm text-primary dark:text-white tabular-nums">{g.titulo}</span>
                        {cliente && <span className={`text-sm truncate ${cliente === 'Sin cliente' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{cliente}</span>}
                      </button>
                      {badge && <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>}
                      {g.pedido?.fecha_entrega_solicitada && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          <CalendarClock size={12} /> {fechaEntregaLegible(g.pedido.fecha_entrega_solicitada)}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className="hidden sm:inline">
                          {Object.entries(pendPorTipo).map(([tipo, n]) => `${n} de ${tipoInfo(tipo).label.toLowerCase()}`).join(' · ')}
                        </span>
                        {totalActivas > 0 && (
                          <span className="tabular-nums font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                            {hechas.length} de {totalActivas} hechas
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Pedido ya cerrado con tareas vivas: la entrega no las cierra (pendiente de decisión).
                        Completarlas no mueve stock, pero el operario saldría a buscar algo que ya se fue. */}
                    {g.pedido && ['entregado', 'cancelado'].includes(g.pedido.estado) && (
                      <p className="mx-4 mb-3 -mt-1 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        <Info size={13} className="mt-0.5 flex-shrink-0" />
                        El pedido ya está {g.pedido.estado}: estas tareas quedaron colgadas y no hace falta prepararlas. Cancelalas desde el menú ⋯ de cada una.
                      </p>
                    )}
                    {abierto && (
                      <div className="panel-in border-t border-gray-100 dark:border-gray-700">
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                          {g.tareas.map(t => filaTarea(t, false))}
                          {/* Lo ya hecho del pedido, para ver el panorama completo (sin acciones). */}
                          {hechas.map(t => (
                            <div key={t.id} className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-3 items-center px-4 py-2 ${GRILLA_TAREA} text-gray-400 dark:text-gray-500`}>
                              <CheckCircle2 size={16} className="text-green-500 dark:text-green-400" aria-label="Hecha" />
                              <span className="text-[11px] font-medium">{tipoInfo(t.tipo).label}</span>
                              <span className="hidden lg:block text-sm truncate line-through decoration-gray-300 dark:decoration-gray-600">{t.productos?.nombre ?? '—'}</span>
                              <span className="hidden lg:block text-sm tabular-nums">{cantidadConUnidad(Number(t.cantidad), t.productos?.unidad_medida)}</span>
                              <span className="hidden lg:block text-xs col-span-2">
                                Hecha{t.completed_at ? ` el ${new Date(t.completed_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                              </span>
                              <span className="lg:hidden text-xs truncate col-start-2">{t.productos?.nombre} · hecha</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
              {grupos.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">Ninguna tarea coincide con el filtro.</p>
              )}
            </div>
          )}

          {/* Acciones sobre las tildadas: barra flotante. */}
          {nSelTotal > 0 && (
            <div className="barra-in sticky bottom-4 z-20 flex justify-center pointer-events-none">
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 sm:gap-3 rounded-2xl bg-gray-900 dark:bg-gray-700 text-white pl-4 pr-2 py-2 shadow-[0_12px_32px_-8px_rgb(15_23_42/0.45)]">
                <span className="text-sm"><span className="font-semibold tabular-nums">{nSelTotal}</span> tarea{nSelTotal !== 1 ? 's' : ''} seleccionada{nSelTotal !== 1 ? 's' : ''}</span>
                {puedeAsignarTareas && (
                  <select value="" disabled={completandoLote} aria-label="Asignar las tareas seleccionadas"
                    onChange={e => { const v = e.target.value; if (v) asignarSeleccionWms(v === '__nadie__' ? null : v) }}
                    className="text-sm rounded-xl bg-white/10 border border-white/15 text-white px-2.5 py-2 [&>option]:text-gray-900">
                    <option value="">Asignar a…</option>
                    <option value="__nadie__">Nadie (quitar asignación)</option>
                    {(usuariosAsignables as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre_display ?? u.rol}</option>)}
                  </select>
                )}
                <button onClick={cancelarSeleccionWms} disabled={completandoLote}
                  className="flex items-center gap-1.5 text-sm font-medium text-red-300 hover:text-red-200 hover:bg-red-500/15 px-3 py-2 rounded-xl transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-60">
                  <XCircle size={14} /> Cancelar {nSelTotal}
                </button>
                <button onClick={completarSeleccionWms} disabled={completandoLote}
                  className="flex items-center gap-1.5 text-sm font-semibold bg-accent text-white px-3.5 py-2 rounded-xl hover:bg-accent/90 transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-60">
                  <CheckCircle2 size={14} /> {completandoLote ? 'Completando…' : `Completar ${nSelTotal}`}
                </button>
                <button onClick={() => setSelWms(new Set())} aria-label="Quitar la selección" disabled={completandoLote}
                  className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"><X size={15} /></button>
              </div>
            </div>
          )}
        </div>
        )
}
