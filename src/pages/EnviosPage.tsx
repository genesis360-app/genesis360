import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Package2, Plus, ChevronRight, Search, X, Printer,
  ExternalLink, MapPin, Truck, Clock, CheckCircle, RotateCcw,
  AlertTriangle, Send, Scale, Ruler, ChevronDown, Pencil, Trash2,
  FileText, RefreshCw, Navigation, Loader2, Warehouse, ClipboardCheck, Upload, User as UserIcon,
  Camera, CreditCard, DollarSign, PackageCheck, QrCode, Tag,
} from 'lucide-react'
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput'
import { calcularDistanciaKm } from '@/hooks/useGoogleMaps'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { buildWhatsAppUrl, expandirPlantilla, PLANTILLA_DEFAULT } from '@/lib/whatsapp'
import toast from 'react-hot-toast'
import { BRAND } from '@/config/brand'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type EstadoEnvio = 'pendiente' | 'despachado' | 'en_camino' | 'en_bodega' | 'entregado' | 'devolucion' | 'cancelado'
type TabEnvio = 'envios' | 'pagos'

const MEDIOS_PAGO_COURIER = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro']

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
  en_bodega:  { label: 'En bodega',          color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',icon: <Warehouse size={12} /> },
  entregado:  { label: 'Entregado',          color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',   icon: <CheckCircle size={12} /> },
  devolucion: { label: 'En devolución',      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',icon: <RotateCcw size={12} /> },
  cancelado:  { label: 'Cancelado',          color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',           icon: <X size={12} /> },
}

const ESTADO_SIGUIENTE: Partial<Record<EstadoEnvio, EstadoEnvio>> = {
  pendiente:  'despachado',
  despachado: 'en_camino',
  en_camino:  'en_bodega',
  en_bodega:  'entregado',
}

function formatFecha(d: string) {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
import { formatMoneda as formatMonedaLib } from '@/lib/formato'
// formatMoneda local: usa moneda del tenant (v1.8.44)

interface FormEnvio {
  venta_id: string; cliente_nombre: string
  courier: string; servicio: string; tracking_number: string; tracking_url: string
  canal: string; destino_id: string; destino_descripcion: string
  peso_kg: string; largo_cm: string; ancho_cm: string; alto_cm: string
  costo_cotizado: string; fecha_entrega_acordada: string
  hora_entrega_acordada: string; zona_entrega: string; notas: string
  // POD — Prueba de entrega
  pod_fecha: string; pod_receptor: string; pod_notas: string; pod_url: string
}
const FORM_VACIO: FormEnvio = {
  venta_id: '', cliente_nombre: '',
  courier: '', servicio: '', tracking_number: '', tracking_url: '',
  canal: 'POS', destino_id: '', destino_descripcion: '',
  peso_kg: '', largo_cm: '', ancho_cm: '', alto_cm: '',
  costo_cotizado: '', fecha_entrega_acordada: '', hora_entrega_acordada: '',
  zona_entrega: '', notas: '',
  pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '',
}

export default function EnviosPage() {
  const { tenant, user } = useAuthStore()
  const formatMoneda = (v: number) => formatMonedaLib(v, (tenant as any)?.moneda ?? 'ARS')
  const { sucursalId, applyFilter, sucursales } = useSucursalFilter()

  // Formatea el número de venta igual que VentasPage:
  // con prefijo (CODIGO-NNNN) si la sucursal tiene código configurado, sino #numero global
  const formatVentaNum = (venta: any) => {
    if (venta?.numero_sucursal && venta?.sucursal_id) {
      const suc = (sucursales as any[]).find(s => s.id === venta.sucursal_id)
      if (suc?.codigo) return `${suc.codigo}-${String(venta.numero_sucursal).padStart(4, '0')}`
    }
    return `#${venta?.numero ?? '?'}`
  }
  const qc = useQueryClient()
  const navigate = useNavigate()
  const etiquetaRef = useRef<HTMLInputElement>(null)

  const [tab, setTab]               = useState<TabEnvio>('envios')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showModal, setShowModal]   = useState(false)
  const [editId, setEditId]         = useState<string | null>(null)
  const [form, setForm]             = useState<FormEnvio>(FORM_VACIO)
  const [saving, setSaving]         = useState(false)
  const [tipoEnvio, setTipoEnvio]   = useState<'propio' | 'tercero'>('tercero')
  const [distanciaKm, setDistanciaKm] = useState<number | null>(null)
  const [calculandoKm, setCalculandoKm] = useState(false)
  const [direccionEntrega, setDireccionEntrega] = useState('')

  // Filtros
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroCourier, setFiltroCourier] = useState('')
  const [filtroCanal,   setFiltroCanal]   = useState('')
  const [filtroDesde,   setFiltroDesde]   = useState('')
  const [filtroHasta,   setFiltroHasta]   = useState('')
  const [busqueda,      setBusqueda]      = useState('')

  // Selección de domicilio al crear envío
  const [ventaSearch, setVentaSearch]       = useState('')
  const [ventaSeleccionada, setVentaSeleccionada] = useState<any | null>(null)

  // POD modal — registrar prueba de entrega desde la fila expandida
  const [podModalId, setPodModalId]   = useState<string | null>(null)
  const [podForm, setPodForm]         = useState({ pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '' })
  const [savingPod, setSavingPod]     = useState(false)
  const [uploadingFoto, setUploadingFoto] = useState(false)   // ISS-166: upload foto POD
  const cameraInputRef = useRef<HTMLInputElement>(null)        // ISS-166: hidden file input

  // ISS-169: Pagos courier
  const [pagosSeleccion, setPagosSeleccion] = useState<Set<string>>(new Set())
  const [pagoMedio, setPagoMedio]           = useState('Transferencia')
  const [pagoFecha, setPagoFecha]           = useState(new Date().toISOString().split('T')[0])
  const [savingPago, setSavingPago]         = useState(false)

  // Edición inline de domicilios
  const [editandoDomId, setEditandoDomId] = useState<string | null>(null)
  const [showNuevoDom,  setShowNuevoDom]  = useState(false)
  const [domForm, setDomForm] = useState({ nombre: '', calle: '', numero: '', piso_depto: '', ciudad: '', provincia: '', codigo_postal: '' })

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: envios = [], isLoading } = useQuery({
    queryKey: ['envios', tenant?.id, filtroEstado, filtroCourier, filtroCanal, filtroDesde, filtroHasta, sucursalId],
    queryFn: async () => {
      let q = supabase.from('envios')
        .select('*, ventas(numero, numero_sucursal, sucursal_id, total, cliente_id, clientes(nombre, telefono)), cliente_domicilios(calle, numero, ciudad, provincia)')
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
      // Excluir ventas que ya tienen un envío asignado
      const { data: conEnvio } = await supabase
        .from('envios')
        .select('venta_id')
        .eq('tenant_id', tenant!.id)
        .not('venta_id', 'is', null)
      const idsConEnvio = (conEnvio ?? []).map((e: any) => e.venta_id).filter(Boolean)

      let q = supabase.from('ventas')
        .select('id, numero, numero_sucursal, sucursal_id, total, estado, origen, created_at, cliente_id, clientes(nombre, id)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'reservada'])
        .order('created_at', { ascending: false })
        .limit(20)
      if (ventaSearch) {
        const n = parseInt(ventaSearch)
        if (!isNaN(n)) q = q.eq('numero', n)
      }
      if (idsConEnvio.length > 0) q = q.not('id', 'in', `(${idsConEnvio.join(',')})`)
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
      // ISS-168: incluye linea_id para obtener LPN y ubicación
      const { data } = await supabase.from('venta_items')
        .select('cantidad, precio_unitario, linea_id, productos(nombre, sku), inventario_lineas(lpn, ubicaciones(nombre))')
        .eq('venta_id', envio.venta_id)
      return data ?? []
    },
    enabled: !!expandedId,
  })

  // Datos de la sucursal activa (dirección origen + costo_km_envio)
  const { data: sucursalActiva } = useQuery({
    queryKey: ['sucursal-activa-envio', sucursalId],
    queryFn: async () => {
      if (!sucursalId) return null
      const { data } = await supabase.from('sucursales').select('id, nombre, direccion, costo_km_envio').eq('id', sucursalId).single()
      return data
    },
    enabled: !!sucursalId,
  })

  // Tarifas de couriers para la sucursal activa
  const { data: courierTarifas = [] } = useQuery({
    queryKey: ['courier-tarifas-envio', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await supabase.from('courier_tarifas')
        .select('courier, precio').eq('tenant_id', tenant!.id)
        .eq('sucursal_id', sucursalId!).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant && !!sucursalId,
  })

  // ISS-169: envíos con costo pendiente de pago al courier
  const { data: enviosPendientesPago = [] } = useQuery({
    queryKey: ['envios-pendientes-pago', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('envios')
        .select('id, numero, courier, costo_cotizado, estado, created_at, ventas(numero, numero_sucursal, sucursal_id, clientes(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('costo_pagado', false)
        .gt('costo_cotizado', 0)
        .order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'pagos',
  })

  // Auto-calcular KM cuando hay dirección de entrega + sucursal con dirección
  const calcularKmAuto = async (destino: string) => {
    const origen = sucursalActiva?.direccion
    if (!origen || !destino.trim()) return
    setCalculandoKm(true)
    try {
      const km = await calcularDistanciaKm(origen, destino)
      if (km !== null) {
        setDistanciaKm(km)
        const costoKm = sucursalActiva?.costo_km_envio || (tenant as any)?.costo_envio_por_km || 0
        if (costoKm > 0) {
          setForm(f => ({ ...f, costo_cotizado: (km * costoKm).toFixed(2) }))
        }
      }
    } finally {
      setCalculandoKm(false)
    }
  }

  // Direcciones guardadas del cliente formateadas para autocomplete
  const domiciliosFormateados = (domiciliosCliente as any[]).map(d =>
    [d.calle, d.numero, d.piso_depto, d.ciudad, d.provincia].filter(Boolean).join(', ')
  )

  // Auto-completar costo courier al seleccionar courier
  const handleCourierChange = (courier: string) => {
    setForm(f => {
      const tarifa = (courierTarifas as any[]).find(t => t.courier === courier)
      return { ...f, courier, costo_cotizado: tarifa ? String(tarifa.precio) : f.costo_cotizado }
    })
  }

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
        pod_fecha: form.pod_fecha || null,
        pod_receptor: form.pod_receptor.trim() || null,
        pod_notas: form.pod_notas.trim() || null,
        pod_url: form.pod_url.trim() || null,
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
      setDistanciaKm(null); setDireccionEntrega('')
    },
    onError: (e: any) => toast.error(e.message ?? 'Error al guardar'),
  })

  // ISS-171: verificar pago antes de avanzar estado
  const verificarPagoAntes = (envio: any): boolean => {
    if ((envio.costo_cotizado ?? 0) > 0 && !envio.costo_pagado) {
      toast.error('💳 Pagá el costo del courier antes de avanzar el envío. → Pestaña "Pagos Courier"', { duration: 5000 })
      return false
    }
    return true
  }

  const actualizarEstado = useMutation({
    mutationFn: async ({ id, estado, envio }: { id: string; estado: EstadoEnvio; envio: any }) => {
      if (!verificarPagoAntes(envio)) throw new Error('pago_pendiente')
      const { error } = await supabase.from('envios').update({ estado }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { estado }) => {
      toast.success(`Estado: ${ESTADO_CFG[estado].label}`)
      qc.invalidateQueries({ queryKey: ['envios'] })
    },
    onError: (e: any) => { if (e.message !== 'pago_pendiente') toast.error(e.message) },
  })

  const eliminarEnvio = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('envios').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Envío eliminado'); qc.invalidateQueries({ queryKey: ['envios'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  // Guardar domicilio (nuevo o edición)
  const saveDomicilio = useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: typeof domForm }) => {
      if (id) {
        const { error } = await supabase.from('cliente_domicilios').update(data).eq('id', id)
        if (error) throw error
      } else {
        const clienteId = ventaSeleccionada?.clientes?.id
        if (!clienteId) throw new Error('Seleccioná una venta con cliente antes de agregar una dirección')
        const { error } = await supabase.from('cliente_domicilios').insert({
          ...data, cliente_id: clienteId, tenant_id: tenant!.id,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Dirección guardada')
      qc.invalidateQueries({ queryKey: ['domicilios-cliente-envio'] })
      setEditandoDomId(null)
      setShowNuevoDom(false)
      setDomForm({ nombre: '', calle: '', numero: '', piso_depto: '', ciudad: '', provincia: '', codigo_postal: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── POD — guardar prueba de entrega ──────────────────────────────────────────
  const savePod = async () => {
    if (!podModalId) return
    setSavingPod(true)
    try {
      const { error } = await supabase.from('envios').update({
        pod_fecha:    podForm.pod_fecha || null,
        pod_receptor: podForm.pod_receptor.trim() || null,
        pod_notas:    podForm.pod_notas.trim() || null,
        pod_url:      podForm.pod_url.trim() || null,
        estado:       'entregado',
      }).eq('id', podModalId)
      if (error) throw error
      toast.success('Prueba de entrega registrada')
      qc.invalidateQueries({ queryKey: ['envios'] })
      setPodModalId(null)
      setPodForm({ pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '' })
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar POD')
    } finally {
      setSavingPod(false)
    }
  }

  // ── ISS-166: Upload foto POD desde cámara ───────────────────────────────────
  const handleFotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !podModalId) return
    setUploadingFoto(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `pod/${podModalId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('etiquetas-envios').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: signedData } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
      if (signedData?.signedUrl) setPodForm(f => ({ ...f, pod_url: signedData.signedUrl }))
      toast.success('Foto subida correctamente')
    } catch (err: any) { toast.error('Error al subir la foto') }
    finally { setUploadingFoto(false); if (cameraInputRef.current) cameraInputRef.current.value = '' }
  }

  // ── ISS-169: Marcar envíos seleccionados como pagados ───────────────────────
  const marcarPagados = async () => {
    if (pagosSeleccion.size === 0) { toast.error('Seleccioná al menos un envío'); return }
    setSavingPago(true)
    try {
      const ids = [...pagosSeleccion]
      const { error } = await supabase.from('envios').update({
        costo_pagado: true,
        fecha_pago_courier: pagoFecha || null,
        medio_pago_courier: pagoMedio || null,
      }).in('id', ids)
      if (error) throw error
      toast.success(`${ids.length} envío${ids.length > 1 ? 's' : ''} marcado${ids.length > 1 ? 's' : ''} como pagado${ids.length > 1 ? 's' : ''}`)
      qc.invalidateQueries({ queryKey: ['envios-pendientes-pago'] })
      qc.invalidateQueries({ queryKey: ['envios'] })
      setPagosSeleccion(new Set())
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSavingPago(false) }
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
      numero_orden:    envio.ventas ? formatVentaNum(envio.ventas) : `#${envio.numero ?? envio.id.slice(-6)}`,
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

  // ── ISS-167: Remito PDF con QR codes ─────────────────────────────────────────
  const generarRemito = async (envio: any) => {
    const doc = new jsPDF()
    const items = ventaItems as any[]
    const numVenta = envio.ventas ? formatVentaNum(envio.ventas) : null
    const numEnvio = `E-${envio.numero ?? envio.id.slice(-6)}`

    // QR codes — 35×35 mm, alta resolución
    let qrVenta = '', qrEnvio = ''
    try {
      if (numVenta) qrVenta = await QRCode.toDataURL(numVenta, { width: 140, margin: 1 })
      qrEnvio = await QRCode.toDataURL(numEnvio, { width: 140, margin: 1 })
    } catch { /* sin QR si falla */ }

    // ── Título ───────────────────────────────────────────────────────────────
    doc.setFontSize(17)
    doc.text('REMITO DE ENVÍO', 105, 18, { align: 'center' })

    // ── Header izquierdo (texto) ──────────────────────────────────────────────
    doc.setFontSize(10)
    doc.text(`${tenant?.nombre ?? BRAND.name}`, 15, 30)
    doc.text(`Envío ${numEnvio}`, 15, 37)
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 15, 44)
    if (envio.courier)
      doc.text(`Courier: ${envio.courier}${envio.servicio ? ` — ${envio.servicio}` : ''}`, 15, 51)
    if (envio.tracking_number)
      doc.text(`Tracking: ${envio.tracking_number}`, 15, 58)

    // ── QR #Envío — arriba a la derecha (bloque header) ──────────────────────
    if (qrEnvio) {
      doc.addImage(qrEnvio, 'PNG', 162, 8, 35, 35)
      doc.setFontSize(7)
      doc.setTextColor(100, 100, 100)
      doc.text('# Envío', 172, 46)
      doc.setTextColor(0, 0, 0)
    }

    // ── Separador ─────────────────────────────────────────────────────────────
    doc.setDrawColor(220, 220, 220)
    doc.line(15, 63, 195, 63)

    // ── DESTINATARIO (izquierda) ──────────────────────────────────────────────
    doc.setFontSize(11)
    doc.setFont(undefined as any, 'bold')
    doc.text('DESTINATARIO', 15, 72)
    doc.setFont(undefined as any, 'normal')
    doc.setFontSize(10)
    const cliente = envio.ventas?.clientes?.nombre ?? envio.destino_descripcion ?? '—'
    doc.text(cliente, 15, 80)

    const dom = envio.cliente_domicilios
    if (dom) {
      doc.text(`${dom.calle}${dom.numero ? ` ${dom.numero}` : ''}`, 15, 87)
      if (dom.ciudad) doc.text(`${dom.ciudad}${dom.provincia ? `, ${dom.provincia}` : ''}`, 15, 94)
    } else if (envio.destino_descripcion) {
      const lines = doc.splitTextToSize(envio.destino_descripcion, 135) as string[]
      doc.text(lines, 15, 87)
    }
    if (envio.fecha_entrega_acordada)
      doc.text(`Entrega: ${envio.fecha_entrega_acordada}`, 15, 101)

    // ── QR #Venta — a la derecha del bloque DESTINATARIO ─────────────────────
    if (qrVenta) {
      doc.addImage(qrVenta, 'PNG', 162, 64, 35, 35)
      doc.setFontSize(7)
      doc.setTextColor(100, 100, 100)
      doc.text('# Venta', 172, 101)
      doc.setTextColor(0, 0, 0)
    }

    // ── Separador ─────────────────────────────────────────────────────────────
    doc.setDrawColor(220, 220, 220)
    doc.line(15, 108, 195, 108)

    if (items.length > 0) {
      autoTable(doc, {
        startY: 113,
        head: [['Producto', 'SKU', 'LPN', 'Ubic.', 'Cant.', 'Precio unit.']],
        body: items.map((it: any) => [
          it.productos?.nombre ?? '—',
          it.productos?.sku ?? '—',
          (it.inventario_lineas as any)?.lpn ?? '—',
          (it.inventario_lineas as any)?.ubicaciones?.nombre ?? '—',
          it.cantidad,
          formatMoneda(it.precio_unitario ?? 0),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [100, 0, 200] },
        columnStyles: { 0: { cellWidth: 50 } },
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
    setVentaSeleccionada(null); setVentaSearch('')
    setDistanciaKm(null); setDireccionEntrega('')
    setShowModal(true)
  }
  const abrirEdicion = (e: any) => {
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
      pod_fecha: e.pod_fecha ?? '', pod_receptor: e.pod_receptor ?? '',
      pod_notas: e.pod_notas ?? '', pod_url: e.pod_url ?? '',
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
        {([
          { key: 'envios', label: 'Envíos', icon: <Package2 size={14} /> },
          { key: 'pagos',  label: 'Pagos Courier', icon: <CreditCard size={14} />, badge: (enviosPendientesPago as any[]).length || undefined },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-accent text-accent' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            {t.icon} {t.label}
            {'badge' in t && t.badge ? <span className="ml-1 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.badge}</span> : null}
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
                              {e.ventas?.numero && (
                                <span className="ml-1.5 text-xs text-gray-400">{formatVentaNum(e.ventas)}</span>
                              )}
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
                                  <button onClick={() => actualizarEstado.mutate({ id: e.id, estado: sigEstado, envio: e })}
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

                                  {/* ISS-168: Productos + LPN + Ubicación */}
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-1">
                                      <Tag size={11} /> Productos y ubicación en almacén
                                    </p>
                                    {(ventaItems as any[]).length === 0 ? (
                                      <p className="text-xs text-gray-400">Sin detalle de productos</p>
                                    ) : (
                                      <div className="space-y-2">
                                        {(ventaItems as any[]).map((it: any, i: number) => {
                                          const lpn = (it.inventario_lineas as any)?.lpn
                                          const ubic = (it.inventario_lineas as any)?.ubicaciones?.nombre
                                          return (
                                            <div key={i} className="text-xs">
                                              <span className="text-gray-700 dark:text-gray-300 font-medium">
                                                {it.cantidad}× {it.productos?.nombre ?? '—'}
                                              </span>
                                              {(lpn || ubic) && (
                                                <div className="flex items-center gap-3 mt-0.5 ml-3">
                                                  {lpn && <span className="flex items-center gap-1 text-accent font-mono bg-accent/10 px-1.5 py-0.5 rounded"><PackageCheck size={10} /> LPN: {lpn}</span>}
                                                  {ubic && <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400"><MapPin size={10} /> {ubic}</span>}
                                                </div>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {e.notas && (
                                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-600 pt-2">
                                    Notas: {e.notas}
                                  </p>
                                )}

                                {/* POD display — si ya tiene prueba de entrega */}
                                {(e.pod_fecha || e.pod_receptor || e.pod_notas) && (
                                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                                    <p className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1 mb-1.5">
                                      <ClipboardCheck size={12} /> Prueba de entrega (POD)
                                    </p>
                                    <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300">
                                      {e.pod_fecha && <span className="flex items-center gap-1"><Clock size={11} />{formatFecha(e.pod_fecha)}</span>}
                                      {e.pod_receptor && <span className="flex items-center gap-1"><UserIcon size={11} />Recibió: {e.pod_receptor}</span>}
                                      {e.pod_notas && <span className="text-gray-500 dark:text-gray-400">{e.pod_notas}</span>}
                                      {e.pod_url && (
                                        <a href={e.pod_url} target="_blank" rel="noreferrer"
                                          className="flex items-center gap-1 text-accent hover:underline">
                                          <Upload size={11} /> Ver comprobante
                                        </a>
                                      )}
                                    </div>
                                  </div>
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
                                  {/* ISS-165: Compartir link con transportista */}
                                  <button onClick={async () => {
                                    let token = e.token_transportista
                                    if (!token) {
                                      token = crypto.randomUUID()
                                      await supabase.from('envios').update({ token_transportista: token }).eq('id', e.id)
                                    }
                                    const url = `${import.meta.env.VITE_APP_URL || window.location.origin}/transporte/${token}`
                                    await navigator.clipboard.writeText(url).catch(() => {})
                                    toast.success('Link copiado al portapapeles 📋', { duration: 3000 })
                                  }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-violet-300 dark:border-violet-700 rounded-lg text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
                                    <Send size={13} /> Compartir con transportista
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
                                  {/* Registrar POD — disponible a partir de en_camino */}
                                  {(e.estado === 'en_camino' || e.estado === 'en_bodega' || e.estado === 'entregado') && (
                                    <button onClick={() => {
                                      setPodModalId(e.id)
                                      setPodForm({ pod_fecha: e.pod_fecha ?? '', pod_receptor: e.pod_receptor ?? '', pod_notas: e.pod_notas ?? '', pod_url: e.pod_url ?? '' })
                                    }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-green-300 dark:border-green-700 rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
                                      <ClipboardCheck size={13} /> {e.pod_fecha ? 'Actualizar POD' : 'Registrar POD'}
                                    </button>
                                  )}
                                  {/* Avanzar estado */}
                                  {ESTADO_SIGUIENTE[e.estado as EstadoEnvio] && e.estado !== 'en_bodega' && (
                                    <button
                                      onClick={() => actualizarEstado.mutate({ id: e.id, estado: ESTADO_SIGUIENTE[e.estado as EstadoEnvio]!, envio: e })}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors">
                                      <RefreshCw size={13} /> Marcar como {ESTADO_CFG[ESTADO_SIGUIENTE[e.estado as EstadoEnvio]!].label}
                                    </button>
                                  )}
                                  {/* En bodega: avanzar a Entregado */}
                                  {e.estado === 'en_bodega' && (
                                    <button onClick={() => {
                                      setPodModalId(e.id)
                                      setPodForm({ pod_fecha: new Date().toISOString().split('T')[0], pod_receptor: '', pod_notas: '', pod_url: '' })
                                    }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                      <ClipboardCheck size={13} /> Registrar entrega (POD)
                                    </button>
                                  )}
                                  {e.estado !== 'cancelado' && e.estado !== 'entregado' && (
                                    <button onClick={() => actualizarEstado.mutate({ id: e.id, estado: 'cancelado', envio: e })}
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


      {/* ══ TAB: PAGOS COURIER (ISS-169) ══ */}
      {tab === 'pagos' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1 flex items-center gap-2">
              <CreditCard size={16} className="text-accent" /> Pagos pendientes al courier
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Seleccioná los envíos a pagar, elegí el medio y marcá como pagados.
            </p>

            {/* Formulario de pago */}
            <div className="flex flex-wrap gap-3 items-end mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Medio de pago</label>
                <select value={pagoMedio} onChange={e => setPagoMedio(e.target.value)}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent">
                  {MEDIOS_PAGO_COURIER.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha de pago</label>
                <input type="date" value={pagoFecha} onChange={e => setPagoFecha(e.target.value)}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              </div>
              <div className="flex-1 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Seleccionados: <strong>{pagosSeleccion.size}</strong></p>
                  <p className="text-sm font-bold text-accent">
                    Total: ${(enviosPendientesPago as any[])
                      .filter(e => pagosSeleccion.has(e.id))
                      .reduce((s, e) => s + (e.costo_cotizado ?? 0), 0)
                      .toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <button onClick={marcarPagados} disabled={savingPago || pagosSeleccion.size === 0}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40 text-sm">
                  <CheckCircle size={16} /> {savingPago ? 'Guardando…' : 'Marcar como pagados'}
                </button>
              </div>
            </div>

            {/* Lista de envíos pendientes de pago */}
            {(enviosPendientesPago as any[]).length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <CreditCard size={36} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No hay pagos pendientes al courier</p>
                <p className="text-xs mt-1">Todos los envíos con costo están pagados.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
                    <tr>
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox"
                          checked={pagosSeleccion.size === (enviosPendientesPago as any[]).length && (enviosPendientesPago as any[]).length > 0}
                          onChange={e => {
                            if (e.target.checked) setPagosSeleccion(new Set((enviosPendientesPago as any[]).map((x: any) => x.id)))
                            else setPagosSeleccion(new Set())
                          }}
                          className="accent-accent" />
                      </th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300"># Envío</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">Venta</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">Courier</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">Estado</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {(enviosPendientesPago as any[]).map((e: any) => (
                      <tr key={e.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${pagosSeleccion.has(e.id) ? 'bg-accent/5' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={pagosSeleccion.has(e.id)}
                            onChange={ev => {
                              const next = new Set(pagosSeleccion)
                              ev.target.checked ? next.add(e.id) : next.delete(e.id)
                              setPagosSeleccion(next)
                            }}
                            className="accent-accent" />
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">#{e.numero}</td>
                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                          {e.ventas ? formatVentaNum(e.ventas) : '—'}
                          {e.ventas?.clientes?.nombre && <span className="ml-1 text-xs text-gray-400">· {e.ventas.clientes.nombre}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{e.courier ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_CFG[e.estado as EstadoEnvio]?.color ?? ''}`}>
                            {ESTADO_CFG[e.estado as EstadoEnvio]?.label ?? e.estado}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-800 dark:text-gray-100">
                          ${Number(e.costo_cotizado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <td colSpan={5} className="px-3 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 text-right">Total pendiente</td>
                      <td className="px-3 py-2.5 text-right font-bold text-primary">
                        ${(enviosPendientesPago as any[]).reduce((s, e) => s + (e.costo_cotizado ?? 0), 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
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
                        Venta {formatVentaNum(ventaSeleccionada)} — {ventaSeleccionada.clientes?.nombre ?? '—'} — {formatMoneda(ventaSeleccionada.total ?? 0)}
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
                            {formatVentaNum(v)} — {v.clientes?.nombre ?? 'Sin cliente'} — {formatMoneda(v.total ?? 0)}
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
                <div className="space-y-1">
                  {(domiciliosCliente as any[]).map((d: any) => (
                    <div key={d.id}>
                      <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
                        ${form.destino_id === d.id ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-600 hover:border-accent/40'}`}>
                        <input type="radio" checked={form.destino_id === d.id}
                          onChange={() => {
                            setForm(f => ({ ...f, destino_id: d.id, destino_descripcion: `${d.calle}${d.numero ? ` ${d.numero}` : ''}${d.piso_depto ? `, ${d.piso_depto}` : ''}, ${d.ciudad ?? ''} ${d.provincia ?? ''} ${d.codigo_postal ?? ''}`.trim() }))
                            setEditandoDomId(null)
                          }} className="accent-accent mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {d.nombre && <span className="text-xs font-semibold text-accent">{d.nombre} </span>}
                          <span className="text-sm text-gray-800 dark:text-gray-100">{d.calle}{d.numero ? ` ${d.numero}` : ''}{d.piso_depto ? `, ${d.piso_depto}` : ''}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{[d.ciudad, d.provincia, d.codigo_postal].filter(Boolean).join(' · ')}</p>
                        </div>
                        <button type="button"
                          onClick={e => { e.preventDefault(); setEditandoDomId(editandoDomId === d.id ? null : d.id); setShowNuevoDom(false) }}
                          className="p-1 text-gray-400 hover:text-accent flex-shrink-0 transition-colors" title="Editar dirección">
                          <Pencil size={13} />
                        </button>
                      </label>
                      {/* Formulario inline de edición */}
                      {editandoDomId === d.id && (() => {
                        const [localDom, setLocalDom] = useState({ nombre: d.nombre ?? '', calle: d.calle ?? '', numero: d.numero ?? '', piso_depto: d.piso_depto ?? '', ciudad: d.ciudad ?? '', provincia: d.provincia ?? '', codigo_postal: d.codigo_postal ?? '' })
                        return (
                          <div className="mt-1 mb-1 border border-accent/30 rounded-xl p-3 bg-accent/5 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <input value={localDom.nombre} onChange={e => setLocalDom(f => ({ ...f, nombre: e.target.value }))} placeholder="Alias" className="col-span-2 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.calle} onChange={e => setLocalDom(f => ({ ...f, calle: e.target.value }))} placeholder="Calle *" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.numero} onChange={e => setLocalDom(f => ({ ...f, numero: e.target.value }))} placeholder="Número" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.piso_depto} onChange={e => setLocalDom(f => ({ ...f, piso_depto: e.target.value }))} placeholder="Piso / Depto" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.codigo_postal} onChange={e => setLocalDom(f => ({ ...f, codigo_postal: e.target.value }))} placeholder="CP" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.ciudad} onChange={e => setLocalDom(f => ({ ...f, ciudad: e.target.value }))} placeholder="Ciudad" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                              <input value={localDom.provincia} onChange={e => setLocalDom(f => ({ ...f, provincia: e.target.value }))} placeholder="Provincia" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button type="button" onClick={() => setEditandoDomId(null)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400">Cancelar</button>
                              <button type="button" onClick={() => saveDomicilio.mutate({ id: d.id, data: localDom })} disabled={!localDom.calle || saveDomicilio.isPending} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg font-medium disabled:opacity-50">{saveDomicilio.isPending ? 'Guardando…' : 'Guardar'}</button>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  ))}

                  {/* Agregar nueva dirección (solo si hay cliente) */}
                  {ventaSeleccionada?.clientes?.id && !showNuevoDom && (
                    <button type="button" onClick={() => { setShowNuevoDom(true); setEditandoDomId(null) }}
                      className="w-full flex items-center gap-1.5 p-2.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-accent hover:text-accent transition-colors">
                      <Plus size={14} /> Agregar nueva dirección
                    </button>
                  )}
                  {showNuevoDom && (
                    <div className="border border-accent/30 rounded-xl p-3 bg-accent/5 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={domForm.nombre} onChange={e => setDomForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Alias (ej: Casa)" className="col-span-2 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.calle} onChange={e => setDomForm(f => ({ ...f, calle: e.target.value }))} placeholder="Calle *" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.numero} onChange={e => setDomForm(f => ({ ...f, numero: e.target.value }))} placeholder="Número" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.piso_depto} onChange={e => setDomForm(f => ({ ...f, piso_depto: e.target.value }))} placeholder="Piso / Depto" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.codigo_postal} onChange={e => setDomForm(f => ({ ...f, codigo_postal: e.target.value }))} placeholder="CP" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.ciudad} onChange={e => setDomForm(f => ({ ...f, ciudad: e.target.value }))} placeholder="Ciudad" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                        <input value={domForm.provincia} onChange={e => setDomForm(f => ({ ...f, provincia: e.target.value }))} placeholder="Provincia" className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setShowNuevoDom(false)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400">Cancelar</button>
                        <button type="button" onClick={() => saveDomicilio.mutate({ data: domForm })} disabled={!domForm.calle || saveDomicilio.isPending} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg font-medium disabled:opacity-50">{saveDomicilio.isPending ? 'Guardando…' : 'Guardar'}</button>
                      </div>
                    </div>
                  )}

                  {/* Opción manual */}
                  <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors
                    ${form.destino_id === '' ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-600 hover:border-accent/40'}`}>
                    <input type="radio" checked={form.destino_id === ''}
                      onChange={() => { setForm(f => ({ ...f, destino_id: '' })); setShowNuevoDom(false) }} className="accent-accent" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">Ingresar domicilio manualmente</span>
                  </label>
                  {form.destino_id === '' && !showNuevoDom && (
                    <textarea value={form.destino_descripcion} onChange={e => setForm(f => ({ ...f, destino_descripcion: e.target.value }))}
                      placeholder="Calle, número, ciudad, provincia, CP" rows={2}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  )}
                </div>
              </div>

              {/* Tipo de envío */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipo de envío</label>
                <div className="flex gap-2">
                  {(['propio', 'tercero'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTipoEnvio(t)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors
                        ${tipoEnvio === t ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent/50'}`}>
                      {t === 'propio' ? '🚗 Envío propio' : '📦 Courier / tercero'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dirección de entrega — solo para envío propio */}
              {tipoEnvio === 'propio' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Dirección de entrega
                      {!sucursalActiva?.direccion && (
                        <span className="ml-2 text-xs text-amber-500">⚠ Configurá la dirección de la sucursal para calcular distancia</span>
                      )}
                    </label>
                    <AddressAutocompleteInput
                      value={direccionEntrega}
                      onChange={setDireccionEntrega}
                      onPlaceSelected={(addr) => {
                        setDireccionEntrega(addr)
                        setForm(f => ({ ...f, destino_descripcion: addr }))
                        calcularKmAuto(addr)
                      }}
                      savedAddresses={domiciliosFormateados}
                      placeholder="Escribí la dirección de entrega…"
                    />
                  </div>
                  {/* Resultado del cálculo */}
                  <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-3">
                    {calculandoKm ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 size={14} className="animate-spin" /> Calculando distancia…
                      </div>
                    ) : distanciaKm !== null ? (
                      <>
                        <Navigation size={14} className="text-accent flex-shrink-0" />
                        <div className="flex-1 text-sm">
                          <span className="font-semibold text-primary">{distanciaKm} km</span>
                          <span className="text-gray-400 mx-1">×</span>
                          <span className="text-gray-600 dark:text-gray-400">${Number(sucursalActiva?.costo_km_envio || (tenant as any)?.costo_envio_por_km || 0).toLocaleString('es-AR')}/km</span>
                          <span className="text-gray-400 mx-1">=</span>
                          <span className="font-semibold text-accent">${(distanciaKm * (sucursalActiva?.costo_km_envio || (tenant as any)?.costo_envio_por_km || 0)).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
                        </div>
                        {!sucursalActiva?.costo_km_envio && !(tenant as any)?.costo_envio_por_km && (
                          <span className="text-xs text-amber-500">Configurá el costo/km en Config → Envíos</span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-gray-400">Ingresá la dirección para calcular distancia y costo automáticamente</span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* Courier — solo tercero */}
                <div className={tipoEnvio === 'propio' ? 'hidden' : ''}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Courier</label>
                  <div className="relative">
                    <select value={form.courier} onChange={e => handleCourierChange(e.target.value)}
                      className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      <option value="">Sin especificar</option>
                      {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                {/* Servicio — solo tercero */}
                <div className={tipoEnvio === 'propio' ? 'hidden' : ''}>
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
                {/* Canal — auto-populado desde la venta, read-only si viene de una venta */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Canal de venta
                    {ventaSeleccionada && <span className="ml-1 text-xs text-gray-400">(de la venta)</span>}
                  </label>
                  {ventaSeleccionada ? (
                    <div className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400">
                      {form.canal || 'POS'}
                    </div>
                  ) : (
                    <div className="relative">
                      <select value={form.canal} onChange={e => setForm(f => ({ ...f, canal: e.target.value }))}
                        className="w-full appearance-none border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  )}
                </div>
                {/* Costo — solo para tercero (propio calcula automáticamente arriba) */}
                <div className={tipoEnvio === 'propio' ? 'hidden' : ''}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Costo de envío ($)
                    {form.courier && (courierTarifas as any[]).find(t => t.courier === form.courier) && (
                      <span className="ml-1 text-xs text-accent">(tarifa configurada)</span>
                    )}
                  </label>
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

              {/* POD — Prueba de entrega (solo en edición) */}
              {editId && (
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
                    <ClipboardCheck size={15} className="text-green-500" /> Prueba de entrega (POD)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha real de entrega</label>
                      <input type="date" value={form.pod_fecha} onChange={e => setForm(f => ({ ...f, pod_fecha: e.target.value }))}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nombre de quien recibió</label>
                      <input type="text" value={form.pod_receptor} onChange={e => setForm(f => ({ ...f, pod_receptor: e.target.value }))}
                        placeholder="Ej: Juan García"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">URL comprobante / foto</label>
                      <input type="text" value={form.pod_url} onChange={e => setForm(f => ({ ...f, pod_url: e.target.value }))}
                        placeholder="https://... (link a foto o documento firmado)"
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Observaciones de entrega</label>
                      <textarea value={form.pod_notas} onChange={e => setForm(f => ({ ...f, pod_notas: e.target.value }))}
                        placeholder="Notas adicionales sobre la entrega…" rows={2}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                  </div>
                </div>
              )}
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
      {/* ══ MODAL: REGISTRAR POD ══ */}
      {podModalId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <ClipboardCheck size={18} className="text-green-500" /> Prueba de entrega (POD)
              </h2>
              <button onClick={() => setPodModalId(null)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Completá los datos de entrega. Al guardar, el estado del envío se actualizará a <strong>Entregado</strong>.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha real de entrega</label>
                <input type="date" value={podForm.pod_fecha} onChange={e => setPodForm(f => ({ ...f, pod_fecha: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <UserIcon size={13} className="inline mr-1" />Nombre de quien recibió
                </label>
                <input type="text" value={podForm.pod_receptor} onChange={e => setPodForm(f => ({ ...f, pod_receptor: e.target.value }))}
                  placeholder="Ej: Juan García"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comprobante / foto</label>
                {/* ISS-166: input cámara oculto */}
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                  onChange={handleFotoCapture} className="hidden" />
                <div className="flex gap-2">
                  <input type="text" value={podForm.pod_url} onChange={e => setPodForm(f => ({ ...f, pod_url: e.target.value }))}
                    placeholder="https://... (link o pegá una URL)"
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  <button type="button" onClick={() => cameraInputRef.current?.click()}
                    disabled={uploadingFoto}
                    title="Tomar foto con la cámara"
                    className="flex items-center gap-1.5 px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-xl text-sm font-medium transition-colors disabled:opacity-50 border border-accent/20">
                    {uploadingFoto ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    {uploadingFoto ? 'Subiendo…' : 'Foto'}
                  </button>
                </div>
                {podForm.pod_url && (
                  <a href={podForm.pod_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1">
                    <ExternalLink size={11} /> Ver comprobante
                  </a>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observaciones</label>
                <textarea value={podForm.pod_notas} onChange={e => setPodForm(f => ({ ...f, pod_notas: e.target.value }))}
                  placeholder="Condición del paquete, horario real de entrega, etc." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setPodModalId(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={savePod} disabled={savingPod}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {savingPod ? 'Guardando…' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
