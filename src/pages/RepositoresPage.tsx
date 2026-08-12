/**
 * RepositoresPage — módulo "Repositores" (Fase 1, mig 352 + fix seguridad mig 353).
 * Relevado con Fede/GO — ver G360.Wiki/sources/raw/relevamiento_repositores_respuestas.md.
 *
 * Fase 1 = solo tareas de "cambiar el cartel de precio en la góndola", generadas automáticamente
 * por trigger de DB (cambio de precio o entrada a un estado con descuento) — nunca a mano. Prioridad
 * automática (C1-C3): vendida con el cartel desactualizado > precio subió > vencimiento cercano >
 * más vieja primero.
 *
 * Fase 2 (mig 354, E2/E4 del relevamiento) = asignación automática por carga al crearse la tarea +
 * reasignación manual con motivo, gateada a quien puede supervisar el módulo. Sigue siendo cola
 * compartida: cualquiera con acceso puede completar/cancelar CUALQUIER tarea visible, asignado o no —
 * el asignado es "de quién es la responsabilidad", no una restricción dura de quién puede tocarla.
 *
 * Fase 3 (mig 355, B1/B3/D1-D3/I3 del relevamiento) = reposición FÍSICA de stock real desde depósito
 * a la góndola — sección separada (I1: "pestañas internas Precios/Etiquetas y Reposición física"),
 * sobre `wms_tareas.tipo='reposicion_gondola'` (NO `tareas_repositor` — mecanismo de movimiento de
 * stock real, reusa `fn_completar_tarea_reabastecimiento`, mismo que Picking usa para replenishment).
 * Se genera bajo demanda ("Revisar reposición") cuando una góndola con `disponible_surtido=true`
 * quedó en cero — no hay cron en este proyecto.
 *
 * Fase 4 (mig 357, G/H del relevamiento — última fase del módulo) = etiquetas de precio para
 * imprimir: selección múltiple de carteles pendientes → un solo PDF en tanda (H3), con precio
 * (tachado el anterior si hay descuento real, G1), código de barras del producto, y "precio por
 * unidad grande" (Kg/L/m) si el producto tiene `contenido_cantidad`/`contenido_unidad_id` cargados.
 * Aviso en la página (no notificación cross-app) a partir de `tenants.repositor_hora_impresion`
 * (H1/H2) si quedan carteles activos — evaluado en cada render, sin cron ni setInterval. Imprimir NO
 * completa la tarea — son 2 acciones separadas (imprimir el cartel, después ponerlo y completar).
 * NO incluye: notificaciones cross-app, reportes (quedan fuera del alcance de Repositores).
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Tags, Flame, TrendingUp, Clock, Check, X, Tag, CircleDot, UserCog, User,
  RefreshCw, MapPin, ArrowRight, PackageCheck, Printer, Bell,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { useModoOperacion } from '@/hooks/useModoOperacion'
import { moduloOculto, puedeEditarModulo, puedeSupervisarModulo } from '@/lib/permisosModulo'
import { logActividad } from '@/lib/actividadLog'
import { useConfirm, usePrompt } from '@/hooks/useConfirm'
import { generarEtiquetasPreciosPDF, type EtiquetaPrecio, type EtiquetasPorHoja } from '@/lib/etiquetasPreciosPDF'
import { precioPorUnidadGrande, type UnidadFisica } from '@/lib/unidadMedidaFisica'

type FiltroEstado = 'activas' | 'completada' | 'cancelada'
type Seccion = 'carteles' | 'reposicion'

const MOTIVOS_CANCELACION = ['Ya no aplica', 'Producto retirado de góndola', 'Error de carga', 'Otro']

export default function RepositoresPage() {
  const navigate = useNavigate()
  const { user, tenant } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const { avanzado: modoAvanzado } = useModoOperacion()
  const confirmar = useConfirm()
  const preguntar = usePrompt()
  const qc = useQueryClient()

  const [seccion, setSeccion] = useState<Seccion>('carteles')
  const [filtro, setFiltro] = useState<FiltroEstado>('activas')
  const [reasignando, setReasignando] = useState<string | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [imprimiendo, setImprimiendo] = useState(false)

  const oculto = moduloOculto(user, 'repositores')
  const puedeEditar = puedeEditarModulo(user, 'repositores')
  const puedeSupervisar = puedeSupervisarModulo(user, 'repositores')

  // ── Carteles (Fase 1/2) ─────────────────────────────────────────────────────────────────────────
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
    enabled: !!tenant && modoAvanzado && !oculto && seccion === 'carteles',
  })

  const completarTarea = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await supabase.from('tareas_repositor')
        .update({ estado: 'completada', completed_at: new Date().toISOString() })
        .eq('id', t.id)
      if (error) throw error
      logActividad({
        entidad: 'tarea_repositor', entidad_id: t.id, entidad_nombre: `Cartel ${t.producto_nombre}`,
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
        entidad: 'tarea_repositor', entidad_id: t.id, entidad_nombre: `Cartel ${t.producto_nombre}`,
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

  // ── Etiquetas de precio (Fase 4, mig 357) ───────────────────────────────────────────────────────
  const { data: unidadesFisicas = [] } = useQuery<UnidadFisica[]>({
    queryKey: ['unidades_medida_fisicas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('unidades_medida_fisicas')
        .select('id, familia, nombre, simbolo, factor_base_familia, es_base_familia, permite_decimales')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return (data ?? []) as UnidadFisica[]
    },
    enabled: !!tenant && seccion === 'carteles',
  })

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const imprimirEtiquetas = async () => {
    const elegidas = (tareas as any[]).filter(t => seleccionadas.has(t.id))
    if (elegidas.length === 0) return
    setImprimiendo(true)
    try {
      const productoIds = Array.from(new Set(elegidas.map(t => t.producto_id)))
      const { data: productos, error } = await supabase.from('productos')
        .select('id, precio_venta, codigo_barras, gtin, contenido_cantidad, contenido_unidad_id')
        .in('id', productoIds)
      if (error) throw error
      const productosPorId = new Map((productos ?? []).map((p: any) => [p.id, p]))

      const etiquetas: EtiquetaPrecio[] = elegidas.map(t => {
        const prod = productosPorId.get(t.producto_id)
        let precio: number
        let precioAnterior: number | null = null
        if (t.tipo === 'cambio_precio') {
          precio = Number(t.precio_nuevo ?? 0)
          const anterior = Number(t.precio_anterior ?? 0)
          precioAnterior = anterior > precio ? anterior : null   // G1: solo tachar si es un descuento real
        } else {
          const base = Number(prod?.precio_venta ?? 0)
          const pct = Number(t.descuento_pct ?? 0)
          precio = pct > 0 ? base * (1 - pct / 100) : base
          precioAnterior = pct > 0 ? base : null
        }
        let pug: EtiquetaPrecio['precioPorUnidadGrande'] = null
        if (prod?.contenido_cantidad && prod?.contenido_unidad_id) {
          const unidadContenido = unidadesFisicas.find(u => u.id === prod.contenido_unidad_id)
          if (unidadContenido) pug = precioPorUnidadGrande(precio, Number(prod.contenido_cantidad), unidadContenido, unidadesFisicas)
        }
        return {
          nombre: t.producto_nombre, sku: t.producto_sku,
          codigoBarras: prod?.gtin || prod?.codigo_barras || null,
          precio, precioAnterior, precioPorUnidadGrande: pug,
        }
      })

      const porHoja = ((tenant as any)?.repositor_etiquetas_por_hoja ?? 12) as EtiquetasPorHoja
      generarEtiquetasPreciosPDF(etiquetas, porHoja)
      toast.success(`PDF generado — ${etiquetas.length} etiqueta(s)`)
      setSeleccionadas(new Set())
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudieron generar las etiquetas')
    } finally {
      setImprimiendo(false)
    }
  }

  const horaAviso = (tenant as any)?.repositor_hora_impresion as string | null | undefined
  const horaAvisoAlcanzada = !!horaAviso && new Date().toTimeString().slice(0, 5) >= horaAviso.slice(0, 5)

  // ── Reposición física (Fase 3, mig 355) ─────────────────────────────────────────────────────────
  const { data: tareasRepo = [], isLoading: isLoadingRepo } = useQuery({
    queryKey: ['wms-reposicion-gondola', tenant?.id, sucursalId, filtro],
    queryFn: async () => {
      let q = supabase.from('wms_tareas')
        .select('*, productos(nombre, sku), ubicacion_origen:ubicaciones!wms_tareas_ubicacion_origen_id_fkey(nombre), ubicacion_destino:ubicaciones!wms_tareas_ubicacion_destino_id_fkey(nombre), usuario_asignado:users!wms_tareas_usuario_asignado_id_fkey(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .eq('tipo', 'reposicion_gondola')
      q = applyFilter(q)
      q = filtro === 'activas' ? q.in('estado', ['pendiente', 'en_curso']) : q.eq('estado', filtro)
      q = q.order('created_at', { ascending: true }).limit(200)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && modoAvanzado && !oculto && seccion === 'reposicion',
  })

  const revisarReposicion = async () => {
    setRevisando(true)
    const { data, error } = await supabase.rpc('fn_generar_tareas_reposicion_gondola', { p_tenant_id: tenant!.id })
    setRevisando(false)
    if (error) { toast.error(error.message); return }
    const n = (data ?? []).length
    qc.invalidateQueries({ queryKey: ['wms-reposicion-gondola'] })
    toast.success(n > 0 ? `${n} tarea(s) de reposición generada(s)` : 'Ninguna góndola necesita reposición ahora')
  }

  const completarRepo = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await supabase.rpc('fn_completar_tarea_reabastecimiento', { p_tarea_id: t.id })
      if (error) throw error
      logActividad({
        entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? undefined,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'completada',
        pagina: '/repositores', tipo_transaccion: 'traslado', producto_id: t.producto_id, sucursal_id: t.sucursal_id,
      })
    },
    onSuccess: () => {
      toast.success('Reposición completada — stock movido a la góndola')
      qc.invalidateQueries({ queryKey: ['wms-reposicion-gondola'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelarRepo = useMutation({
    mutationFn: async ({ t, motivo }: { t: any; motivo: string }) => {
      const { error } = await supabase.rpc('fn_cancelar_tarea_wms', { p_tarea_id: t.id, p_motivo: motivo })
      if (error) throw error
      logActividad({
        entidad: 'wms_tarea', entidad_id: t.id, entidad_nombre: t.productos?.nombre ?? undefined,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: t.estado, valor_nuevo: 'cancelada',
        pagina: '/repositores', producto_id: t.producto_id, sucursal_id: t.sucursal_id,
      })
    },
    onSuccess: () => {
      toast.success('Reposición cancelada')
      qc.invalidateQueries({ queryKey: ['wms-reposicion-gondola'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Reasignar — compartido entre las 2 secciones (mismo pool/RPC, distinta tabla destino) ─────────
  const listaActual = seccion === 'carteles' ? tareas : tareasRepo
  const tareaAbierta = reasignando ? (listaActual as any[]).find(t => t.id === reasignando) : null
  const nombreAsignadoDe = (t: any) => (seccion === 'carteles' ? t.usuario_asignado_nombre : t.usuario_asignado?.nombre_display) ?? 'Sin asignar'

  const { data: usuariosElegibles = [] } = useQuery({
    queryKey: ['usuarios-hacen-repositor', tenant?.id, tareaAbierta?.sucursal_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_usuarios_hacen_repositor', {
        p_tenant_id: tenant!.id, p_sucursal_id: tareaAbierta.sucursal_id,
      })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && !!tareaAbierta,
  })

  const reasignarTarea = useMutation({
    mutationFn: async ({ t, usuarioId, usuarioNombre, motivo, sec }: { t: any; usuarioId: string | null; usuarioNombre: string | null; motivo: string; sec: Seccion }) => {
      const tabla = sec === 'carteles' ? 'tareas_repositor' : 'wms_tareas'
      const { error } = await supabase.from(tabla).update({ usuario_asignado_id: usuarioId }).eq('id', t.id)
      if (error) throw error
      logActividad({
        entidad: sec === 'carteles' ? 'tarea_repositor' : 'wms_tarea',
        entidad_id: t.id,
        entidad_nombre: sec === 'carteles' ? `Cartel ${t.producto_nombre}` : (t.productos?.nombre ?? undefined),
        accion: 'reasignar', campo: 'usuario_asignado_id',
        valor_anterior: nombreAsignadoDe(t),
        valor_nuevo: `${usuarioNombre ?? 'Sin asignar'} — ${motivo}`,
        pagina: '/repositores', sucursal_id: t.sucursal_id, producto_id: t.producto_id,
      })
    },
    onSuccess: (_data, vars) => {
      toast.success('Tarea reasignada')
      qc.invalidateQueries({ queryKey: vars.sec === 'carteles' ? ['tareas-repositor'] : ['wms-reposicion-gondola'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleReasignar = async (t: any, usuarioId: string | null, usuarioNombre: string | null) => {
    setReasignando(null)
    const motivo = await preguntar('¿Por qué se reasigna esta tarea?', {
      titulo: 'Reasignar tarea', placeholder: 'Ej: se fue antes, tiene otra prioridad…',
    })
    if (motivo == null) return
    reasignarTarea.mutate({ t, usuarioId, usuarioNombre, motivo: motivo.trim() || 'Sin motivo especificado', sec: seccion })
  }

  const handleCancelar = async (t: any) => {
    const motivo = await preguntar('¿Por qué se cancela esta tarea?', {
      titulo: 'Cancelar tarea', placeholder: MOTIVOS_CANCELACION[0],
    })
    if (motivo == null) return
    const nombre = seccion === 'carteles' ? t.producto_nombre : (t.productos?.nombre ?? '')
    if (!(await confirmar(`¿Cancelar la tarea de "${nombre}"?`, { danger: true }))) return
    const motivoFinal = motivo.trim() || 'Sin motivo especificado'
    if (seccion === 'carteles') cancelarTarea.mutate({ t, motivo: motivoFinal })
    else cancelarRepo.mutate({ t, motivo: motivoFinal })
  }

  const handleCompletar = async (t: any) => {
    const nombre = seccion === 'carteles' ? t.producto_nombre : (t.productos?.nombre ?? '')
    const msg = seccion === 'carteles'
      ? `¿Marcar como lista la tarea de "${nombre}"?`
      : `¿Confirmar que se movió el stock de "${nombre}" a la góndola?`
    if (!(await confirmar(msg))) return
    if (seccion === 'carteles') completarTarea.mutate(t)
    else completarRepo.mutate(t)
  }

  if (oculto) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <Tags size={48} className="mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-lg font-medium">Sin acceso</p>
      </div>
    )
  }

  const listaVisible = seccion === 'carteles' ? tareas : tareasRepo
  const cargando = seccion === 'carteles' ? isLoading : isLoadingRepo

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
            {seccion === 'carteles'
              ? 'Cambios de precio y de estado que necesitan actualizar el cartel en la góndola.'
              : 'Góndolas que se quedaron sin stock y necesitan reposición desde el depósito.'}
          </p>
        </div>
        {seccion === 'reposicion' && (
          <button onClick={revisarReposicion} disabled={revisando}
            title="Revisar reposición"
            className="p-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw size={18} className={`text-gray-500 dark:text-gray-400 ${revisando ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {([['carteles', 'Precios/Etiquetas'], ['reposicion', 'Reposición física']] as [Seccion, string][]).map(([key, label]) => (
          <button key={key} onClick={() => { setSeccion(key); setReasignando(null); setSeleccionadas(new Set()) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              seccion === key ? 'bg-primary text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {([['activas', 'Pendientes'], ['completada', 'Completadas'], ['cancelada', 'Canceladas']] as [FiltroEstado, string][]).map(([key, label]) => (
          <button key={key} onClick={() => { setFiltro(key); setSeleccionadas(new Set()) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === key ? 'bg-accent text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            {label}
          </button>
        ))}
      </div>

      {seccion === 'carteles' && filtro === 'activas' && horaAvisoAlcanzada && (tareas as any[]).length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Bell size={16} className="flex-shrink-0" />
          Hay {(tareas as any[]).length} cartel{(tareas as any[]).length === 1 ? '' : 'es'} pendiente{(tareas as any[]).length === 1 ? '' : 's'} de imprimir desde las {horaAviso!.slice(0, 5)}.
        </div>
      )}

      {seccion === 'carteles' && filtro === 'activas' && puedeEditar && (tareas as any[]).length > 0 && (
        <div className="flex items-center justify-between gap-2 bg-white dark:bg-gray-800 rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-700">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox"
              checked={seleccionadas.size > 0 && seleccionadas.size === (tareas as any[]).length}
              onChange={(e) => setSeleccionadas(e.target.checked ? new Set((tareas as any[]).map(t => t.id)) : new Set())}
              className="rounded border-gray-300" />
            {seleccionadas.size > 0 ? `${seleccionadas.size} seleccionada${seleccionadas.size === 1 ? '' : 's'}` : 'Seleccionar todas'}
          </label>
          <button onClick={imprimirEtiquetas} disabled={seleccionadas.size === 0 || imprimiendo}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <Printer size={14} /> {imprimiendo ? 'Generando…' : `Imprimir etiquetas${seleccionadas.size > 0 ? ` (${seleccionadas.size})` : ''}`}
          </button>
        </div>
      )}

      {cargando ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Cargando tareas…</div>
      ) : (listaVisible as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <Tags size={40} className="mb-3 text-gray-200 dark:text-gray-700" />
          <p className="font-medium">{filtro === 'activas' ? 'No hay tareas pendientes' : 'Sin tareas en este filtro'}</p>
          {filtro === 'activas' && (
            <p className="text-sm mt-1">
              {seccion === 'carteles'
                ? 'Aparecen solas cuando cambia un precio o un producto entra en descuento.'
                : 'Aparecen solas cuando una góndola queda en cero — o clickeá el botón de arriba para revisar ahora.'}
            </p>
          )}
        </div>
      ) : seccion === 'carteles' ? (
        <div className="space-y-2">
          {(tareas as any[]).map(t => (
            <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-start gap-3">
                {filtro === 'activas' && puedeEditar && (
                  <input type="checkbox" checked={seleccionadas.has(t.id)} onChange={() => toggleSeleccion(t.id)}
                    className="mt-1.5 flex-shrink-0 rounded border-gray-300" />
                )}
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
                    {filtro === 'activas' && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                        <User size={10} /> {t.usuario_asignado_nombre ?? 'Sin asignar'}
                      </span>
                    )}
                  </div>
                </div>
                {filtro === 'activas' && puedeEditar && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {puedeSupervisar && (
                      reasignando === t.id ? (
                        <select autoFocus defaultValue=""
                          onChange={(e) => {
                            const usuarioId = e.target.value || null
                            const usuarioNombre = usuarioId ? (usuariosElegibles.find((u: any) => u.usuario_id === usuarioId)?.nombre ?? null) : null
                            handleReasignar(t, usuarioId, usuarioNombre)
                          }}
                          onBlur={() => setReasignando(null)}
                          className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white">
                          <option value="">Sin asignar</option>
                          {usuariosElegibles.map((u: any) => <option key={u.usuario_id} value={u.usuario_id}>{u.nombre}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setReasignando(t.id)}
                          title="Reasignar"
                          className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-500 transition-colors">
                          <UserCog size={16} />
                        </button>
                      )
                    )}
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
      ) : (
        <div className="space-y-2">
          {(tareasRepo as any[]).map(t => (
            <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl px-4 py-3 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <PackageCheck size={15} className="text-gray-500 dark:text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.productos?.nombre ?? '—'}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t.productos?.sku}</p>
                  {t.notas && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{t.notas}</p>}
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <MapPin size={11} className="text-gray-400" />
                    <span>{t.ubicacion_origen?.nombre ?? 'sin ubicación'}</span>
                    <ArrowRight size={11} className="text-gray-400" />
                    <span>{t.ubicacion_destino?.nombre ?? 'sin ubicación'}</span>
                  </div>
                  {filtro === 'activas' && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-1 mt-1.5">
                      <User size={10} /> {t.usuario_asignado?.nombre_display ?? 'Sin asignar'}
                    </span>
                  )}
                </div>
                {filtro === 'activas' && puedeEditar && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {puedeSupervisar && (
                      reasignando === t.id ? (
                        <select autoFocus defaultValue=""
                          onChange={(e) => {
                            const usuarioId = e.target.value || null
                            const usuarioNombre = usuarioId ? (usuariosElegibles.find((u: any) => u.usuario_id === usuarioId)?.nombre ?? null) : null
                            handleReasignar(t, usuarioId, usuarioNombre)
                          }}
                          onBlur={() => setReasignando(null)}
                          className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white">
                          <option value="">Sin asignar</option>
                          {usuariosElegibles.map((u: any) => <option key={u.usuario_id} value={u.usuario_id}>{u.nombre}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setReasignando(t.id)}
                          title="Reasignar"
                          className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-500 transition-colors">
                          <UserCog size={16} />
                        </button>
                      )
                    )}
                    <button onClick={() => handleCompletar(t)} disabled={completarRepo.isPending}
                      title="Confirmar reposición"
                      className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-50 transition-colors">
                      <Check size={16} />
                    </button>
                    <button onClick={() => handleCancelar(t)} disabled={cancelarRepo.isPending}
                      title="Cancelar"
                      className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 disabled:opacity-50 transition-colors">
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
