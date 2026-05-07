import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Package2, Plus, ChevronRight, Search, Filter, X, Printer,
  ExternalLink, MapPin, Truck, Clock, CheckCircle, RotateCcw,
  AlertTriangle, Send, Scale, Ruler, ChevronDown, Pencil, Trash2,
  FileText, RefreshCw, Calculator,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { buildWhatsAppUrl, expandirPlantilla, PLANTILLA_DEFAULT } from '@/lib/whatsapp'
import toast from 'react-hot-toast'
import { BRAND } from '@/config/brand'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type EstadoEnvio = 'pendiente' | 'despachado' | 'en_camino' | 'entregado' | 'devolucion' | 'cancelado'
type TabEnvio = 'envios' | 'cotizador'

const COURIERS = ['OCA', 'Correo Argentino', 'Andreani', 'DHL Express', 'Otro']

const SERVICIOS_POR_COURIER: Record<string, string[]> = {
  'OCA':              ['Estándar', 'Urgente', 'OCA al Centro', 'Plus', 'Internacional'],
  'Correo Argentino': ['Encomienda Clásica', 'Encomienda Plus', 'Small Pack', 'Express'],
  'Andreani':         ['Estándar', 'Urgente', 'Expreso'],
  'DHL Express':      ['Express Worldwide', 'Economy Select', 'Express Easy'],
  'Otro':             ['Estándar', 'Urgente', 'Personalizado'],
}
const CANALES  = ['POS', 'MELI', 'TiendaNube', 'MP']

