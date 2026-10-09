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
import { useState, useMemo, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, X, Search, ChevronDown, Package, User, Truck, CalendarClock, Rocket, Layers, Printer, Download, ScanBarcode, ClipboardList, CheckCircle2, UserCog, Store, Undo2, XCircle, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { descargarCsv, descargarExcel, nombreConFecha } from '@/lib/exportarArchivo'
// xlsx/jspdf/jspdf-autotable se importan dinámicamente en exportarExcel/exportarPDF
// (auditoría perf 2026-08-14, P5).
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { logActividad } from '@/lib/actividadLog'
import { BRAND } from '@/config/brand'
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu'
import { ESTADO_BADGE } from '@/lib/pedidoEstados'
import { cantidadConUnidad } from '@/lib/cantidadUnidad'
import { PageTabs } from '@/components/PageTabs'
import { BuscadorPildoras, pildoraConCampoNuevo } from '@/components/BuscadorPildoras'
import {
  CAMPOS_FILTRO_PEDIDOS, parsearPildora, evaluarPildorasPedido, type PildoraPedido, type CampoPedido,
} from '@/lib/pedidosFiltro'
import { puedeTransicionPedido, type PedidoTransicion, type PedidoTransicionesConfig } from '@/lib/pedidoTransiciones'
import { motivoNoLanzarPedido } from '@/lib/pedidoVenta'
import { breadcrumbUbicacion } from '@/lib/ubicacionesArbol'
import { esDecimal, hoyLocalISO } from '@/lib/ventasValidation'
import { urgenciaEntrega, ordenarPorEntrega, fechaEntregaLegible } from '@/lib/pedidoPrioridad'
import { useConfirm } from '@/hooks/useConfirm'
import { SupervisionPanel } from '@/components/SupervisionPanel'
import { useSupervisorAutorizaciones, useSupervisionBadge, avisarSupervisor, type EstadoAutorizacion } from '@/hooks/useSupervisorAutorizaciones'
import { puedeSupervisarModulo } from '@/lib/permisosModulo'
import { imprimirConNombre } from '@/lib/imprimirConNombre'

// Columnas de la fila en pantallas anchas: casilla · pedido · cliente · entrega · estado · acciones.
// En angosto la fila se reacomoda como tarjeta (ver las clases row-/col- de cada celda).
const GRILLA_PEDIDO = 'lg:grid-cols-[1.75rem_minmax(8rem,0.8fr)_minmax(12rem,1.5fr)_minmax(10rem,1fr)_minmax(8.5rem,0.7fr)_15rem] lg:gap-x-4'

interface ItemDraft {
  producto: { id: string; nombre: string; sku: string; unidad_medida: string | null }
  cantidad: string
  estadoId: string
  talle: string; color: string; encaje: string; formato: string; saborAroma: string
}

export default function PedidosPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { tenant, user } = useAuthStore()
  const { sucursalId } = useSucursalFilter()
  const qc = useQueryClient()
  const confirmar = useConfirm()

  // "Ver en Envíos": abre Envíos filtrado EXACTO por el envío de este pedido (por id, no por texto). El envío se busca por
  // el pedido o, si nació de la venta, por la venta de origen; con varios, el más reciente.
  const irAEnvioDelPedido = async (p: any) => {
    const filtro = p.venta_origen_id ? `pedido_id.eq.${p.id},venta_id.eq.${p.venta_origen_id}` : `pedido_id.eq.${p.id}`
    const { data } = await supabase.from('envios').select('id').eq('tenant_id', tenant!.id).or(filtro)
      .order('created_at', { ascending: false }).limit(1)
    const envioId = data?.[0]?.id
    if (!envioId) { toast('Este pedido todavía no tiene un envío creado.', { icon: 'ℹ️' }); navigate('/envios'); return }
    navigate(`/envios?envio=${envioId}`)
  }

  // E3 — gate client-side por transición (config Pedidos → tabla de roles), mismo criterio que
  // ajuste_autorizacion_roles (mig 228): filtra qué botón se muestra, no reemplaza los guards
  // server-side de cada RPC (stock/caja/CC/idempotencia — esos SÍ corren siempre, para
  // cualquier rol). Ver src/lib/pedidoTransiciones.ts.
  const puedeYo = (transicion: PedidoTransicion) =>
    puedeTransicionPedido(user?.rol, transicion, ((tenant as any)?.pedido_transiciones_roles ?? null) as PedidoTransicionesConfig)

  // La cola de tareas de Depósito ("Tareas WMS") se mudó a Picking → Tareas (pedido de GO 2026-10-08).
  const [tab, setTab] = useState<'pedidos' | 'autorizaciones'>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return t === 'autorizaciones' ? 'autorizaciones' : 'pedidos'
  })

  const [showNuevo, setShowNuevo] = useState(false)
  const [tipoPedidoId, setTipoPedidoId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteDropOpen, setClienteDropOpen] = useState(false)
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [referencia, setReferencia] = useState('')
  const [requiereEnvio, setRequiereEnvio] = useState(false)
  // Mig 485: el cliente acepta entregas parciales (default del negocio; se puede cambiar al entregar).
  const parcialDefaultNegocio = !!(tenant as any)?.pedido_entrega_parcial_default
  const [aceptaParcial, setAceptaParcial] = useState(parcialDefaultNegocio)
  const [notasCab, setNotasCab] = useState('')
  const [prodSearch, setProdSearch] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Deep-link desde AlertasPage — ?estado= pre-filtra el estado (ej. "en_preparacion" para
  // "sin avanzar"); mismo patrón que Ventas/Envíos con `busqueda`. GO, 2026-08-12: antes estos
  // links caían siempre en /pedidos a secas, sin filtrar nada.
  const [filtroEstado, setFiltroEstado] = useState(() => searchParams.get('estado') ?? '')
  // Buscador por píldoras (mismo mecanismo que /picking, /productos e /inventario — GO 2026-08-12:
  // el buscador de texto plano hacía substring sobre N°/referencia/cliente a la vez, así que
  // buscar el pedido "2" también traía el 82, el 102... `?busqueda=` (deep-link desde Ventas/
  // Envíos/Alertas, mismo patrón que EnviosPage) puede venir como pildora estructurada
  // ("Pedido:2", exacta) o como texto suelto (libre, fuzzy).
  const [pildoras, setPildoras] = useState<PildoraPedido[]>(() => {
    const raw = searchParams.get('busqueda')
    if (!raw) return []
    const parsed = parsearPildora(raw)
    return parsed ? [parsed] : []
  })
  const [entrada, setEntrada] = useState(() => {
    const raw = searchParams.get('busqueda')
    if (!raw) return ''
    return parsearPildora(raw) ? '' : raw
  })
  const [combinador, setCombinador] = useState<'Y' | 'O'>('Y')
  // Deep-link desde AlertasPage: "Pedidos con entrega vencida" (?vencidos=1) replica exactamente
  // el criterio de la alerta (fecha_entrega_solicitada < hoy, no entregado/cancelado) — no hay un
  // único `estado` que lo represente, así que es un flag aparte en vez de un valor de filtroEstado.
  const [soloVencidos, setSoloVencidos] = useState(() => searchParams.get('vencidos') === '1')
  // Orden de la lista (GO 2026-10-02): por fecha de entrega para que preparación sepa qué va primero.
  const [ordenPedidos, setOrdenPedidos] = useState<'entrega' | 'recientes'>(() => {
    try { return localStorage.getItem('pedidos-orden') === 'recientes' ? 'recientes' : 'entrega' } catch { return 'entrega' }
  })

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
        .select('*, tipos_pedido(nombre), clientes(nombre), pedido_items(*, productos(nombre, sku, unidad_medida)), ventas:venta_origen_id(estado), envios(rango_horario_desde, rango_horario_hasta)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (sucursalId) q = q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Lo que se está tipeando filtra en vivo igual que las píldoras ya confirmadas (mismo criterio
  // que /picking) — si matchea "Campo:valor" se evalúa exacto a ese campo, si no como libre/fuzzy.
  const entradaTrim = entrada.trim()
  const pildoraDeEntrada: PildoraPedido | null = entradaTrim
    ? (parsearPildora(entradaTrim) ?? { id: '__entrada__', campo: 'libre', operador: 'contiene', valor: entradaTrim })
    : null
  const pildorasEfectivas = pildoraDeEntrada ? [...pildoras, pildoraDeEntrada] : pildoras

  // Día LOCAL: con toISOString, después de las 21 h de Argentina "hoy" ya era mañana y un pedido de hoy salía atrasado.
  const hoyStrPed = hoyLocalISO()
  const esVencido = (p: any) => !!p.fecha_entrega_solicitada && p.fecha_entrega_solicitada < hoyStrPed
    && !['entregado', 'cancelado'].includes(p.estado)
  // La búsqueda va primero: los contadores de los filtros de estado cuentan sobre lo buscado.
  const pedidosBuscados = (pedidos as any[])
    .filter(p => evaluarPildorasPedido(
      { numero: p.numero, referencia: p.referencia ?? null, clienteNombre: p.clientes?.nombre ?? p.cliente_nombre ?? null },
      pildorasEfectivas, combinador,
    ))
  const conteoEstados = pedidosBuscados.reduce<Record<string, number>>((acc, p) => {
    acc[p.estado] = (acc[p.estado] ?? 0) + 1
    return acc
  }, {})
  const conteoVencidos = pedidosBuscados.filter(esVencido).length
  const pedidosFiltradosSinOrden = pedidosBuscados
    .filter(p => !filtroEstado || p.estado === filtroEstado)
    .filter(p => !soloVencidos || esVencido(p))
  const pedidosFiltrados = ordenPedidos === 'entrega' ? ordenarPorEntrega(pedidosFiltradosSinOrden) : pedidosFiltradosSinOrden

  // ── K3 (PED8): exportar Excel/PDF/CSV — una fila por línea de pedido, mismo criterio que
  // el resto de los módulos (XLSX.utils.json_to_sheet / jsPDF+autoTable / CSV a mano) ──────
  const filasExport = () => pedidosFiltrados.flatMap((p: any) => {
    const cliente = p.clientes?.nombre ?? p.cliente_nombre ?? 'Sin cliente'
    const items = (p.pedido_items ?? []).filter((it: any) => it.estado !== 'cancelada')
    if (items.length === 0) return [{
      Pedido: p.numero, Referencia: p.referencia ?? '', Tipo: p.tipos_pedido?.nombre ?? '', Cliente: cliente, Estado: ESTADO_BADGE[p.estado]?.label ?? p.estado,
      'Entrega solicitada': p.fecha_entrega_solicitada ? fechaEntregaLegible(p.fecha_entrega_solicitada) : '',
      Producto: '', SKU: '', Cantidad: '', Entregado: '',
    }]
    return items.map((it: any) => ({
      Pedido: p.numero, Referencia: p.referencia ?? '', Tipo: p.tipos_pedido?.nombre ?? '', Cliente: cliente, Estado: ESTADO_BADGE[p.estado]?.label ?? p.estado,
      'Entrega solicitada': p.fecha_entrega_solicitada ? fechaEntregaLegible(p.fecha_entrega_solicitada) : '',
      Producto: it.productos?.nombre ?? '', SKU: it.productos?.sku ?? '',
      Cantidad: Number(it.cantidad), Entregado: Number(it.cantidad_entregada ?? 0),
    }))
  })

  const exportarExcel = async () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    await descargarExcel({ nombre: 'Pedidos', filas }, nombreConFecha('pedidos'))
    toast.success('Excel descargado')
  }

  const exportarCSV = () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    descargarCsv(filas, nombreConFecha('pedidos'))
    toast.success('CSV descargado')
  }

  const exportarPDF = async () => {
    const filas = filasExport()
    if (filas.length === 0) { toast.error('No hay pedidos para exportar'); return }
    const cols = Object.keys(filas[0])
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable'),
    ])
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
    // Clave propia ('pedidos' al final): el POS usa ['caja-sesiones-abiertas', tenant, sucursal] con OTRO select (trae
    // la moneda); compartir la clave le servía al POS sesiones sin moneda y una caja USD pasaba por ARS.
    queryKey: ['caja-sesiones-abiertas', tenant?.id, sucursalId, 'pedidos'],
    queryFn: async () => {
      // Solo las cajas de la sucursal activa (GO 2026-10-08), igual que el POS.
      let q = supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre, es_caja_fuerte)')
        .eq('tenant_id', tenant!.id).eq('estado', 'abierta')
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
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

  // Refresca la cola de tareas (Picking → Tareas) y los pedidos después de lanzar/deslanzar/entregar.
  const invalidarWms = () => {
    qc.invalidateQueries({ queryKey: ['wms_tareas'] })
    qc.invalidateQueries({ queryKey: ['wms_tareas_pedidos'] })
    qc.invalidateQueries({ queryKey: ['pedidos'] })
  }

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
        .select('id, nombre, sku, unidad_medida, estado_id')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`nombre.ilike.%${prodSearch}%,sku.ilike.%${prodSearch}%`)
        .order('nombre').limit(20)
      return data ?? []
    },
    enabled: !!tenant && prodSearch.trim().length >= 2,
  })

  const agregarItem = (p: any) => {
    // Se permite repetir producto (caso legítimo: 3 "Nuevo" + 2 "Outlet" del mismo SKU) —
    // el guard real contra dos líneas IDÉNTICAS (mismo estado y atributos) corre al guardar.
    if (items.some(i => i.producto.id === p.id)) {
      toast('Ese producto ya está en el pedido — diferenciá la línea nueva por estado o atributos', { icon: 'ℹ️' })
    }
    // Estado precargado con el default del producto (productos.estado_id) solo si sigue activo
    // en el catálogo; si no tiene default (o quedó inactivo), va vacío y el guardado lo exige
    // cuando el tenant usa estados de inventario.
    const estadoDefault = (estadosInventario as any[]).some(es => es.id === p.estado_id) ? p.estado_id : ''
    setItems(prev => [...prev, { producto: p, cantidad: '1', estadoId: estadoDefault, talle: '', color: '', encaje: '', formato: '', saborAroma: '' }])
    setProdSearch('')
  }

  const resetForm = () => {
    setTipoPedidoId(''); setClienteId(''); setClienteNombre(''); setClienteTelefono(''); setClienteSearch('')
    setFechaEntrega(''); setReferencia(''); setRequiereEnvio(false); setAceptaParcial(parcialDefaultNegocio); setNotasCab(''); setItems([]); setProdSearch('')
  }

  // ── Crear pedido (borrador) ───────────────────────────────────────────────────
  const crearPedido = useMutation({
    mutationFn: async () => {
      if (!tipoPedidoId) throw new Error('Elegí el tipo de pedido')
      if (!items.length) throw new Error('Agregá al menos una línea')
      if (tipoSel?.cliente_obligatorio && !clienteId && !clienteNombre.trim())
        throw new Error('Este tipo de pedido requiere cliente identificado')
      if (!fechaEntrega) throw new Error('Elegí la fecha de entrega solicitada')
      for (const it of items) {
        const cant = parseFloat(it.cantidad.replace(',', '.'))
        if (!cant || cant <= 0) throw new Error(`Cantidad inválida en ${it.producto.nombre}`)
        // Enteras salvo UoM fraccionaria (kg/gr/lt/ml/…) — mismo criterio central que el POS
        // (esDecimal, ventasValidation.ts): cuando cambie el modelo de UoM, cambia solo ahí.
        if (!esDecimal(it.producto.unidad_medida) && !Number.isInteger(cant))
          throw new Error(`La cantidad de ${it.producto.nombre} debe ser entera (se mide en ${it.producto.unidad_medida ?? 'unidades'})`)
        // Estado obligatorio por línea cuando el tenant usa estados de inventario. Sin estados
        // definidos, la línea va sin estado (= "cualquiera" al reservar), como siempre.
        if (estadosInventario.length > 0 && !it.estadoId)
          throw new Error(`Elegí el estado de inventario en ${it.producto.nombre}`)
      }
      // Dos líneas 100% idénticas (mismo producto + estado + atributos) no tienen sentido —
      // repetir producto SÍ se permite mientras difieran en algo.
      const firma = (it: ItemDraft) =>
        [it.producto.id, it.estadoId, it.talle.trim(), it.color.trim(), it.encaje.trim(), it.formato.trim(), it.saborAroma.trim()].join('|')
      const firmas = items.map(firma)
      const dupIdx = firmas.findIndex((f, i) => firmas.indexOf(f) !== i)
      if (dupIdx >= 0)
        throw new Error(`Hay dos líneas idénticas de ${items[dupIdx].producto.nombre} — unificá la cantidad o diferencialas por estado/atributos`)

      // H2 del relevamiento: aviso NO bloqueante si el stock disponible de hoy no alcanza
      // (el bloqueo real sigue siendo al Lanzar, server-side). Best-effort: filtra por
      // sucursal del pedido y estado de la línea, no por atributos.
      let stockWarning: string | null = null
      {
        let q = supabase.from('inventario_lineas')
          .select('producto_id, estado_id, cantidad, cantidad_reservada')
          .eq('tenant_id', tenant!.id).eq('activo', true)
          .in('producto_id', [...new Set(items.map(it => it.producto.id))])
        if (sucursalId) q = q.eq('sucursal_id', sucursalId)
        const { data: lineasStock } = await q
        const faltantes: string[] = []
        for (const it of items) {
          const cant = parseFloat(it.cantidad.replace(',', '.'))
          const disponible = (lineasStock ?? [])
            .filter(l => l.producto_id === it.producto.id && (!it.estadoId || l.estado_id === it.estadoId))
            .reduce((acc, l) => acc + Number(l.cantidad) - Number(l.cantidad_reservada ?? 0), 0)
          if (cant > disponible) faltantes.push(`${it.producto.nombre} (pediste ${cant}, disponible ${disponible})`)
        }
        if (faltantes.length) stockWarning = faltantes.join(' · ')
      }

      const { data: cab, error: eCab } = await supabase.from('pedidos').insert({
        tenant_id: tenant!.id,
        sucursal_id: sucursalId ?? null,
        tipo_pedido_id: tipoPedidoId,
        cliente_id: clienteId || null,
        cliente_nombre: clienteId ? null : (clienteNombre.trim() || null),
        cliente_telefono: clienteId ? null : (clienteTelefono.trim() || null),
        fecha_entrega_solicitada: fechaEntrega || null,
        referencia: referencia.trim() || null,
        requiere_envio: requiereEnvio,
        acepta_entrega_parcial: aceptaParcial,
        notas: notasCab.trim() || null,
        creado_por: user?.id ?? null,
      }).select('id, numero').single()
      if (eCab) throw eCab

      const rows = items.map(it => ({
        tenant_id: tenant!.id,
        pedido_id: cab.id,
        producto_id: it.producto.id,
        cantidad: parseFloat(it.cantidad.replace(',', '.')),
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
      return { numero: cab.numero, stockWarning }
    },
    onSuccess: (d: any) => {
      toast.success(`Pedido #${d.numero} guardado como borrador`)
      if (d.stockWarning) toast(`⚠ Stock ajustado para hoy: ${d.stockWarning}. Se valida en firme al lanzar.`, { duration: 7000, icon: '📦' })
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
        venta_id: pedido.venta_origen_id ?? null,
      })
      return { numero: pedido.numero, nTareas: (data ?? []).length }
    },
    onSuccess: (d: any) => {
      toast.success(`Pedido #${d.numero} lanzado — ${d.nTareas} tarea(s) generada(s) en Picking`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      invalidarWms()
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

  // Se trae el árbol COMPLETO (no solo las de staging) para que `breadcrumbUbicacion` pueda
  // resolver los ancestros — filtrar solo en el SELECT hubiera dejado sin padre a cualquier
  // staging que cuelgue de un nivel no-staging, mostrando el breadcrumb incompleto.
  const { data: ubicacionesStagingRaw = [] } = useQuery({
    queryKey: ['ubicaciones-staging', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones')
        .select('id, nombre, padre_ubicacion_id, subtipo_almacenamiento').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && bolsaModalOpen,
  })
  const ubicacionesStagingPorId = useMemo(() => new Map((ubicacionesStagingRaw as any[]).map(u => [u.id, u])), [ubicacionesStagingRaw])
  const ubicacionesStaging = useMemo(() => (ubicacionesStagingRaw as any[]).filter(u => u.subtipo_almacenamiento === 'staging'), [ubicacionesStagingRaw])

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
          venta_id: p?.venta_origen_id ?? null,
        })
      }
      return { nPedidos: ids.length, nTareas: (data ?? []).length }
    },
    onSuccess: (d: any) => {
      toast.success(`Bolsa lanzada — ${d.nPedidos} pedido(s), ${d.nTareas} tarea(s) generada(s) en Picking`)
      setBolsaModalOpen(false); setBolsaUbicacionId(''); setBolsaSeleccion(new Set())
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      invalidarWms()
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
        .select('id, nombre, padre_ubicacion_id').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && !!unpickModal,
  })
  const ubicacionesDestinoPorId = useMemo(() => new Map((ubicacionesDestino as any[]).map(u => [u.id, u])), [ubicacionesDestino])

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
  const [entregaParcial, setEntregaParcial] = useState(false)
  const abrirEntrega = (pedido: any) => {
    const cants: Record<string, string> = {}
    for (const it of pedido.pedido_items ?? []) {
      if (it.estado === 'cancelada') continue
      const pendiente = Number(it.cantidad) - Number(it.cantidad_entregada ?? 0)
      if (pendiente > 0) cants[it.id] = String(pendiente)
    }
    setEntregaCantidades(cants)
    setEntregaParcial(pedido.acepta_entrega_parcial ?? parcialDefaultNegocio)
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
        // Mig 485: completa (default) o parcial (solo lo pickeado). El servidor lo controla igual.
        p_permitir_parcial: entregaParcial,
      })
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'crear', pagina: '/pedidos', tipo_transaccion: 'venta', venta_id: data as string,
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
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: pedido.estado, valor_nuevo: 'entregado', pagina: '/pedidos',
        venta_id: pedido.venta_origen_id ?? null,
      })
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
        venta_id: pedido.venta_origen_id ?? null,
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
  // A5 Nivel 1 (relevamiento Supervisión, Fede 2026-08-20) — cancelar un pedido ya NO se ejecuta
  // directo: queda pendiente de aprobación de un supervisor. La lógica real de negocio (liberar
  // reservas de stock, solo si nada se pickeó todavía) sigue viviendo 100% en el RPC
  // `fn_cancelar_pedido` — acá solo se difiere CUÁNDO se llama, nunca se reimplementa.
  const cancelarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { error } = await supabase.from('autorizaciones').insert({
        tenant_id: tenant!.id,
        modulo: 'pedidos',
        tipo: 'eliminar',
        datos_cambio: { pedido_id: pedido.id, pedido_numero: pedido.numero, venta_id: pedido.venta_origen_id ?? null },
        estado: 'pendiente',
        solicitado_por: user?.id,
      })
      if (error) throw error
      try {
        await avisarSupervisor(tenant!.id, 'pedidos', user?.id,
          'Cancelación de pedido pendiente de aprobar',
          `${user?.nombre_display ?? 'Un usuario'} pidió cancelar el pedido #${pedido.numero} — requiere tu aprobación.`,
          '/pedidos?tab=autorizaciones')
      } catch { /* la notificación no bloquea el flujo */ }
      return pedido.numero
    },
    onSuccess: (numero) => {
      toast.success(`Solicitud enviada — cancelación del pedido #${numero} pendiente de aprobación`)
      qc.invalidateQueries({ queryKey: ['autorizaciones', 'pedidos'] })
      qc.invalidateQueries({ queryKey: ['supervision-badge'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Deshacer lanzamiento (PED5, F5): vuelve a confirmado, libera reservas ───────────
  const deslanzarPedido = useMutation({
    mutationFn: async (pedido: any) => {
      const { error } = await supabase.rpc('fn_pedido_deslanzar', { p_pedido_id: pedido.id })
      if (error) throw error
      logActividad({
        entidad: 'pedido', entidad_id: pedido.id, entidad_nombre: `Pedido #${pedido.numero}`,
        accion: 'cambio_estado', campo: 'estado', valor_anterior: pedido.estado, valor_nuevo: 'confirmado', pagina: '/pedidos',
        venta_id: pedido.venta_origen_id ?? null,
      })
      return pedido.numero
    },
    onSuccess: (numero) => {
      toast.success(`Pedido #${numero} — lanzamiento deshecho, vuelve a Confirmado`)
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      invalidarWms()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Supervisión / Autorizaciones (lazy, quien tenga permiso 'supervisa' en pedidos) ──────────
  const puedeVerAutorizacionesPedidos = puedeSupervisarModulo(user, 'pedidos')
  const [autEstado, setAutEstado] = useState<EstadoAutorizacion>('pendiente')
  const [autRechazoId, setAutRechazoId] = useState<string | null>(null)
  const [autMotivoRechazo, setAutMotivoRechazo] = useState('')
  const [autAprobandoId, setAutAprobandoId] = useState<string | null>(null)
  const {
    autorizaciones, totalCount: autTotalCount, page: autPage, pageSize: autPageSize, setPage: setAutPage, setPageSize: setAutPageSize,
    isLoading: autLoading, isError: autError, marcarAprobada, rechazar: rechazarAutorizacionHook, reasignar: reasignarAutorizacionHook,
  } = useSupervisorAutorizaciones('pedidos', '', autEstado)
  const { count: autPendientesBadge } = useSupervisionBadge(puedeVerAutorizacionesPedidos ? ['pedidos'] : [])

  const resumenDeAutorizacionPedido = (aut: any) => `Cancelar pedido — #${aut.datos_cambio?.pedido_numero ?? '—'}`

  const aprobarAutorizacionPedido = async (aut: any) => {
    setAutAprobandoId(aut.id)
    try {
      const { pedido_id, pedido_numero } = aut.datos_cambio ?? {}
      const { error } = await supabase.rpc('fn_cancelar_pedido', { p_pedido_id: pedido_id })
      if (error) throw error
      await marcarAprobada(aut.id)
      logActividad({ entidad: 'pedido', entidad_id: pedido_id, entidad_nombre: `Pedido #${pedido_numero ?? ''}`, accion: 'aprobar', campo: 'estado', valor_nuevo: 'cancelado', pagina: '/pedidos' })
      toast.success('Cancelación aprobada y ejecutada')
      qc.invalidateQueries({ queryKey: ['pedidos'] })
      invalidarWms()
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo aprobar')
    } finally {
      setAutAprobandoId(null)
    }
  }

  const rechazarAutorizacionPedido = async (id: string, motivo: string, entidadNombre: string) => {
    try {
      await rechazarAutorizacionHook(id, motivo, entidadNombre)
      toast.success('Solicitud rechazada')
      setAutRechazoId(null); setAutMotivoRechazo('')
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo rechazar')
    }
  }

  const reasignarAutorizacionPedido = async (id: string, usuarioId: string | null, usuarioNombre: string | null, entidadNombre: string) => {
    try {
      await reasignarAutorizacionHook(id, usuarioId, usuarioNombre, entidadNombre)
      toast.success(usuarioId ? 'Solicitud reasignada' : 'Solicitud sin asignar')
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo reasignar')
    }
  }

  // ── Acciones por fila: UN botón con el próximo paso según el estado; el resto (incluido
  // cancelar) va al menú "⋯". Mismas reglas y guards que antes, solo reordenadas.
  const accionesPedido = (p: any): { principal: ReactNode; menu: ActionMenuItem[]; nota: { corta: string; detalle: string } | null } => {
    const motivoBloqueo = p.estado === 'confirmado' ? motivoNoLanzarPedido(p.ventas?.estado) : null
    const nota = motivoBloqueo ? {
      corta: p.ventas?.estado === 'pendiente' ? 'Venta en presupuesto'
        : ['despachada', 'facturada'].includes(p.ventas?.estado) ? 'Venta ya despachada'
        : `Venta ${p.ventas?.estado}`,
      detalle: motivoBloqueo,
    } : null
    // "Entregar" acá GENERA la venta real. Un pedido nacido de una venta ya la tiene, así que ese
    // camino está bloqueado server-side (mig 316): se entrega desde Ventas → Pedidos o Envíos.
    const puedeEntregarAca = ['en_preparacion', 'listo_para_entrega', 'entregado_parcial'].includes(p.estado) && puedeYo('entregar') && !p.venta_origen_id
    const linkEntrega = p.venta_origen_id && !['entregado', 'cancelado'].includes(p.estado)
      ? (p.requiere_envio
        ? { label: 'Ver en Envíos', corto: 'Ver en Envíos', icon: Truck, ir: () => irAEnvioDelPedido(p), title: 'Este pedido sale por envío: se despacha desde el módulo Envíos' }
        : { label: 'Entregar en mostrador', corto: 'Entregar', icon: Store, ir: () => navigate('/ventas?tab=pedidos'), title: 'Este pedido ya tiene su venta: lo entrega el mostrador desde Ventas → Pedidos' })
      : null
    const irAPicking = () => navigate(`/picking?busqueda=${encodeURIComponent(`Pedido:${p.numero}`)}`)
    const verPicking = ['en_preparacion', 'listo_para_entrega'].includes(p.estado)

    const btnHacer = 'flex items-center justify-center gap-1.5 w-36 whitespace-nowrap text-sm font-semibold bg-accent text-white px-3.5 py-2 rounded-lg hover:bg-accent/90 transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50'
    const btnIr = 'flex items-center justify-center gap-1.5 w-36 whitespace-nowrap text-sm font-medium text-accent-text border border-accent-text/30 px-3.5 py-2 rounded-lg hover:bg-accent/10 transition-[background-color,transform] duration-150 active:scale-[0.97]'

    let principal: ReactNode = null
    let usado: 'confirmar' | 'lanzar' | 'picking' | 'entregar' | 'link' | null = null
    if (p.estado === 'borrador' && puedeYo('confirmar')) {
      usado = 'confirmar'
      principal = (
        <button onClick={() => cambiarEstado.mutate({ pedido: p, nuevoEstado: 'confirmado' })} disabled={cambiarEstado.isPending} className={btnHacer}>
          <CheckCircle2 size={14} /> Confirmar
        </button>
      )
    } else if (p.estado === 'confirmado' && puedeYo('lanzar') && !motivoBloqueo) {
      usado = 'lanzar'
      principal = (
        <button onClick={() => lanzarPedido.mutate(p)} disabled={lanzarPedido.isPending}
          title="Genera las tareas de picking/reabastecimiento en Depósito y reserva el stock" className={btnHacer}>
          <Rocket size={14} /> {lanzarPedido.isPending ? 'Lanzando…' : 'Lanzar'}
        </button>
      )
    } else if (p.estado === 'en_preparacion') {
      usado = 'picking'
      principal = <button onClick={irAPicking} className={btnIr}><ScanBarcode size={14} /> Ver en Picking</button>
    } else if (puedeEntregarAca) {
      usado = 'entregar'
      principal = (
        <button onClick={() => abrirEntrega(p)} title="Genera la venta real: rebaja el stock reservado y asienta el cobro en caja" className={btnHacer}>
          <Truck size={14} /> Entregar
        </button>
      )
    } else if (linkEntrega) {
      usado = 'link'
      const Icono = linkEntrega.icon
      principal = <button onClick={linkEntrega.ir} title={linkEntrega.title} className={btnIr}><Icono size={14} /> {linkEntrega.corto}</button>
    }

    const menu: ActionMenuItem[] = [
      { label: 'Ver en Picking', icon: ScanBarcode, onClick: irAPicking, hidden: !verPicking || usado === 'picking' },
      { label: 'Entregar', icon: Truck, onClick: () => abrirEntrega(p), hidden: !puedeEntregarAca || usado === 'entregar' },
      { label: linkEntrega?.label ?? '', icon: linkEntrega?.icon, onClick: () => linkEntrega?.ir(), hidden: !linkEntrega || usado === 'link' },
      { label: 'Imprimir lista de picking', icon: Printer, onClick: () => setImprimirPedido(p), hidden: !p.lanzado_at },
      { label: 'Cerrar pedido', icon: CheckCircle2, onClick: () => cerrarPedido.mutate(p), disabled: cerrarPedido.isPending, hidden: p.estado !== 'entregado_parcial' },
      {
        label: 'Deshacer lanzamiento', icon: Undo2, danger: true, disabled: deslanzarPedido.isPending,
        hidden: !(p.estado === 'en_preparacion' && puedeYo('deslanzar')),
        onClick: async () => { if (await confirmar(`¿Deshacer el lanzamiento del pedido #${p.numero}? Se liberan las reservas de stock (solo si nada se pickeó todavía).`, { danger: true })) deslanzarPedido.mutate(p) },
      },
      // A5: si el pedido ya generó una venta ACTIVA, fn_cancelar_pedido bloquea con un mensaje claro;
      // hay que devolverla primero desde Ventas → Historial (link en el detalle expandido).
      {
        label: 'Cancelar pedido', icon: XCircle, danger: true, disabled: cancelarPedido.isPending,
        hidden: !(p.estado !== 'cancelado' && puedeYo('cancelar')),
        onClick: async () => { if (await confirmar(`¿Cancelar el pedido #${p.numero}?${p.lanzado_at ? ' Se liberan las reservas de stock (solo si nada se pickeó todavía).' : ''}`, { danger: true })) cancelarPedido.mutate(p) },
      },
    ]
    return { principal, menu: menu.filter(i => !i.hidden), nota }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inventario')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-primary">Pedidos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Preparación y despacho. Los pedidos los genera la venta; acá se pickean, se arman y se entregan.</p>
        </div>
        {/* Crear un pedido a mano es opt-in (mig 317): el pedido nace de una venta, que además le
            calcula bien el precio. Se prende en Config → Pedidos para el caso que solo resuelve
            este módulo: mayorista con entregas parciales. */}
        {((tenant as any)?.pedido_manual_habilitado ?? false) && (
          <button onClick={() => setShowNuevo(true)}
            className="flex items-center gap-1.5 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-accent/90 transition-colors flex-shrink-0">
            <Plus size={15} /> Nuevo pedido
          </button>
        )}
      </div>

      {puedeVerAutorizacionesPedidos && (
        <PageTabs
          tabs={[
            { id: 'pedidos', label: 'Pedidos', icon: Package },
            ...(puedeVerAutorizacionesPedidos ? [{ id: 'autorizaciones', label: 'Autorizaciones', icon: UserCog, badge: autPendientesBadge }] : []),
          ]}
          active={tab}
          onChange={(id) => setTab(id as 'pedidos' | 'autorizaciones')}
        />
      )}

      {/* ═══════════════ TAB AUTORIZACIONES (Supervisión) ═══════════════ */}
      {tab === 'autorizaciones' && puedeVerAutorizacionesPedidos && (
        <SupervisionPanel
          modulo="pedidos"
          autEstado={autEstado}
          onEstadoChange={setAutEstado}
          autorizaciones={autorizaciones as any[]}
          isLoading={autLoading}
          onReasignar={reasignarAutorizacionPedido}
          resumenDe={resumenDeAutorizacionPedido}
          totalCount={autTotalCount}
          page={autPage}
          pageSize={autPageSize}
          setPage={setAutPage}
          setPageSize={setAutPageSize}
        >
          {autLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : autError ? (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-12 text-center text-red-500 dark:text-red-400">
              <p>No se pudieron cargar las solicitudes — probá recargar la página</p>
            </div>
          ) : autorizaciones.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500">
              <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
              <p>No hay solicitudes {autEstado === 'pendiente' ? 'pendientes' : autEstado === 'aprobada' ? 'aprobadas' : 'rechazadas'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(autorizaciones as any[]).map(aut => (
                <div key={aut.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Cancelar pedido</span>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">#{aut.datos_cambio?.pedido_numero ?? '—'}</span>
                      </div>
                      <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                        <p>Solicitado por: {aut.solicitante?.nombre_display ?? '—'} · {new Date(aut.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                        {aut.motivo_rechazo && <p className="text-red-500">Motivo rechazo: {aut.motivo_rechazo}</p>}
                      </div>
                    </div>
                    {autEstado === 'pendiente' && (
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={async () => { if (await confirmar(`¿Aprobar la cancelación del pedido #${aut.datos_cambio?.pedido_numero}? Se liberan las reservas de stock (solo si nada se pickeó todavía).`, { danger: true })) aprobarAutorizacionPedido(aut) }}
                          disabled={autAprobandoId === aut.id}
                          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
                          <CheckCircle2 size={13} /> Aprobar
                        </button>
                        {autRechazoId === aut.id ? (
                          <div className="space-y-1.5">
                            <input type="text" value={autMotivoRechazo} onChange={e => setAutMotivoRechazo(e.target.value)}
                              placeholder="Motivo de rechazo..."
                              className="w-44 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs focus:outline-none focus:border-accent-text bg-white dark:bg-gray-800" />
                            <div className="flex gap-1">
                              <button onClick={() => rechazarAutorizacionPedido(aut.id, autMotivoRechazo, resumenDeAutorizacionPedido(aut))}
                                disabled={!autMotivoRechazo.trim()}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-2 py-1.5 rounded-lg disabled:opacity-50">
                                Confirmar
                              </button>
                              <button onClick={() => { setAutRechazoId(null); setAutMotivoRechazo('') }}
                                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setAutRechazoId(aut.id)}
                            className="flex items-center gap-1.5 border border-red-300 text-red-600 dark:text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                            <X size={13} /> Rechazar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SupervisionPanel>
      )}

      {tab === 'pedidos' && (
      <>
      {/* Barra: buscar a la izquierda; orden y exportar a la derecha. */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[240px] max-w-xl">
          <BuscadorPildoras
            camposFiltro={CAMPOS_FILTRO_PEDIDOS}
            pildoras={pildoras}
            entrada={entrada}
            combinador={combinador}
            placeholder="Buscar referencia, cliente... o (Pedido):2"
            onEntradaChange={setEntrada}
            onCommitEntrada={() => {
              if (!entradaTrim) return
              const nueva = parsearPildora(entradaTrim) ?? { id: crypto.randomUUID(), campo: 'libre' as const, operador: 'contiene' as const, valor: entradaTrim }
              setPildoras(ps => [...ps, nueva])
              setEntrada('')
            }}
            onCampoChange={(id, campo) => setPildoras(ps => ps.map(p => p.id === id ? pildoraConCampoNuevo(p, campo as CampoPedido, CAMPOS_FILTRO_PEDIDOS) as PildoraPedido : p))}
            onOperadorChange={(id, operador) => setPildoras(ps => ps.map(p => p.id === id ? { ...p, operador } : p))}
            onValorChange={(id, valor) => setPildoras(ps => ps.map(p => p.id === id ? { ...p, valor } : p))}
            onRemove={id => setPildoras(ps => ps.filter(p => p.id !== id))}
            onRemoveLast={() => setPildoras(ps => ps.slice(0, -1))}
            onCombinadorChange={setCombinador}
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <select value={ordenPedidos} aria-label="Orden de los pedidos"
            onChange={e => {
              const v = e.target.value === 'recientes' ? 'recientes' : 'entrega'
              setOrdenPedidos(v)
              try { localStorage.setItem('pedidos-orden', v) } catch { /* sin storage: solo esta sesión */ }
            }}
            className={`${inputCls} w-auto`}>
            <option value="entrega">Por fecha de entrega</option>
            <option value="recientes">Más recientes primero</option>
          </select>
          <ActionMenu label="Exportar" items={[
            { label: 'Exportar Excel', icon: Download, onClick: exportarExcel },
            { label: 'Exportar CSV', icon: Download, onClick: exportarCSV },
            { label: 'Exportar PDF', icon: Download, onClick: exportarPDF },
          ]} />
        </div>
      </div>

      {/* Filtros por estado con su cantidad (sobre lo buscado). Un click filtra; otro click vuelve a Todos. */}
      <div role="group" aria-label="Filtrar por estado" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {[
          { id: '', label: 'Todos', n: pedidosBuscados.length },
          ...Object.entries(ESTADO_BADGE)
            .filter(([k]) => (conteoEstados[k] ?? 0) > 0 || filtroEstado === k)
            .map(([k, v]) => ({ id: k, label: v.label, n: conteoEstados[k] ?? 0 })),
        ].map(f => {
          const activo = filtroEstado === f.id
          return (
            <button key={f.id || 'todos'} type="button" aria-pressed={activo}
              onClick={() => setFiltroEstado(activo && f.id ? '' : f.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                activo
                  ? 'bg-primary text-white dark:bg-white dark:text-gray-900 font-medium'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60'}`}>
              {f.label}
              <span className={`tabular-nums text-xs ${activo ? 'opacity-70' : 'text-gray-400 dark:text-gray-500'}`}>{f.n}</span>
            </button>
          )
        })}
        {(conteoVencidos > 0 || soloVencidos) && (
          <button type="button" aria-pressed={soloVencidos} onClick={() => setSoloVencidos(v => !v)}
            className={`ml-1 flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
              soloVencidos
                ? 'bg-red-600 text-white font-medium'
                : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'}`}>
            <CalendarClock size={13} /> Entrega vencida
            <span className={`tabular-nums text-xs ${soloVencidos ? 'opacity-80' : ''}`}>{conteoVencidos}</span>
            {soloVencidos && <X size={12} />}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        {/* Encabezado de columnas: solo en pantallas anchas, donde la fila es una grilla. */}
        {pedidosFiltrados.length > 0 && (
          <div className={`hidden lg:grid ${GRILLA_PEDIDO} px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400`}>
            <span />
            <span>Pedido</span>
            <span>Cliente</span>
            <span>Entrega</span>
            <span>Estado</span>
            <span className="text-right pr-12">Próximo paso</span>
          </div>
        )}
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {isLoading ? (
          <div className="p-4 space-y-3" aria-label="Cargando pedidos">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-700/50 animate-pulse" />)}
          </div>
        ) : pedidosFiltrados.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <Package size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            {(pedidos as any[]).length === 0 ? (
              <>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Todavía no hay pedidos</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Se crean solos cuando una venta necesita preparación o envío.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Ningún pedido coincide con el filtro</p>
                <button type="button" onClick={() => { setFiltroEstado(''); setSoloVencidos(false); setPildoras([]); setEntrada('') }}
                  className="mt-2 text-sm text-accent-text hover:underline">Ver todos</button>
              </>
            )}
          </div>
        ) : pedidosFiltrados.map(p => {
          const badge = ESTADO_BADGE[p.estado] ?? ESTADO_BADGE.borrador
          const isExp = expandedId === p.id
          const nItems = (p.pedido_items ?? []).length
          const cliente = p.clientes?.nombre ?? p.cliente_nombre ?? 'Sin cliente'
          const { principal, menu, nota } = accionesPedido(p)
          const seleccionable = p.estado === 'confirmado' && puedeYo('lanzar') && !motivoNoLanzarPedido(p.ventas?.estado)
          return (
            <div key={p.id} className={isExp ? 'bg-gray-50/70 dark:bg-gray-900/30' : ''}>
              {/* Click en cualquier parte "vacía" de la fila la expande; botones y casillas hacen lo suyo. */}
              <div
                onClick={e => { if (!(e.target as HTMLElement).closest('button, input, a, select, [role="menu"]')) setExpandedId(isExp ? null : p.id) }}
                className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] ${GRILLA_PEDIDO} gap-x-3 gap-y-1.5 items-center px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30`}>
                <div className="row-start-1 col-start-1 lg:row-auto lg:col-auto flex items-center">
                  {seleccionable ? (
                    <input type="checkbox" checked={bolsaSeleccion.has(p.id)} onChange={() => toggleBolsaSeleccion(p.id)}
                      aria-label={`Seleccionar el pedido #${p.numero} para lanzar en bolsa`}
                      className="rounded w-4 h-4" title="Seleccionar para lanzar en bolsa" />
                  ) : <span className="w-4" />}
                </div>

                <div className="row-start-1 col-start-2 lg:row-auto lg:col-auto min-w-0">
                  <button type="button" onClick={() => setExpandedId(isExp ? null : p.id)} aria-expanded={isExp}
                    className="flex items-center gap-1.5 text-left">
                    <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExp ? 'rotate-180' : ''}`} />
                    <span className="font-semibold text-sm text-primary dark:text-white tabular-nums">#{p.numero}</span>
                    {p.referencia && <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded truncate max-w-[9rem]" title="Referencia / Nº externo">{p.referencia}</span>}
                  </button>
                  {p.tipos_pedido?.nombre && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 pl-[1.375rem] truncate">{p.tipos_pedido.nombre}</p>}
                </div>

                <div className="row-start-2 col-start-2 col-end-4 lg:row-auto lg:col-auto min-w-0">
                  <p className="text-sm text-gray-800 dark:text-gray-100 truncate flex items-center gap-1.5">
                    <User size={13} className="text-gray-400 flex-shrink-0" />
                    <span className={`truncate ${cliente === 'Sin cliente' ? 'text-gray-400 dark:text-gray-500' : ''}`}>{cliente}</span>
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1.5 pl-[1.2rem]">
                    {nItems} línea{nItems !== 1 ? 's' : ''}
                    {p.requiere_envio && <><span aria-hidden>·</span><Truck size={12} /> con envío</>}
                  </p>
                </div>

                <div className="row-start-3 col-start-2 col-end-4 lg:row-auto lg:col-auto min-w-0">
                  {p.fecha_entrega_solicitada ? (() => {
                    const urg = urgenciaEntrega(p.fecha_entrega_solicitada, p.estado, hoyStrPed)
                    const env = (p.envios ?? []).find((e: any) => e.rango_horario_desde)
                    const cls = urg === 'atrasado' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      : urg === 'hoy' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      : urg === 'manana' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : ''
                    const etiqueta = urg === 'atrasado' ? 'Atrasado · ' : urg === 'hoy' ? 'Hoy · ' : urg === 'manana' ? 'Mañana · ' : ''
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${urg && urg !== 'proximo' ? `font-semibold px-2 py-1 rounded-md ${cls}` : 'text-gray-500 dark:text-gray-400'}`}
                        title="Fecha de entrega acordada">
                        <CalendarClock size={12} className="flex-shrink-0" />{etiqueta}{fechaEntregaLegible(p.fecha_entrega_solicitada)}
                        {env && <span className="font-normal opacity-80">{` ${env.rango_horario_desde}–${env.rango_horario_hasta}`}</span>}
                      </span>
                    )
                  })() : <span className="text-xs text-gray-400 dark:text-gray-500 hidden lg:inline">Sin fecha</span>}
                </div>

                <div className="row-start-1 col-start-3 lg:row-auto lg:col-auto flex flex-col items-end lg:items-start gap-1">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                  {nota && <span className="hidden lg:flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400" title={nota.detalle}><Info size={11} />{nota.corta}</span>}
                </div>

                <div className="row-start-4 col-start-1 col-end-4 lg:row-auto lg:col-auto flex items-center justify-end gap-2 pt-1 lg:pt-0">
                  {nota && <span className="lg:hidden mr-auto flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400" title={nota.detalle}><Info size={11} />{nota.corta}</span>}
                  {principal}
                  {menu.length > 0 ? <ActionMenu compact label={`Más acciones del pedido #${p.numero}`} items={menu} /> : <span className="w-9" />}
                </div>
              </div>

              {isExp && (
                <div className="panel-in px-4 pb-5 pt-1 lg:pl-[3.25rem] grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <section>
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Productos</h3>
                    <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                      {(p.pedido_items ?? []).map((it: any) => {
                        const cant = Number(it.cantidad)
                        const entregado = Number(it.cantidad_entregada ?? 0)
                        const variante = [it.talle, it.color, it.encaje, it.formato, it.sabor_aroma].filter(Boolean).join(' · ')
                        return (
                          <div key={it.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-800 dark:text-gray-100 truncate">{it.productos?.nombre}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{it.productos?.sku}{variante && ` · ${variante}`}</p>
                            </div>
                            <div className="text-right tabular-nums whitespace-nowrap">
                              <p className="text-gray-800 dark:text-gray-100">{cantidadConUnidad(cant, it.productos?.unidad_medida)}</p>
                              {entregado > 0 && (
                                <p className={`text-xs ${entregado >= cant ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                  {entregado >= cant ? 'Entregado' : `${entregado} entregado · faltan ${cant - entregado}`}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {p.notas && <p className="text-sm text-gray-500 dark:text-gray-400 italic mt-3">{p.notas}</p>}
                    {!['entregado', 'cancelado'].includes(p.estado) && (
                      <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                        <input type="checkbox" className="rounded"
                          checked={p.acepta_entrega_parcial ?? parcialDefaultNegocio}
                          onChange={async e => {
                            const v = e.target.checked
                            const { error } = await supabase.from('pedidos').update({ acepta_entrega_parcial: v }).eq('id', p.id)
                            if (error) { toast.error(error.message); return }
                            logActividad({ entidad: 'pedido', entidad_id: p.id, entidad_nombre: `Pedido #${p.numero}`, accion: 'editar',
                              campo: 'acepta_entrega_parcial', valor_anterior: p.acepta_entrega_parcial == null ? null : String(p.acepta_entrega_parcial), valor_nuevo: String(v), pagina: '/pedidos' })
                            qc.invalidateQueries({ queryKey: ['pedidos'] })
                          }} />
                        El cliente acepta entregas parciales
                        {p.acepta_entrega_parcial == null && <span className="text-gray-400 dark:text-gray-500">(default del negocio)</span>}
                      </label>
                    )}
                  </section>

                  <div className="space-y-5">
                    {p.lanzado_at && (
                      <section>
                        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Tareas de Depósito</h3>
                        {tareasPedidoExp.length === 0 ? (
                          <p className="text-xs text-gray-400">Cargando…</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {(tareasPedidoExp as any[]).map(t => (
                              <li key={t.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                                  t.estado === 'completada' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : t.estado === 'cancelada' ? 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                                  {t.tipo === 'replenishment' ? 'Reabastecimiento' : 'Picking'} · {t.estado}
                                </span>
                                <span className="truncate">{t.productos?.nombre} ({Number(t.cantidad)})</span>
                                {/* Mig 300: fn_unpick_tarea_wms ya soporta tareas encadenadas a un
                                    reabastecimiento (fallback por producto+ubicación cuando el LPN
                                    exacto ya no existe ahí) — "Deshacer" ya no se oculta para esas. */}
                                {t.tipo === 'picking' && t.estado === 'completada' && puedeYo('deslanzar') && (
                                  <button onClick={() => setUnpickModal(t)}
                                    className="ml-auto text-red-500 hover:text-red-600 hover:underline">
                                    Deshacer
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )}
                    {(ventasPedidoExp as any[]).length > 0 && (
                      <section>
                        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Ventas generadas</h3>
                        <ul className="space-y-1.5">
                          {(ventasPedidoExp as any[]).map(v => (
                            <li key={v.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                              <span>Venta #{v.numero} · {v.estado}</span>
                              <span className="tabular-nums">${Number(v.total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                              {!['devuelta', 'cancelada'].includes(v.estado) && (
                                <button onClick={() => navigate(`/ventas?id=${v.id}&devolver=1`)}
                                  className="text-accent-text hover:underline ml-auto">
                                  Devolver esta venta
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {!p.lanzado_at && (ventasPedidoExp as any[]).length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">Las tareas de Depósito aparecen acá cuando el pedido se lanza.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        </div>
      </div>

      {/* Lanzar en bolsa: barra flotante mientras haya pedidos tildados. */}
      {bolsaSeleccion.size > 0 && puedeYo('lanzar') && (
        <div className="barra-in sticky bottom-4 z-20 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-gray-900 dark:bg-gray-700 text-white pl-4 pr-2 py-2 shadow-[0_12px_32px_-8px_rgb(15_23_42/0.45)]">
            <span className="text-sm"><span className="font-semibold tabular-nums">{bolsaSeleccion.size}</span> pedido{bolsaSeleccion.size !== 1 ? 's' : ''} para lanzar</span>
            <button onClick={() => setBolsaModalOpen(true)}
              className="flex items-center gap-1.5 text-sm font-semibold bg-accent text-white px-3.5 py-2 rounded-xl hover:bg-accent/90 transition-[background-color,transform] duration-150 active:scale-[0.97]">
              <Layers size={14} /> Lanzar en bolsa
            </button>
            <button onClick={() => setBolsaSeleccion(new Set())} aria-label="Quitar la selección"
              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"><X size={15} /></button>
          </div>
        </div>
      )}
      </>
      )}

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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de entrega solicitada *</label>
                  <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referencia / Nº externo (opcional)</label>
                <input value={referencia} onChange={e => setReferencia(e.target.value)}
                  placeholder="Nº de pedido propio del cliente, ej. OC-ACME-123 — el interno se asigna solo" className={inputCls} />
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
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={aceptaParcial} onChange={e => setAceptaParcial(e.target.checked)} className="rounded" />
                El cliente acepta entregas parciales (si no, se entrega todo junto cuando esté pickeado)
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
                  {items.map((it, idx) => {
                    const decimal = esDecimal(it.producto.unidad_medida)
                    return (
                    <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="font-medium text-primary dark:text-white">{it.producto.nombre}</span>
                        <span className="text-xs text-gray-400">{it.producto.sku}</span>
                        <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                          className="ml-auto text-gray-400 hover:text-red-500"><X size={14} /></button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="number" min="0" step={decimal ? '0.001' : '1'} value={it.cantidad}
                          onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, cantidad: e.target.value } : x))}
                          onWheel={e => e.currentTarget.blur()}
                          className={`${inputCls} max-w-[100px]`} />
                        <span className="text-xs text-gray-400">{it.producto.unidad_medida ?? 'u'}</span>
                        {estadosInventario.length > 0 && (
                          <select value={it.estadoId} onChange={e => setItems(prev => prev.map((x, i) => i === idx ? { ...x, estadoId: e.target.value } : x))}
                            className={`${inputCls} max-w-[160px] ${!it.estadoId ? 'border-amber-400 dark:border-amber-500' : ''}`}>
                            <option value="">Estado * (elegí uno)</option>
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
                    )
                  })}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
                <input value={notasCab} onChange={e => setNotasCab(e.target.value)} placeholder="Preferencias del cliente, aclaraciones…" className={inputCls} />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => { setShowNuevo(false); resetForm() }}
                className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium px-4 py-2 rounded-xl text-sm">Cancelar</button>
              <button onClick={() => crearPedido.mutate()}
                disabled={crearPedido.isPending || !items.length || !tipoPedidoId || !fechaEntrega || (estadosInventario.length > 0 && items.some(it => !it.estadoId))}
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
              <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700 p-3 cursor-pointer">
                <input type="checkbox" checked={entregaParcial} className="rounded mt-0.5"
                  onChange={e => {
                    const v = e.target.checked
                    setEntregaParcial(v)
                    // Volver a "completa" repone todo lo pendiente (no se puede entregar menos sin pedirlo).
                    if (!v) {
                      const cants: Record<string, string> = {}
                      for (const it of entregaModal.pedido_items ?? []) {
                        if (it.estado === 'cancelada') continue
                        const pend = Number(it.cantidad) - Number(it.cantidad_entregada ?? 0)
                        if (pend > 0) cants[it.id] = String(pend)
                      }
                      setEntregaCantidades(cants)
                    }
                  }} />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">Entrega parcial (lo pidió el cliente)</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {entregaParcial
                      ? 'Cargá cuánto se lleva de cada producto: puede ser hasta lo que ya se pickeó. Lo demás queda pendiente.'
                      : 'Se entrega todo lo pendiente junto, con el picking terminado.'}
                  </span>
                </span>
              </label>
              <div className="space-y-2">
                {(entregaModal.pedido_items ?? []).filter((it: any) => it.estado !== 'cancelada').map((it: any) => {
                  const pendiente = Number(it.cantidad) - Number(it.cantidad_entregada ?? 0)
                  if (pendiente <= 0) return null
                  return (
                    <div key={it.id} className="flex items-center gap-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl p-2.5">
                      <span className="flex-1 truncate">{it.productos?.nombre} <span className="text-xs text-gray-400">({pendiente} pendiente{pendiente !== 1 ? 's' : ''})</span></span>
                      <input type="number" min="0" max={pendiente} step="0.01"
                        readOnly={!entregaParcial} aria-readonly={!entregaParcial}
                        title={entregaParcial ? undefined : 'Para entregar menos, marcá "Entrega parcial"'}
                        value={entregaCantidades[it.id] ?? ''}
                        onChange={e => setEntregaCantidades(prev => ({ ...prev, [it.id]: e.target.value }))}
                        onWheel={e => e.currentTarget.blur()}
                        className={`${inputCls} max-w-[90px] ${entregaParcial ? '' : 'bg-gray-50 dark:bg-gray-900/40 text-gray-500'}`} />
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
                  {(ubicacionesDestino as any[]).map(u => <option key={u.id} value={u.id}>{breadcrumbUbicacion(u.id, ubicacionesDestinoPorId)}</option>)}
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
                  {ubicacionesStaging.map(u => <option key={u.id} value={u.id}>{breadcrumbUbicacion(u.id, ubicacionesStagingPorId)}</option>)}
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
              <button onClick={() => imprimirConNombre(`Picking_Pedido_${imprimirPedido.numero}`)}
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
