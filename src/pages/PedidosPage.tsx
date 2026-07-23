/**
 * PedidosPage — módulo NUEVO "Pedidos" (ciclo de vida completo: PED1-PED6).
 * Relevado con GO 2026-07-22 (ver G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md).
 *
 * Decisión de arquitectura clave: Pedidos es un documento separado de Ventas — NUNCA pasa
 * por registrarVenta()/el POS, nunca rebaja stock directo (eso lo hace fn_pedido_generar_venta
 * al entregar, PED4). Ciclo: borrador → confirmado → (Lanzar, PED3) en_preparacion →
 * (Entregar, PED4) entregado(_parcial) → cancelado, con deshacer-lanzamiento/des-pickeo (PED5)
 * y lanzamiento en bolsa con staging (PED6) disponibles en los puntos que corresponda.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, X, Search, ChevronDown, ChevronUp, Package, User, Truck, CalendarClock, Rocket, Layers, Printer, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import { BRAND } from '@/config/brand'
import { ActionMenu } from '@/components/ActionMenu'
import { puedeTransicionPedido, type PedidoTransicion, type PedidoTransicionesConfig } from '@/lib/pedidoTransiciones'

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  borrador:            { label: 'Borrador',            cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
  confirmado:          { label: 'Confirmado',           cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  en_preparacion:      { label: 'En preparación',       cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  listo_para_entrega:  { label: 'Listo para entrega',   cls: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' },
  entregado:           { label: 'Entregado',            cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  entregado_parcial:   { label: 'Entregado parcial',    cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  cancelado:           { label: 'Cancelado',            cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
}

interface ItemDraft {
  producto: { id: string; nombre: string; sku: string; unidad_medida: string | null }
  cantidad: string
  estadoId: string
  talle: string; color: string; encaje: string; formato: string; saborAroma: string
}

export default function PedidosPage() {
  const navigate = useNavigate()
  const { tenant, user } = useAuthStore()
  const { sucursalId, puedeVerTodas } = useSucursalFilter()
  const qc = useQueryClient()

  // E3 — gate client-side por transición (config Pedidos → tabla de roles), mismo criterio que
  // ajuste_autorizacion_roles (mig 228): filtra qué botón se muestra, no reemplaza los guards
  // server-side de cada RPC (stock/caja/CC/idempotencia — esos SÍ corren siempre, para
  // cualquier rol). Ver src/lib/pedidoTransiciones.ts.
  const puedeYo = (transicion: PedidoTransicion) =>
    puedeTransicionPedido(user?.rol, transicion, ((tenant as any)?.pedido_transiciones_roles ?? null) as PedidoTransicionesConfig)

  const [showNuevo, setShowNuevo] = useState(false)
  const [tipoPedidoId, setTipoPedidoId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteDropOpen, setClienteDropOpen] = useState(false)
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [requiereEnvio, setRequiereEnvio] = useState(false)
  const [notasCab, setNotasCab] = useState('')
  const [prodSearch, setProdSearch] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState('')

  // ── Entregar (PED4): genera la venta real + rebaja stock reservado + asienta caja ────
  const [entregaModal, setEntregaModal] = useState<any | null>(null)
  const [entregaSesionId, setEntregaSesionId] = useState('')
  const [entregaMedioPago, setEntregaMedioPago] = useState('Efectivo')
  const [entregaCantidades, setEntregaCantidades] = useState<Record<string, string>>({})

  const inputCls = 'w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800'

  // ── Catálogos ──────────────────────────────────────────────────────────────
  const { data: tiposPedido = [] } = useQuery({
    queryKey: ['tipos_pedido', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('tipos_pedido')
        .select('id, nombre, cliente_obligatorio, factura_momento')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('orden')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: estadosInventario = [] } = useQuery({
    queryKey: ['estados_inventario_pedidos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario')
        .select('id, nombre, color').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const tipoSel = (tiposPedido as any[]).find(t => t.id === tipoPedidoId)

  // ── Pedidos del tenant (RLS ya filtra por sucursal; acordonamos igual si hay una activa) ──
  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('pedidos')
        .select('*, tipos_pedido(nombre), clientes(nombre), pedido_items(*, productos(nombre, sku, unidad_medida))')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const pedidosFiltrados = filtroEstado ? (pedidos as any[]).filter(p => p.estado === filtroEstado) : (pedidos as any[])

  // ── K3 (PED8): exportar Excel/PDF/CSV — una fila por línea de pedido, mismo criterio que
  // el resto de los módulos (XLSX.utils.json_to_sheet / jsPDF+autoTable / CSV a mano) ──────
  const filasExport = () => pedidosFiltrados.flatMap((p: any) => {
    const cliente = p.clientes?.nombre ?? p.cliente_nombre ?? 'Sin cliente'
    const items = (p.pedido_items ?? []).filter((it: any) => it.estado !== 'cancelada')
    if (items.length === 0) return [{
      Pedido: p.numero, Tipo: p.tipos_pedido?.nombre ?? '', Cliente: cliente, Estado: ESTADO_BADGE[p.estado]?.label ?? p.estado,
      'Entrega solicitada': p.fecha_entrega_solicitada ? new Date(p.fecha_entrega_solicitada).toLocaleDateString('es-AR') : '',
      Producto: '', SKU: '', Cantidad: '', Entregado: '',
    }]
    return items.map((it: any) => ({
      Pedido: p.numero, Tipo: p.tipos_pedido?.nombre ?? '', Cliente: cliente, Estado: ESTADO_BADGE[p.estado]?.label ?? p.estado,
      'Entrega solicitada': p.fecha_entrega_solicitada ? new Date(p.fecha_entrega_solicitada).toLocaleDateString('es-AR') : '',
      Producto: it.productos?.nombre ?? '', SKU: it.productos?.sku ?? '',
      Cantidad: Number(it.cantidad), Entregado: Number(it.cantidad_entregada ?? 0),
    }))
  })

  const exportarExcel = () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Pedidos')
    XLSX.writeFile(wb, `pedidos_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast.success('Excel descargado')
  }

  const exportarCSV = () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    const cols = Object.keys(filas[0])
    const header = cols.map(c => `"${c}"`).join(',')
    const rows = filas.map(r => cols.map(c => `"${String((r as any)[c] ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `pedidos_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
    toast.success('CSV descargado')
  }

  const exportarPDF = () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    const cols = Object.keys(filas[0])
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFillColor(30, 58, 95); doc.rect(0, 0, doc.internal.pageSize.width, 25, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text(BRAND.name, 14, 12)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text('Reporte de Pedidos', 14, 20)
    doc.setTextColor(60, 60, 60); doc.setFontSize(9)
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, 14, 32)
    autoTable(doc, {
      startY: 38,
      head: [cols],
      body: filas.map(r => cols.map(c => String((r as any)[c] ?? ''))),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 58, 95], fontSize: 8 },
    })
    doc.save(`pedidos_${new Date().toISOString().split('T')[0]}.pdf`)
    toast.success('PDF descargado')
  }

  // ── Cajas abiertas (mismo criterio que VentasPage: excluye la Caja Fuerte) ──────────
  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre, es_caja_fuerte)')
        .eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      return (data ?? []).filter((s: any) => !s.cajas?.es_caja_fuerte)
    },
    enabled: !!tenant && !!entregaModal,
  })

  // ── Tareas WMS del pedido expandido (PED5: mostrar progreso + permitir des-pickeo) ──
  const { data: tareasPedidoExp = [] } = useQuery({
    queryKey: ['pedido-tareas', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('wms_tareas')
        .select('id, tipo, estado, producto_id, cantidad, lpn_origen, tarea_precedente_id, productos(nombre, sku)')
        .eq('pedido_id', expandedId!).order('created_at')
      return data ?? []
    },
    enabled: !!expandedId,
  })

  // ── Ventas generadas por el pedido expandido (A5: guía para devolver antes de cancelar) ──
  const { data: ventasPedidoExp = [] } = useQuery({
    queryKey: ['pedido-ventas', expandedId],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('id, numero, estado, total').eq('pedido_id', expandedId!).order('created_at')
      return data ?? []
    },
    enabled: !!expandedId,
  })

  // ── Búsqueda de cliente (igual patrón que VentasPage) ────────────────────────
  const { data: clientesBusqueda = [] } = useQuery({
    queryKey: ['clientes-search-pedidos', tenant?.id, clienteSearch],
    queryFn: async () => {
      let q = supabase.from('clientes').select('id, nombre, telefono')
        .eq('tenant_id', tenant!.id).order('nombre').limit(10)
      if (clienteSearch) q = q.or(`nombre.ilike.%${clienteSearch}%`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && clienteDropOpen,
  })

  // ── Búsqueda de producto para agregar línea (catálogo, no LPN — eso se resuelve al lanzar) ──
  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-search-pedidos', tenant?.id, prodSearch],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, unidad_medida')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`nombre.ilike.%${prodSearch}%,sku.ilike.%${prodSearch}%`)
        .order('nombre').limit(20)
      return data ?? []
    },
    enabled: !!tenant && prodSearch.trim().length >= 2,
  })

  const agregarItem = (p: any) => {
    if (items.some(i => i.producto.id === p.id)) { toast.error('Ese producto ya está en el pedido'); return }
    setItems(prev => [...prev, { producto: p, cantidad: '1', estadoId: '', talle: '', color: '', encaje: '', formato: '', saborAroma: '' }])
    setProdSearch('')
  }

  const resetForm = () => {
    setTipoPedidoId(''); setClienteId(''); setClienteNombre(''); setClienteTelefono(''); setClienteSearch('')
    setFechaEntrega(''); setRequiereEnvio(false); setNotasCab(''); setItems([]); setProdSearch('')
  }

  // ── Crear pedido (borrador) ───────────────────────────────────────────────────
  const crearPedido = useMutation({
    mutationFn: async () => {
      if (!tipoPedidoId) throw new Error('Elegí el tipo de pedido')
      if (!items.length) throw new Error('Agregá al menos una línea')
      if (tipoSel?.cliente_obligatorio && !clienteId && !clienteNombre.trim())
        throw new Error('Este tipo de pedido requiere cliente identificado')
      for (const it of items) {
        const cant = parseFloat(it.cantidad)
        if (!cant || cant <= 0) throw new Error(`Cantidad inválida en ${it.producto.nombre}`)
      }

      const { data: cab, error: eCab } = await supabase.from('pedidos').insert({
        tenant_id: tenant!.id,
        sucursal_id: sucursalId ?? null,
        tipo_pedido_id: tipoPedidoId,
        cliente_id: clienteId || null,
        cliente_nombre: clienteId ? null : (clienteNombre.trim() || null),
        cliente_telefono: clienteId ? null : (clienteTelefono.trim() || null),
        fecha_entrega_solicitada: fechaEntrega || null,
        requiere_envio: requiereEnvio,
        notas: notasCab.trim() || null,
        creado_por: user?.id ?? null,
      }).select('id, numero').single()
      if (eCab) throw eCab

      const rows = items.map(it => ({
        tenant_id: tenant!.id,
        pedido_id: cab.id,
        producto_id: it.producto.id,
        cantidad: parseFloat(it.cantidad),
        estado_id: it.estadoId || null,
        talle: it.talle || null, color: it.color || null, encaje: it.encaje || null,
        formato: it.formato || null, sabor_aroma: it.saborAroma || null,
      }))
      const { error: eItems } = await supabase.from('pedido_items').insert(rows)
      if (eItems) throw eItems

      logActividad({
        entidad: 'pedido', entidad_id: cab.id,
        entidad_nombre: `Pedido #${cab.numero}`, accion: 'crear', pagina: '/pedidos',
      })
      return { numero: cab.numero }
    },
    onSuccess: (d: any) => {
      toast.success(`Pedido #${d.numero} guardado como borrador`)
      setShowNuevo(false); resetForm()
      qc.invalidateQueries({ queryKey: ['pedidos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Lanzar (PED3): genera tareas WMS de picking/reabastecimiento + reserva stock real ──
  const lanzarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { data, error } = await supabase.rpc('fn_generar_tareas_picking_pedido', { p_pedido_id: pedido.id })
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: pedido.estado, valor_nuevo: 'en_preparacion', pagina: '/pedidos',
      })
      return { numero: pedido.numero, nTareas: (data ?? []).length }
    },
    onSuccess: (d: any) => {
      toast.success(`Pedido #${d.numero} lanzado — ${d.nTareas} tarea(s) generada(s) en Picking`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Bolsa de pedidos (PED6): lanzar N pedidos juntos con una ubicación de staging ────
  const [bolsaSeleccion, setBolsaSeleccion] = useState<Set<string>>(new Set())
  const [bolsaModalOpen, setBolsaModalOpen] = useState(false)
  const [bolsaUbicacionId, setBolsaUbicacionId] = useState('')

  const toggleBolsaSeleccion = (pedidoId: string) => {
    setBolsaSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(pedidoId)) next.delete(pedidoId); else next.add(pedidoId)
      return next
    })
  }

  const { data: ubicacionesStaging = [] } = useQuery({
    queryKey: ['ubicaciones-staging', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('tipo_ubicacion', 'staging').eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && bolsaModalOpen,
  })

  const lanzarBolsa = useMutation({
    mutationFn: async () => {
      if (!bolsaUbicacionId) throw new Error('Elegí la ubicación de staging')
      const ids = Array.from(bolsaSeleccion)
      const { data, error } = await supabase.rpc('fn_lanzar_bolsa_pedidos', {
        p_pedido_ids: ids, p_ubicacion_staging_id: bolsaUbicacionId,
      })
      if (error) throw error
      for (const id of ids) {
        const p = (pedidos as any[]).find(x => x.id === id)
        logActividad({
          entidad: 'pedido', entidad_id: id, entidad_nombre: `Pedido #${p?.numero ?? '?'}`,
          accion: 'cambio_estado', campo: 'estado', valor_anterior: 'confirmado', valor_nuevo: 'en_preparacion', pagina: '/pedidos',
        })
      }
      return { nPedidos: ids.length, nTareas: (data ?? []).length }
    },
    onSuccess: (d: any) => {
      toast.success(`Bolsa lanzada — ${d.nPedidos} pedido(s), ${d.nTareas} tarea(s) generada(s) en Picking`)
      setBolsaModalOpen(false); setBolsaUbicacionId(''); setBolsaSeleccion(new Set())
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Lista de picking imprimible (PED6, L2-2): fallback cuando falla el escaneo ───────
  const [imprimirPedido, setImprimirPedido] = useState<any | null>(null)
  const { data: tareasImprimir = [] } = useQuery({
    queryKey: ['pedido-tareas-imprimir', imprimirPedido?.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_tareas')
        .select('id, tipo, cantidad, lpn_origen, ubicacion_origen:ubicaciones!wms_tareas_ubicacion_origen_id_fkey(nombre), ubicacion_destino:ubicaciones!wms_tareas_ubicacion_destino_id_fkey(nombre), productos(nombre, sku)')
        .eq('pedido_id', imprimirPedido!.id).order('created_at')
      return data ?? []
    },
    enabled: !!imprimirPedido,
  })

  // ── Des-pickeo (PED5, E4): deshacer una tarea de picking ya completada ──────────────
  const [unpickModal, setUnpickModal] = useState<any | null>(null)
  const [unpickUbicacionId, setUnpickUbicacionId] = useState('')

  const { data: ubicacionesDestino = [] } = useQuery({
    queryKey: ['ubicaciones-unpick', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones')
        .select('id, nombre, tipo_ubicacion').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && !!unpickModal,
  })

  const unpickTarea = useMutation({
    mutationFn: async () => {
      if (!unpickModal) throw new Error('Sin tarea')
      if (!unpickUbicacionId) throw new Error('Elegí la ubicación destino')
      const { error } = await supabase.rpc('fn_unpick_tarea_wms', {
        p_tarea_id: unpickModal.id, p_ubicacion_destino_id: unpickUbicacionId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Picking deshecho — LPN reubicado, stock liberado')
      setUnpickModal(null); setUnpickUbicacionId('')
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['pedido-tareas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Entregar (PED4): abre el modal con la cantidad pendiente de cada línea precargada ──
  const [entregaIdempotencyKey, setEntregaIdempotencyKey] = useState('')
  const abrirEntrega = (pedido: any) => {
    const cants: Record<string, string> = {}
    for (const it of pedido.pedido_items ?? []) {
      if (it.estado === 'cancelada') continue
      const pendiente = Number(it.cantidad) - Number(it.cantidad_entregada ?? 0)
      if (pendiente > 0) cants[it.id] = String(pendiente)
    }
    setEntregaCantidades(cants)
    setEntregaMedioPago('Efectivo')
    setEntregaSesionId('')
    setEntregaIdempotencyKey(crypto.randomUUID())
    setEntregaModal(pedido)
  }

  const generarVenta = useMutation({
    mutationFn: async () => {
      const pedido = entregaModal
      if (!pedido) throw new Error('Sin pedido')
      const entregas = Object.entries(entregaCantidades)
        .map(([pedido_item_id, cant]) => ({ pedido_item_id, cantidad: parseFloat(cant) }))
        .filter(e => e.cantidad > 0)
      if (!entregas.length) throw new Error('Ingresá al menos una cantidad a entregar')
      const sesionId = entregaSesionId || ((sesionesAbiertas as any[]).length === 1 ? (sesionesAbiertas as any[])[0].id : '')
      if (!sesionId) throw new Error('Seleccioná en qué caja abierta registrar el ingreso')

      // Idempotencia: la misma key sobrevive a reintentos de esta MISMA submission (ej. error
      // de red) — un reintento con la misma key devuelve la venta ya generada en vez de duplicar.
      const { data, error } = await supabase.rpc('fn_pedido_generar_venta', {
        p_pedido_id: pedido.id,
        p_sesion_caja_id: sesionId,
        p_medio_pago: [{ tipo: entregaMedioPago, monto: null }],
        p_entregas: entregas,
        p_idempotency_key: entregaIdempotencyKey,
      })
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'crear', pagina: '/pedidos', tipo_transaccion: 'venta',
      })
      return { numero: pedido.numero, ventaId: data as string }
    },
    onSuccess: (d: any) => {
      toast.success(`Venta generada para el Pedido #${d.numero}`)
      setEntregaModal(null)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cerrarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { error } = await supabase.rpc('fn_pedido_cerrar', { p_pedido_id: pedido.id })
      if (error) throw error
      return pedido.numero
    },
    onSuccess: (numero) => {
      toast.success(`Pedido #${numero} cerrado`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Confirmar (E1: borrador→confirmado, sin implicancia de stock) ───────────────────
  const cambiarEstado = useMutation({
    mutationFn: async ({ pedido, nuevoEstado }: { pedido: any; nuevoEstado: string }) => {
      const patch: Record<string, any> = { estado: nuevoEstado, confirmado_at: new Date().toISOString() }
      const { error } = await supabase.from('pedidos').update(patch).eq('id', pedido.id)
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: pedido.estado, valor_nuevo: nuevoEstado, pagina: '/pedidos',
      })
      return { numero: pedido.numero, nuevoEstado }
    },
    onSuccess: (d: any) => {
      toast.success(`Pedido #${d.numero} — ${ESTADO_BADGE[d.nuevoEstado]?.label ?? d.nuevoEstado}`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Cancelar (PED5): cualquier estado no terminal — libera reservas si ya se lanzó ──
  const cancelarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { error } = await supabase.rpc('fn_cancelar_pedido', { p_pedido_id: pedido.id })
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: pedido.estado, valor_nuevo: 'cancelado', pagina: '/pedidos',
      })
      return pedido.numero
    },
    onSuccess: (numero) => {
      toast.success(`Pedido #${numero} cancelado`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Deshacer lanzamiento (PED5, F5): vuelve a confirmado, libera reservas ───────────
  const deslanzarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { error } = await supabase.rpc('fn_pedido_deslanzar', { p_pedido_id: pedido.id })
      if (error) throw error
      return pedido.numero
    },
    onSuccess: (numero) => {
      toast.success(`Pedido #${numero} — lanzamiento deshecho, vuelve a Confirmado`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary">Pedidos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Logística — no es venta de mostrador. Se arma acá, se prepara y recién ahí genera la venta real.</p>
        </div>
        <button onClick={() => setShowNuevo(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-accent/90 transition-colors flex-shrink-0">
          <Plus size={15} /> Nuevo pedido
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          className={`${inputCls} max-w-[220px]`}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <ActionMenu label="Exportar" items={[
          { label: 'Exportar Excel', icon: Download, onClick: exportarExcel },
          { label: 'Exportar CSV', icon: Download, onClick: exportarCSV },
          { label: 'Exportar PDF', icon: Download, onClick: exportarPDF },
        ]} />
        {bolsaSeleccion.size > 0 && puedeYo('lanzar') && (
          <div className="flex items-center gap-2 ml-auto bg-accent/10 border border-accent/30 rounded-xl px-3 py-1.5">
            <span className="text-xs font-medium text-accent-text">{bolsaSeleccion.size} pedido(s) seleccionado(s)</span>
            <button onClick={() => setBolsaModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors">
              <Layers size={13} /> Lanzar bolsa
            </button>
            <button onClick={() => setBolsaSeleccion(new Set())} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {isLoading ? (
          <p className="p-6 text-sm text-gray-400 text-center">Cargando…</p>
        ) : pedidosFiltrados.length === 0 ? (
          <div className="p-10 text-center">
            <Package size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Sin pedidos todavía</p>
          </div>
        ) : pedidosFiltrados.map(p => {
          const badge = ESTADO_BADGE[p.estado] ?? ESTADO_BADGE.borrador
          const isExp = expandedId === p.id
          const nItems = (p.pedido_items ?? []).length
          const cliente = p.clientes?.nombre ?? p.cliente_nombre ?? 'Sin cliente'
          return (
            <div key={p.id}>
              <div className="p-4 flex items-center gap-3 flex-wrap">
                {p.estado === 'confirmado' && puedeYo('lanzar') && (
                  <input type="checkbox" checked={bolsaSeleccion.has(p.id)} onChange={() => toggleBolsaSeleccion(p.id)}
                    className="rounded flex-shrink-0" title="Seleccionar para lanzar en bolsa" />
                )}
                <button onClick={() => setExpandedId(isExp ? null : p.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  {isExp ? <ChevronUp size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />}
                  <span className="font-semibold text-sm text-primary dark:text-white">#{p.numero}</span>
                  <span className="text-xs text-gray-400">{p.tipos_pedido?.nombre}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300 truncate flex items-center gap-1"><User size={12} className="text-gray-400" />{cliente}</span>
                  <span className="text-xs text-gray-400">{nItems} línea{nItems !== 1 ? 's' : ''}</span>
                  {p.requiere_envio && <Truck size={12} className="text-gray-400" />}
                  {p.fecha_entrega_solicitada && (
                    <span className="text-xs text-gray-400 flex items-center gap-1"><CalendarClock size={11} />{new Date(p.fecha_entrega_solicitada).toLocaleDateString('es-AR')}</span>
                  )}
                </button>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                {p.estado === 'borrador' && puedeYo('confirmar') && (
                  <button onClick={() => cambiarEstado.mutate({ pedido: p, nuevoEstado: 'confirmado' })}
                    disabled={cambiarEstado.isPending}
                    className="text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                    Confirmar
                  </button>
                )}
                {p.estado === 'confirmado' && puedeYo('lanzar') && (
                  <button onClick={() => lanzarPedido.mutate(p)}
                    disabled={lanzarPedido.isPending}
                    title="Genera las tareas de picking/reabastecimiento en Depósito y reserva el stock"
                    className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50">
                    <Rocket size={13} /> {lanzarPedido.isPending ? 'Lanzando…' : 'Lanzar'}
                  </button>
                )}
                {['en_preparacion', 'listo_para_entrega'].includes(p.estado) && (
                  <button onClick={() => navigate('/picking')}
                    className="text-xs font-semibold text-accent-text border border-accent-text/30 px-3 py-1.5 rounded-lg hover:bg-accent/10 transition-colors">
                    Ver en Picking
                  </button>
                )}
                {p.lanzado_at && (
                  <button onClick={() => setImprimirPedido(p)}
                    title="Lista de picking imprimible (fallback si falla el escaneo)"
                    className="p-2 text-gray-400 hover:text-accent-text hover:bg-accent/10 rounded-lg transition-colors">
                    <Printer size={15} />
                  </button>
                )}
                {['en_preparacion', 'listo_para_entrega', 'entregado_parcial'].includes(p.estado) && puedeYo('entregar') && (
                  <button onClick={() => abrirEntrega(p)}
                    title="Genera la venta real: rebaja el stock reservado y asienta el cobro en caja"
                    className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">
                    <Truck size={13} /> Entregar
                  </button>
                )}
                {p.estado === 'entregado_parcial' && (
                  <button onClick={() => cerrarPedido.mutate(p)} disabled={cerrarPedido.isPending}
                    title="Cierra el pedido si ya se entregó el 100% de las líneas"
                    className="text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
                    Cerrar pedido
                  </button>
                )}
                {p.estado === 'en_preparacion' && puedeYo('deslanzar') && (
                  <button onClick={() => { if (confirm(`¿Deshacer el lanzamiento del pedido #${p.numero}? Se liberan las reservas de stock (solo si nada se pickeó todavía).`)) deslanzarPedido.mutate(p) }}
                    disabled={deslanzarPedido.isPending}
                    title="Vuelve a Confirmado y libera lo reservado — solo si ninguna tarea se completó todavía"
                    className="text-xs font-semibold text-amber-600 border border-amber-300 dark:border-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50">
                    Deshacer lanzamiento
                  </button>
                )}
                {/* A5: si el pedido ya generó una venta ACTIVA, fn_cancelar_pedido bloquea con un
                    mensaje claro — hay que devolverla primero desde Ventas → Historial (link en
                    el detalle expandido, abajo). Una vez devuelta/cancelada, esto sí cancela. */}
                {p.estado !== 'cancelado' && puedeYo('cancelar') && (
                  <button
                    onClick={() => { if (confirm(`¿Cancelar el pedido #${p.numero}?${p.lanzado_at ? ' Se liberan las reservas de stock (solo si nada se pickeó todavía).' : ''}`)) cancelarPedido.mutate(p) }}
                    disabled={cancelarPedido.isPending}
                    className="text-xs text-red-500 hover:text-red-600 px-2 py-1.5 disabled:opacity-50">
                    Cancelar
                  </button>
                )}
              </div>
              {isExp && (
                <div className="px-5 pb-4 space-y-1.5">
                  {(p.pedido_items ?? []).map((it: any) => (
                    <div key={it.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 flex-wrap">
                      <span className="font-medium">{it.productos?.nombre}</span>
                      <span className="text-gray-400">{it.productos?.sku}</span>
                      <span>· {Number(it.cantidad)} {it.productos?.unidad_medida ?? 'u'}</span>
                      {Number(it.cantidad_entregada ?? 0) > 0 && (
                        <span className={Number(it.cantidad_entregada) >= Number(it.cantidad) ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                          ({Number(it.cantidad_entregada)} entregado{Number(it.cantidad_entregada) >= Number(it.cantidad) ? '' : ` — faltan ${Number(it.cantidad) - Number(it.cantidad_entregada)}`})
                        </span>
                      )}
                      {[it.talle, it.color, it.encaje, it.formato, it.sabor_aroma].filter(Boolean).length > 0 && (
                        <span className="text-gray-400">({[it.talle, it.color, it.encaje, it.formato, it.sabor_aroma].filter(Boolean).join(' · ')})</span>
                      )}
                    </div>
                  ))}
                  {p.notas && <p className="text-xs text-gray-400 italic pt-1">{p.notas}</p>}
                  {(ventasPedidoExp as any[]).length > 0 && (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-2 space-y-1">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Ventas generadas</p>
                      {(ventasPedidoExp as any[]).map(v => (
                        <div key={v.id} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Venta #{v.numero} · {v.estado} · ${Number(v.total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          {!['devuelta', 'cancelada'].includes(v.estado) && (
                            <button onClick={() => navigate(`/ventas?id=${v.id}&devolver=1`)}
                              className="text-accent-text underline ml-auto">
                              Devolver esta venta
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {p.lanzado_at && (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-2 space-y-1">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Tareas de Depósito</p>
                      {tareasPedidoExp.length === 0 ? (
                        <p className="text-xs text-gray-400">Cargando…</p>
                      ) : (tareasPedidoExp as any[]).map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                            t.estado === 'completada' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : t.estado === 'cancelada' ? 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                            {t.tipo === 'replenishment' ? 'Reabastecimiento' : 'Picking'} · {t.estado}
                          </span>
                          <span>{t.productos?.nombre} ({Number(t.cantidad)})</span>
                          {/* Mig 300: fn_unpick_tarea_wms ya soporta tareas encadenadas a un
                              reabastecimiento (fallback por producto+ubicación cuando el LPN
                              exacto ya no existe ahí) — "Deshacer" ya no se oculta para esas. */}
                          {t.tipo === 'picking' && t.estado === 'completada' && puedeYo('deslanzar') && (
                            <button onClick={() => setUnpickModal(t)}
                              className="text-red-500 hover:text-red-600 underline ml-auto">
                              Deshacer
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal nuevo pedido */}
      {showNuevo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2"><Package size={18} className="text-accent-text" /> Nuevo pedido</h2>
              <button onClick={() => { setShowNuevo(false); resetForm() }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de pedido *</label>
                  <select value={tipoPedidoId} onChange={e => setTipoPedidoId(e.target.value)} className={inputCls}>
                    <option value="">Elegir…</option>
                    {(tiposPedido as any[]).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de entrega solicitada</label>
                  <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Cliente */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Cliente {tipoSel?.cliente_obligatorio ? '*' : '(opcional)'}
                </label>
                {clienteId ? (
                  <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm">
                    <User size={14} className="text-gray-400" />
                    <span className="flex-1">{(clientesBusqueda as any[]).find(c => c.id === clienteId)?.nombre ?? clienteNombre}</span>
                    <button onClick={() => { setClienteId(''); setClienteSearch('') }} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={clienteSearch}
                        onChange={e => { setClienteSearch(e.target.value); setClienteNombre(e.target.value) }}
                        onFocus={() => setClienteDropOpen(true)}
                        onBlur={() => setTimeout(() => setClienteDropOpen(false), 150)}
                        placeholder="Buscar cliente existente, o escribir nombre suelto…" className={`${inputCls} pl-9`} />
                    </div>
                    {clienteDropOpen && clienteSearch.trim() && (clientesBusqueda as any[]).length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {(clientesBusqueda as any[]).map(c => (
                          <button key={c.id} type="button" onClick={() => { setClienteId(c.id); setClienteDropOpen(false) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between">
                            <span>{c.nombre}</span><span className="text-xs text-gray-400">{c.telefono}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {clienteSearch.trim() && (
                      <input value={clienteTelefono} onChange={e => setClienteTelefono(e.target.value)}
                        placeholder="Teléfono (si es cliente nuevo/suelto)" className={`${inputCls} mt-2`} />
                    )}
                  </>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={requiereEnvio} onChange={e => setRequiereEnvio(e.target.checked)} className="rounded" />
                Requiere envío (si no, es retiro en local — no se toca el módulo Envíos)
              </label>

              {/* Buscador de productos */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Agregar productos</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                    placeholder="Buscar producto por nombre o SKU…" className={`${inputCls} pl-9`} />
                </div>
                {prodSearch.trim().length >= 2 && (
                  <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700 max-h-44 overflow-y-auto">
                    {(productosBusqueda as any[]).length === 0 ? (
                      <p className="p-3 text-xs text-gray-400">Sin resultados</p>
                    ) : (productosBusqueda as any[]).map(p => (
                      <button key={p.id} onClick={() => agregarItem(p)}
                        className="w-full p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2">
                        <span className="font-medium text-primary dark:text-white">{p.nombre}</span>
                        <span className="text-gray-400 ml-auto">{p.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Líneas agregadas */}
              {items.length > 0 && (
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={it.producto.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="font-medium text-primary dark:text-white">{it.producto.nombre}</span>
                        <span className="text-xs text-gray-400">{it.producto.sku}</span>
                        <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                          className="ml-auto text-gray-400 hover:text-red-500"><X size={14} /></button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="number" min="0" step="0.01" value={it.cantidad}
                          onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, cantidad: e.target.value } : x))}
                          onWheel={e => e.currentTarget.blur()}
                          className={`${inputCls} max-w-[100px]`} />
                        <span className="text-xs text-gray-400">{it.producto.unidad_medida ?? 'u'}</span>
                        {estadosInventario.length > 0 && (
                          <select value={it.estadoId} onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, estadoId: e.target.value } : x))}
                            className={`${inputCls} max-w-[160px]`}>
                            <option value="">Estado (cualquiera)</option>
                            {(estadosInventario as any[]).map(es => <option key={es.id} value={es.id}>{es.nombre}</option>)}
                          </select>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input placeholder="Talle" value={it.talle} onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, talle: e.target.value } : x))} className={`${inputCls} text-xs`} />
                        <input placeholder="Color" value={it.color} onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, color: e.target.value } : x))} className={`${inputCls} text-xs`} />
                        <input placeholder="Otro atributo" value={it.formato} onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, formato: e.target.value } : x))} className={`${inputCls} text-xs`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
                <input value={notasCab} onChange={e => setNotasCab(e.target.value)} placeholder="Referencia, preferencias del cliente…" className={inputCls} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => { setShowNuevo(false); resetForm() }}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => crearPedido.mutate()} disabled={crearPedido.isPending || !items.length || !tipoPedidoId}
                className="bg-accent text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-accent/90 transition-colors">
                {crearPedido.isPending ? 'Guardando…' : 'Guardar borrador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal entregar (PED4): genera la venta real */}
      {entregaModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2">
                <Truck size={18} className="text-accent-text" /> Entregar Pedido #{entregaModal.numero}
              </h2>
              <button onClick={() => setEntregaModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Esto genera la venta real (rebaja el stock reservado, asienta el cobro en caja). La factura
                se emite después, desde Ventas → Historial, igual que cualquier otra venta.
              </p>
              <div className="space-y-2">
                {(entregaModal.pedido_items ?? []).filter((it: any) => it.estado !== 'cancelada').map((it: any) => {
                  const pendiente = Number(it.cantidad) - Number(it.cantidad_entregada ?? 0)
                  if (pendiente <= 0) return null
                  return (
                    <div key={it.id} className="flex items-center gap-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl p-2.5">
                      <span className="flex-1 truncate">{it.productos?.nombre} <span className="text-xs text-gray-400">({pendiente} pendiente{pendiente !== 1 ? 's' : ''})</span></span>
                      <input type="number" min="0" max={pendiente} step="0.01"
                        value={entregaCantidades[it.id] ?? ''}
                        onChange={e => setEntregaCantidades(prev => ({ ...prev, [it.id]: e.target.value }))}
                        onWheel={e => e.currentTarget.blur()}
                        className={`${inputCls} max-w-[90px]`} />
                    </div>
                  )
                })}
              </div>
              {(sesionesAbiertas as any[]).length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Caja</label>
                  <select value={entregaSesionId} onChange={e => setEntregaSesionId(e.target.value)} className={inputCls}>
                    <option value="">Elegir caja abierta…</option>
                    {(sesionesAbiertas as any[]).map(s => <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>)}
                  </select>
                </div>
              )}
              {(sesionesAbiertas as any[]).length === 0 && (
                <p className="text-xs text-red-500">No hay ninguna caja abierta — abrí una caja antes de entregar.</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Medio de pago</label>
                <select value={entregaMedioPago} onChange={e => setEntregaMedioPago(e.target.value)} className={inputCls}>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Tarjeta de débito">Tarjeta de débito</option>
                  <option value="Tarjeta de crédito">Tarjeta de crédito</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Mercado Pago">Mercado Pago</option>
                  {entregaModal.cliente_id && <option value="Cuenta Corriente">Cuenta Corriente</option>}
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setEntregaModal(null)}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => generarVenta.mutate()} disabled={generarVenta.isPending}
                className="bg-green-600 text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-green-700 transition-colors">
                {generarVenta.isPending ? 'Generando…' : 'Generar venta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal des-pickeo (PED5): deshacer una tarea de picking completada */}
      {unpickModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white">Deshacer picking</h2>
              <button onClick={() => setUnpickModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Libera la reserva de stock de este ítem y reubica el LPN en otra ubicación (el operador
                ya lo había retirado físicamente). Elegí dónde queda ese LPN ahora.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ubicación destino</label>
                <select value={unpickUbicacionId} onChange={e => setUnpickUbicacionId(e.target.value)} className={inputCls}>
                  <option value="">Elegir ubicación…</option>
                  {(ubicacionesDestino as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setUnpickModal(null)}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => unpickTarea.mutate()} disabled={unpickTarea.isPending || !unpickUbicacionId}
                className="bg-red-500 text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-red-600 transition-colors">
                {unpickTarea.isPending ? 'Deshaciendo…' : 'Deshacer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal lanzar bolsa (PED6) */}
      {bolsaModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-primary dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-accent-text" /> Lanzar bolsa de pedidos
              </h2>
              <button onClick={() => setBolsaModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Se van a lanzar {bolsaSeleccion.size} pedido(s) juntos — cada uno reserva su stock y genera
                sus propias tareas de picking, agrupadas bajo la misma ubicación de convergencia.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ubicación de staging</label>
                <select value={bolsaUbicacionId} onChange={e => setBolsaUbicacionId(e.target.value)} className={inputCls}>
                  <option value="">Elegir ubicación…</option>
                  {(ubicacionesStaging as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
                {(ubicacionesStaging as any[]).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No hay ninguna ubicación tipo "staging" configurada — creá una en Inventario → Ubicaciones.</p>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setBolsaModalOpen(false)}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => lanzarBolsa.mutate()} disabled={lanzarBolsa.isPending || !bolsaUbicacionId}
                className="bg-accent text-white font-semibold px-5 py-2 rounded-xl text-sm disabled:opacity-50 hover:bg-accent/90 transition-colors">
                {lanzarBolsa.isPending ? 'Lanzando…' : 'Lanzar bolsa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal lista de picking imprimible (PED6, L2-2) */}
      {imprimirPedido && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700 no-print">
              <h2 className="text-lg font-bold text-primary dark:text-white">Lista de picking — Pedido #{imprimirPedido.numero}</h2>
              <button onClick={() => setImprimirPedido(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div id="pedido-lista-print" className="p-5 overflow-y-auto flex-1">
              <div className="mb-3">
                <p className="font-semibold text-primary dark:text-white">Pedido #{imprimirPedido.numero}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {imprimirPedido.clientes?.nombre ?? imprimirPedido.cliente_nombre ?? 'Sin cliente'}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1.5 pr-2">Producto</th>
                    <th className="py-1.5 pr-2">Cant.</th>
                    <th className="py-1.5 pr-2">LPN</th>
                    <th className="py-1.5 pr-2">Desde</th>
                    <th className="py-1.5">Hacia</th>
                  </tr>
                </thead>
                <tbody>
                  {(tareasImprimir as any[]).map(t => (
                    <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="py-1.5 pr-2">{t.productos?.nombre} <span className="text-xs text-gray-400">{t.productos?.sku}</span></td>
                      <td className="py-1.5 pr-2">{Number(t.cantidad)}</td>
                      <td className="py-1.5 pr-2 text-xs">{t.lpn_origen ?? '—'}</td>
                      <td className="py-1.5 pr-2">{t.ubicacion_origen?.nombre ?? '—'}</td>
                      <td className="py-1.5">{t.tipo === 'replenishment' ? t.ubicacion_destino?.nombre ?? '—' : '(retirar)'}</td>
                    </tr>
                  ))}
                  {(tareasImprimir as any[]).length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-gray-400">Sin tareas todavía</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 no-print">
              <button onClick={() => setImprimirPedido(null)}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cerrar</button>
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 bg-accent text-white font-semibold px-5 py-2 rounded-xl text-sm hover:bg-accent/90 transition-colors">
                <Printer size={15} /> Imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