const ESTADO_CFG: Record<EstadoEnvio, { label: string; color: string; icon: React.ReactNode }> = {
  pendiente:  { label: 'Pendiente despacho', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',   icon: <Clock size={12} /> },
  despachado: { label: 'Despachado',         color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',       icon: <Send size={12} /> },
  en_camino:  { label: 'En camino',          color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',icon: <Truck size={12} /> },
  entregado:  { label: 'Entregado',          color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',   icon: <CheckCircle size={12} /> },
  devolucion: { label: 'En devolución',      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',icon: <RotateCcw size={12} /> },
  cancelado:  { label: 'Cancelado',          color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',           icon: <X size={12} /> },
}

const ESTADO_SIGUIENTE: Partial<Record<EstadoEnvio, EstadoEnvio>> = {
  pendiente:  'despachado',
  despachado: 'en_camino',
  en_camino:  'entregado',
}

function formatFecha(d: string) {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

interface FormEnvio {
  venta_id: string; cliente_nombre: string
  courier: string; servicio: string; tracking_number: string; tracking_url: string
  canal: string; destino_id: string; destino_descripcion: string
  peso_kg: string; largo_cm: string; ancho_cm: string; alto_cm: string
  costo_cotizado: string; fecha_entrega_acordada: string
  hora_entrega_acordada: string; zona_entrega: string; notas: string
}
const FORM_VACIO: FormEnvio = {
  venta_id: '', cliente_nombre: '',
  courier: '', servicio: '', tracking_number: '', tracking_url: '',
  canal: 'POS', destino_id: '', destino_descripcion: '',
  peso_kg: '', largo_cm: '', ancho_cm: '', alto_cm: '',
  costo_cotizado: '', fecha_entrega_acordada: '', hora_entrega_acordada: '',
  zona_entrega: '', notas: '',
}

export default function EnviosPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const etiquetaRef = useRef<HTMLInputElement>(null)

  const [tab, setTab]               = useState<TabEnvio>('envios')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showModal, setShowModal]   = useState(false)
  const [editId, setEditId]         = useState<string | null>(null)
  const [form, setForm]             = useState<FormEnvio>(FORM_VACIO)
  const [saving, setSaving]         = useState(false)

  // Filtros
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroCourier, setFiltroCourier] = useState('')
  const [filtroCanal,   setFiltroCanal]   = useState('')
  const [filtroDesde,   setFiltroDesde]   = useState('')
  const [filtroHasta,   setFiltroHasta]   = useState('')
  const [busqueda,      setBusqueda]      = useState('')

  // Cotizador
  const [cotCpOrigen,  setCotCpOrigen]  = useState('')
  const [cotCpDestino, setCotCpDestino] = useState('')
  const [cotPeso,      setCotPeso]      = useState('')
  const [cotLargo,     setCotLargo]     = useState('')
  const [cotAncho,     setCotAncho]     = useState('')
  const [cotAlto,      setCotAlto]      = useState('')
  const [cotizando,    setCotizando]    = useState(false)
  const [cotResultados,setCotResultados]= useState<{courier:string;servicio:string;precio:number;dias:string}[]|null>(null)

  // Selección de domicilio al crear envío
  const [ventaSearch, setVentaSearch]       = useState('')
  const [ventaSeleccionada, setVentaSeleccionada] = useState<any | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: envios = [], isLoading } = useQuery({
    queryKey: ['envios', tenant?.id, filtroEstado, filtroCourier, filtroCanal, filtroDesde, filtroHasta, sucursalId],
    queryFn: async () => {
      let q = supabase.from('envios')
        .select('*, ventas(numero, total, cliente_id, clientes(nombre, telefono)), cliente_domicilios(calle, numero, ciudad, provincia)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      q = applyFilter(q)
      if (filtroEstado)  q = q.eq('estado', filtroEstado)
      if (filtroCourier) q = q.eq('courier', filtroCourier)
      if (filtroCanal)   q = q.eq('canal', filtroCanal)
      if (filtroDesde)   q = q.gte('created_at', filtroDesde)
      if (filtroHasta)   q = q.lte('created_at', filtroHasta + 'T23:59:59')
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ventasRecientes = [] } = useQuery({
    queryKey: ['ventas-envio-search', tenant?.id, ventaSearch],
    queryFn: async () => {
      let q = supabase.from('ventas')
        .select('id, numero, total, estado, origen, created_at, cliente_id, clientes(nombre, id)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'reservada'])
        .order('created_at', { ascending: false })
        .limit(20)
      if (ventaSearch) {
        const n = parseInt(ventaSearch)
        if (!isNaN(n)) q = q.eq('numero', n)
      }
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && showModal,
  })

  const { data: domiciliosCliente = [] } = useQuery({
    queryKey: ['domicilios-cliente-envio', ventaSeleccionada?.clientes?.id],
    queryFn: async () => {
      const { data } = await supabase.from('cliente_domicilios')
        .select('*').eq('cliente_id', ventaSeleccionada!.clientes!.id)
        .order('es_principal', { ascending: false }).order('created_at')
      return data ?? []
    },
    enabled: !!ventaSeleccionada?.clientes?.id,
  })

  const { data: ventaItems = [] } = useQuery({
    queryKey: ['envio-venta-items', expandedId],
    queryFn: async () => {
      const envio = (envios as any[]).find(e => e.id === expandedId)
      if (!envio?.venta_id) return []
      const { data } = await supabase.from('venta_items')
        .select('cantidad, precio_unitario, productos(nombre, sku)')
        .eq('venta_id', envio.venta_id)
      return data ?? []
    },
    enabled: !!expandedId,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveEnvio = useMutation({
    mutationFn: async () => {
      const payload: any = {
        tenant_id: tenant!.id,
        sucursal_id: sucursalId || null,
        venta_id: form.venta_id || null,
        courier: form.courier || null,
        servicio: form.servicio || null,
        tracking_number: form.tracking_number.trim() || null,
        tracking_url: form.tracking_url.trim() || null,
        canal: form.canal || null,
        destino_id: form.destino_id || null,
        destino_descripcion: form.destino_descripcion.trim() || null,
        peso_kg: form.peso_kg ? parseFloat(form.peso_kg) : null,
        largo_cm: form.largo_cm ? parseFloat(form.largo_cm) : null,
        ancho_cm: form.ancho_cm ? parseFloat(form.ancho_cm) : null,
        alto_cm: form.alto_cm ? parseFloat(form.alto_cm) : null,
        costo_cotizado: form.costo_cotizado ? parseFloat(form.costo_cotizado) : null,
        fecha_entrega_acordada: form.fecha_entrega_acordada || null,
        hora_entrega_acordada: form.hora_entrega_acordada || null,
        zona_entrega: form.zona_entrega.trim() || null,
        notas: form.notas.trim() || null,
        created_by: user?.id,
      }
      if (editId) {
        const { error } = await supabase.from('envios').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('envios').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Envío actualizado' : 'Envío creado')
      qc.invalidateQueries({ queryKey: ['envios'] })
      setShowModal(false); setEditId(null); setForm(FORM_VACIO)
      setVentaSeleccionada(null); setVentaSearch('')
    },
    onError: (e: any) => toast.error(e.message ?? 'Error al guardar'),
  })

  const actualizarEstado = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: EstadoEnvio }) => {
      const { error } = await supabase.from('envios').update({ estado }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { estado }) => {
      toast.success(`Estado: ${ESTADO_CFG[estado].label}`)
      qc.invalidateQueries({ queryKey: ['envios'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const eliminarEnvio = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('envios').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Envío eliminado'); qc.invalidateQueries({ queryKey: ['envios'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Cotizador ────────────────────────────────────────────────────────────────
  const cotizar = async () => {
    if (!cotCpOrigen || !cotCpDestino || !cotPeso) {
      toast.error('Completá origen, destino y peso')
      return
    }
    setCotizando(true)
    // TODO: llamar a Edge Function courier-rates cuando haya contratos
    // Por ahora retorna datos de ejemplo con mensaje informativo
    await new Promise(r => setTimeout(r, 800))
    setCotResultados([
      { courier: 'OCA',              servicio: 'Estandar',   precio: 0, dias: '—' },
      { courier: 'Correo Argentino', servicio: 'Encomienda', precio: 0, dias: '—' },
      { courier: 'Andreani',         servicio: 'Estandar',   precio: 0, dias: '—' },
      { courier: 'DHL Express',      servicio: 'Express',    precio: 0, dias: '—' },
    ])
    setCotizando(false)
  }

  // ── WhatsApp ─────────────────────────────────────────────────────────────────
  const abrirWhatsApp = (envio: any) => {
    const cliente = envio.ventas?.clientes
    const telefono = cliente?.telefono ?? ''
    if (!telefono) { toast.error('El cliente no tiene teléfono cargado'); return }

    const plantilla = (tenant as any)?.whatsapp_plantilla || PLANTILLA_DEFAULT
    const mensaje = expandirPlantilla(plantilla, {
      nombre_cliente:  cliente?.nombre ?? '',
      nombre_negocio:  tenant?.nombre ?? BRAND.name,
      numero_orden:    envio.numero ?? envio.id.slice(-6),
      tracking:        envio.tracking_number ?? 'pendiente',
      courier:         envio.courier ?? '',
      fecha_entrega:   envio.fecha_entrega_acordada
        ? new Date(envio.fecha_entrega_acordada + 'T12:00:00').toLocaleDateString('es-AR')
        : 'a confirmar',
    })

    const url = buildWhatsAppUrl(telefono, mensaje)
    if (!url) { toast.error('No se pudo generar el link. Revisá el número de teléfono.'); return }
    window.open(url, '_blank', 'noopener')
  }

  // ── Remito PDF ───────────────────────────────────────────────────────────────
  const generarRemito = (envio: any) => {
    const doc = new jsPDF()
    const items = ventaItems as any[]

    doc.setFontSize(18)
    doc.text('REMITO DE ENVÍO', 105, 20, { align: 'center' })
    doc.setFontSize(10)
    doc.text(`${tenant?.nombre ?? BRAND.name}`, 15, 35)
    doc.text(`Envío #${envio.numero ?? envio.id.slice(-6)}`, 15, 42)
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 15, 49)

    if (envio.courier) {
      doc.text(`Courier: ${envio.courier}${envio.servicio ? ` — ${envio.servicio}` : ''}`, 15, 56)
    }
    if (envio.tracking_number) doc.text(`Tracking: ${envio.tracking_number}`, 15, 63)

    doc.setFontSize(11)
    doc.text('DESTINATARIO', 15, 78)
    doc.setFontSize(10)
    const cliente = envio.ventas?.clientes?.nombre ?? envio.destino_descripcion ?? '—'
    doc.text(cliente, 15, 85)

    const dom = envio.cliente_domicilios
    if (dom) {
      doc.text(`${dom.calle}${dom.numero ? ` ${dom.numero}` : ''}`, 15, 92)
      if (dom.ciudad) doc.text(`${dom.ciudad}${dom.provincia ? `, ${dom.provincia}` : ''}`, 15, 99)
    } else if (envio.destino_descripcion) {
      doc.text(envio.destino_descripcion, 15, 92)
    }

    if (items.length > 0) {
      autoTable(doc, {
        startY: 115,
        head: [['Producto', 'Cant.', 'Precio unit.', 'Subtotal']],
        body: items.map((it: any) => [
          it.productos?.nombre ?? '—',
          it.cantidad,
          formatMoneda(it.precio_unitario ?? 0),
          formatMoneda((it.precio_unitario ?? 0) * it.cantidad),
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [100, 0, 200] },
      })
    }

    if (envio.notas) {
      const y = (doc as any).lastAutoTable?.finalY ?? 140
      doc.text(`Notas: ${envio.notas}`, 15, y + 10)
    }

    doc.save(`remito_envio_${envio.numero ?? envio.id.slice(-6)}.pdf`)
  }

  // ── Filtros aplicados ─────────────────────────────────────────────────────────
  const enviosFiltrados = (envios as any[]).filter(e => {
    if (!busqueda) return true
    const s = busqueda.toLowerCase()
    const cliente = e.ventas?.clientes?.nombre?.toLowerCase() ?? ''
    const num = String(e.numero ?? '')
    const tracking = e.tracking_number?.toLowerCase() ?? ''
    return cliente.includes(s) || num.includes(s) || tracking.includes(s)
  })

  const hayFiltros = filtroEstado || filtroCourier || filtroCanal || filtroDesde || filtroHasta

  // ── Helpers form ─────────────────────────────────────────────────────────────
  const abrirNuevo = () => {
    setEditId(null); setForm(FORM_VACIO)
    setVentaSeleccionada(null); setVentaSearch(''); setShowModal(true)
  }
  const abrirEdicion = (e: any) => {
    if (e.estado === 'entregado') { toast('Este envío ya fue entregado y no puede editarse.', { icon: '🔒' }); return }
    setEditId(e.id)
    setForm({
      venta_id: e.venta_id ?? '', cliente_nombre: e.ventas?.clientes?.nombre ?? '',
      courier: e.courier ?? '', servicio: e.servicio ?? '',
      tracking_number: e.tracking_number ?? '', tracking_url: e.tracking_url ?? '',
      canal: e.canal ?? 'POS', destino_id: e.destino_id ?? '',
      destino_descripcion: e.destino_descripcion ?? '',
      peso_kg: e.peso_kg ? String(e.peso_kg) : '',
      largo_cm: e.largo_cm ? String(e.largo_cm) : '',
      ancho_cm: e.ancho_cm ? String(e.ancho_cm) : '',
      alto_cm: e.alto_cm ? String(e.alto_cm) : '',
      costo_cotizado: e.costo_cotizado ? String(e.costo_cotizado) : '',
      fecha_entrega_acordada: e.fecha_entrega_acordada ?? '',
      hora_entrega_acordada: e.hora_entrega_acordada ?? '',
      zona_entrega: e.zona_entrega ?? '', notas: e.notas ?? '',
    })
    setShowModal(true)
  }

  const seleccionarVenta = (v: any) => {
    setVentaSeleccionada(v)
    setForm(f => ({
      ...f, venta_id: v.id,
      cliente_nombre: v.clientes?.nombre ?? '',
      canal: v.origen ?? 'POS',  // autocompletado desde el canal de la venta
    }))
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Package2 size={22} className="text-accent" /> Envíos
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Seguimiento y gestión de envíos por canal
          </p>
        </div>
        {tab === 'envios' && (
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2.5 rounded-xl transition-all">
            <Plus size={18} /> Nuevo envío
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'envios' as const,    label: 'Envíos',     icon: <Package2 size={14} /> },
          { id: 'cotizador' as const, label: 'Cotizador',  icon: <Calculator size={14} /> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB: ENVÍOS ══ */}
      {tab === 'envios' && (
        <div className="space-y-4">
          {/* Buscador + filtros */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por cliente, #envío o tracking…"
                className="pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent w-64" />
            </div>

            {/* Filtro estado */}
            <div className="relative">
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent">
                <option value="">Todos los estados</option>
                {Object.entries(ESTADO_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Filtro courier */}
            <div className="relative">
              <select value={filtroCourier} onChange={e => setFiltroCourier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent">
                <option value="">Todos los couriers</option>
                {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Filtro canal */}
            <div className="relative">
              <select value={filtroCanal} onChange={e => setFiltroCanal(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent">
                <option value="">Todos los canales</option>
                {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Filtro fechas */}
            <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)}
              className="py-2 px-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent" />
            <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)}
              className="py-2 px-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-accent" />

            {(hayFiltros || busqueda) && (
              <button onClick={() => { setFiltroEstado(''); setFiltroCourier(''); setFiltroCanal(''); setFiltroDesde(''); setFiltroHasta(''); setBusqueda('') }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={14} /> Limpiar
              </button>
            )}
          </div>

          {/* Lista */}
          {isLoading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" /></div>
          ) : enviosFiltrados.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <Package2 size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay envíos{hayFiltros || busqueda ? ' con esos filtros' : ' registrados'}</p>
              <button onClick={abrirNuevo} className="mt-3 text-accent text-sm font-medium hover:underline">
                Crear el primero
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-8" />
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">#</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Fecha</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Cliente</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Courier</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Estado</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden lg:table-cell">Canal</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden lg:table-cell">Ciudad destino</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden xl:table-cell">Entrega acordada</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {enviosFiltrados.map((e: any) => {
                      const cfg = ESTADO_CFG[e.estado as EstadoEnvio] ?? ESTADO_CFG.pendiente
                      const sigEstado = ESTADO_SIGUIENTE[e.estado as EstadoEnvio]
                      const dom = e.cliente_domicilios
                      return (
                        <>
                          <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-4 py-3">
                              <button onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                                className="text-gray-400 hover:text-accent transition-colors">
                                <ChevronRight size={16} className={`transition-transform ${expandedId === e.id ? 'rotate-90' : ''}`} />
                              </button>
                            </td>
                            <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-100">
                              #{e.numero ?? e.id.slice(-6)}
                              {e.ventas?.numero && <span className="ml-1.5 text-xs text-gray-400">V#{e.ventas.numero}</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatFecha(e.created_at)}</td>
                            <td className="px-4 py-3 text-gray-800 dark:text-gray-100 font-medium">
                              {e.ventas?.clientes?.nombre ?? e.destino_descripcion?.split('\n')[0] ?? '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-gray-700 dark:text-gray-300">{e.courier ?? '—'}</span>
                              {e.servicio && <span className="block text-xs text-gray-400">{e.servicio}</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                                {cfg.icon}{cfg.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                              {e.canal ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                              {dom?.ciudad ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden xl:table-cell whitespace-nowrap">
                              {e.fecha_entrega_acordada ? formatFecha(e.fecha_entrega_acordada) : '—'}
                              {e.hora_entrega_acordada && <span className="ml-1">{e.hora_entrega_acordada.slice(0,5)}</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                                {/* WhatsApp */}
                                <button onClick={() => abrirWhatsApp(e)}
                                  title="Coordinar entrega por WhatsApp"
                                  className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                  </svg>
                                </button>
                                {sigEstado && (
                                  <button onClick={() => actualizarEstado.mutate({ id: e.id, estado: sigEstado })}
                                    title={`Marcar como ${ESTADO_CFG[sigEstado].label}`}
                                    className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                                    <RefreshCw size={14} />
                                  </button>
                                )}
                                <button onClick={() => abrirEdicion(e)}
                                  disabled={e.estado === 'entregado'}
                                  title={e.estado === 'entregado' ? 'Envío entregado — no editable' : 'Editar'}
                                  className="p-1.5 text-gray-400 hover:text-accent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => { if (confirm('¿Eliminar este envío?')) eliminarEnvio.mutate(e.id) }}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Fila de detalle expandido */}
                          {expandedId === e.id && (
                            <tr key={`${e.id}-detail`}>
                              <td colSpan={10} className="bg-gray-50 dark:bg-gray-700/30 px-6 py-4">
                                <div className="grid md:grid-cols-3 gap-4">
                                  {/* Destinatario */}
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1"><MapPin size={11} /> Destinatario</p>
                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                      {e.ventas?.clientes?.nombre ?? '—'}
                                    </p>
                                    {dom && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                        {dom.calle}{dom.numero ? ` ${dom.numero}` : ''}
                                        {dom.ciudad ? `, ${dom.ciudad}` : ''}
                                        {dom.provincia ? ` (${dom.provincia})` : ''}
                                      </p>
                                    )}
                                    {!dom && e.destino_descripcion && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 whitespace-pre-line">{e.destino_descripcion}</p>
                                    )}
                                    {e.zona_entrega && <p className="text-xs text-accent mt-0.5">Zona: {e.zona_entrega}</p>}
                                  </div>

                                  {/* Courier + tracking */}
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1"><Truck size={11} /> Courier</p>
                                    {e.courier && <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{e.courier}{e.servicio ? ` — ${e.servicio}` : ''}</p>}
                                    {e.tracking_number && (
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{e.tracking_number}</span>
                                        {e.tracking_url && (
                                          <a href={e.tracking_url} target="_blank" rel="noreferrer"
                                            className="text-accent hover:text-accent/80"><ExternalLink size={12} /></a>
                                        )}
                                      </div>
                                    )}
                                    {(e.peso_kg || e.largo_cm) && (
                                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        {e.peso_kg && <span className="flex items-center gap-1"><Scale size={11} />{e.peso_kg} kg</span>}
                                        {e.largo_cm && <span className="flex items-center gap-1"><Ruler size={11} />{e.largo_cm}×{e.ancho_cm}×{e.alto_cm} cm</span>}
                                      </div>
                                    )}
                                    {e.costo_cotizado != null && (
                                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">Costo: {formatMoneda(Number(e.costo_cotizado))}</p>
                                    )}
                                  </div>

                                  {/* Productos */}
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Productos</p>
                                    {(ventaItems as any[]).length === 0 ? (
                                      <p className="text-xs text-gray-400">Sin detalle de productos</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {(ventaItems as any[]).map((it: any, i: number) => (
                                          <p key={i} className="text-xs text-gray-600 dark:text-gray-300">
                                            {it.cantidad}× {it.productos?.nombre ?? '—'}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {e.notas && (
                                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-600 pt-2">
                                    Notas: {e.notas}
                                  </p>
                                )}

                                {/* Acciones */}
                                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 flex-wrap">
                                  <button onClick={() => abrirWhatsApp(e)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors font-medium">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                    </svg>
                                    Coordinar entrega
                                  </button>
                                  <button onClick={() => generarRemito(e)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                    <FileText size={13} /> Generar remito
                                  </button>
                                  {e.tracking_url && (
                                    <a href={e.tracking_url} target="_blank" rel="noreferrer"
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-accent/30 rounded-lg text-accent hover:bg-accent/10 transition-colors">
                                      <ExternalLink size={13} /> Ver tracking
                                    </a>
                                  )}
                                  {e.ventas?.id && (
                                    <button onClick={() => navigate(`/ventas?id=${e.venta_id}`)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                      <ExternalLink size={13} /> Ver venta
                                    </button>
                                  )}
                                  {/* Avanzar estado */}
                                  {ESTADO_SIGUIENTE[e.estado as EstadoEnvio] && (
                                    <button
                                      onClick={() => actualizarEstado.mutate({ id: e.id, estado: ESTADO_SIGUIENTE[e.estado as EstadoEnvio]! })}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors">
                                      <RefreshCw size={13} /> Marcar como {ESTADO_CFG[ESTADO_SIGUIENTE[e.estado as EstadoEnvio]!].label}
                                    </button>
                                  )}
                                  {e.estado !== 'cancelado' && e.estado !== 'entregado' && (
                                    <button onClick={() => actualizarEstado.mutate({ id: e.id, estado: 'cancelado' })}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 dark:border-red-800 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto">
                                      <X size={13} /> Cancelar envío
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: COTIZADOR ══ */}
      {tab === 'cotizador' && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Calculator size={18} className="text-accent" /> Comparar tarifas de couriers
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Código postal origen</label>
                <input type="text" value={cotCpOrigen} onChange={e => setCotCpOrigen(e.target.value)} placeholder="C1043"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Código postal destino</label>
                <input type="text" value={cotCpDestino} onChange={e => setCotCpDestino(e.target.value)} placeholder="5000"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Peso (kg) *</label>
                <input type="number" onWheel={e => e.currentTarget.blur()} value={cotPeso} onChange={e => setCotPeso(e.target.value)} placeholder="1.5" min="0" step="0.1"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Largo', val: cotLargo, set: setCotLargo },
                  { label: 'Ancho', val: cotAncho, set: setCotAncho },
                  { label: 'Alto',  val: cotAlto,  set: setCotAlto  },
                ].map(({ label, val, set }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label} (cm)</label>
                    <input type="number" onWheel={e => e.currentTarget.blur()} value={val} onChange={e => set(e.target.value)} placeholder="0" min="0"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-2 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                ))}
              </div>
            </div>
            <button onClick={cotizar} disabled={cotizando}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {cotizando ? <><RefreshCw size={15} className="animate-spin" /> Cotizando…</> : <><Calculator size={15} /> Comparar tarifas</>}
            </button>
          </div>

          {cotResultados && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle size={13} />
                <span>Las tarifas reales estarán disponibles cuando configures tus credenciales con cada courier. Por ahora mostramos los couriers disponibles para integrar.</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Courier</th>
                      <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Servicio</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Tarifa</th>
                      <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Días est.</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {cotResultados.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 font-medium text-gray-800 dark:text-gray-100">{r.courier}</td>
                        <td className="py-3 text-gray-600 dark:text-gray-300">{r.servicio}</td>
                        <td className="py-3 text-right text-gray-400 dark:text-gray-500 italic">Sin credenciales</td>
                        <td className="py-3 text-right text-gray-400 dark:text-gray-500">—</td>
                        <td className="py-3 pl-2">
                          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">Próximamente</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ MODAL: NUEVO / EDITAR ENVÍO ══ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editId ? 'Editar envío' : 'Nuevo envío'}</h2>
              <button onClick={() => { setShowModal(false); setEditId(null); setForm(FORM_VACIO); setVentaSeleccionada(null) }}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Seleccionar venta */}
              {!editId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Venta asociada (opcional)</label>
                  {ventaSeleccionada ? (
                    <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-3 py-2">
                      <span className="text-sm text-gray-800 dark:text-gray-100">
                        Venta #{ventaSeleccionada.numero} — {ventaSeleccionada.clientes?.nombre ?? '—'} — {formatMoneda(ventaSeleccionada.total ?? 0)}
                      </span>
                      <button onClick={() => { setVentaSeleccionada(null); setForm(f => ({ ...f, venta_id: '', destino_id: '' })) }}
                        className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ) : (
                    <div>
                      <div className="relative mb-2">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={ventaSearch} onChange={e => setVentaSearch(e.target.value)}
                          placeholder="Buscar por número de venta…"
                          className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {(ventasRecientes as any[]).map((v: any) => (
                          <button key={v.id} onClick={() => seleccionarVenta(v)}
                            className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-100">
                            #{v.numero} — {v.clientes?.nombre ?? 'Sin cliente'} — {formatMoneda(v.total ?? 0)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Domicilio de destino */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domicilio de destino</label>
                {(domiciliosCliente as any[]).length > 0 ? (
                  <div className="space-y-1">
                    {(domiciliosCliente as any[]).map((d: any) => (
                      <label key={d.id} className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
                        ${form.destino_id === d.id ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-600 hover:border-accent/40'}`}>
                        <input type="radio" checked={form.destino_id === d.id}
                          onChange={() => {
                            setForm(f => ({ ...f, destino_id: d.id, destino_descripcion: `${d.calle}${d.numero ? ` ${d.numero}` : ''}${d.piso_depto ? `, ${d.piso_depto}` : ''}, ${d.ciudad ?? ''} ${d.provincia ?? ''} ${d.codigo_postal ?? ''}`.trim() }))
                          }} className="accent-accent mt-0.5" />
                        <div>
                          {d.nombre && <span className="text-xs font-semibold text-accent">{d.nombre} </span>}
                          <span className="text-sm text-gray-800 dark:text-gray-100">{d.calle}{d.numero ? ` ${d.numero}` : ''}{d.piso_depto ? `, ${d.piso_depto}` : ''}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{[d.ciudad, d.provincia, d.codigo_postal].filter(Boolean).join(' · ')}</p>
                        </div>
                      </label>
                    ))}
                    <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
                      ${form.destino_id === '' ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-600 hover:border-accent/40'}`}>
                      <input type="radio" checked={form.destino_id === ''}
                        onChange={() => setForm(f => ({ ...f, destino_id: '' }))} className="accent-accent" />
                      <span className="text-sm text-gray-600 dark:text-gray-300">Ingresar domicilio manualmente</span>
                    </label>
                  </div>
                ) : null}
                {form.destino_id === '' && (
                  <textarea value={form.destino_descripcion} onChange={e => setForm(f => ({ ...f, destino_descripcion: e.target.value }))}
                    placeholder="Calle, número, ciudad, provincia, CP" rows={2}
                    className="mt-2 w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Courier */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Courier</label>
                  <div className="relative">
                    <select value={form.courier} onChange={e => setForm(f => ({ ...f, courier: e.target.value }))}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      <option value="">Sin especificar</option>
                      {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Servicio */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Servicio</label>
                  {form.courier && SERVICIOS_POR_COURIER[form.courier] ? (
                    <div className="relative">
                      <select value={form.servicio} onChange={e => setForm(f => ({ ...f, servicio: e.target.value }))}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Seleccionar servicio…</option>
                        {SERVICIOS_POR_COURIER[form.courier].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  ) : (
                    <input type="text" value={form.servicio} onChange={e => setForm(f => ({ ...f, servicio: e.target.value }))}
                      placeholder={form.courier ? 'Ej: Estándar' : 'Elegí primero el courier'}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  )}
                </div>
                {/* Tracking */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número de tracking</label>
                  <input type="text" value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))}
                    placeholder="Código de seguimiento"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {/* Canal */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Canal de venta</label>
                  <div className="relative">
                    <select value={form.canal} onChange={e => setForm(f => ({ ...f, canal: e.target.value }))}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Costo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Costo de envío ($)</label>
                  <input type="number" onWheel={e => e.currentTarget.blur()} value={form.costo_cotizado}
                    onChange={e => setForm(f => ({ ...f, costo_cotizado: e.target.value }))} placeholder="0" min="0"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {/* Zona */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Zona de entrega</label>
                  <input type="text" value={form.zona_entrega} onChange={e => setForm(f => ({ ...f, zona_entrega: e.target.value }))}
                    placeholder="Ej: CABA, GBA Norte"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {/* Fecha entrega */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de entrega acordada</label>
                  <input type="date" value={form.fecha_entrega_acordada}
                    onChange={e => setForm(f => ({ ...f, fecha_entrega_acordada: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {/* Hora entrega */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hora acordada</label>
                  <input type="time" value={form.hora_entrega_acordada}
                    onChange={e => setForm(f => ({ ...f, hora_entrega_acordada: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              {/* Dimensiones */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dimensiones del paquete</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Peso (kg)', field: 'peso_kg' as const, step: '0.1' },
                    { label: 'Largo (cm)', field: 'largo_cm' as const, step: '1' },
                    { label: 'Ancho (cm)', field: 'ancho_cm' as const, step: '1' },
                    { label: 'Alto (cm)',  field: 'alto_cm'  as const, step: '1' },
                  ].map(({ label, field, step }) => (
                    <div key={field}>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</label>
                      <input type="number" onWheel={e => e.currentTarget.blur()} value={form[field]}
                        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                        placeholder="0" min="0" step={step}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Instrucciones especiales, referencias adicionales…" rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3 flex-shrink-0">
              <button onClick={() => { setShowModal(false); setEditId(null); setForm(FORM_VACIO); setVentaSeleccionada(null) }}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={() => saveEnvio.mutate()} disabled={saveEnvio.isPending}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {saveEnvio.isPending ? 'Guardando…' : editId ? 'Guardar cambios' : 'Crear envío'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
