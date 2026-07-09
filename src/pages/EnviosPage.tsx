import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Package2, Plus, ChevronRight, Search, X, Printer,
  ExternalLink, MapPin, Truck, Clock, CheckCircle, RotateCcw,
  AlertTriangle, Send, Scale, Ruler, ChevronDown, Pencil, Trash2,
  FileText, RefreshCw, Navigation, Loader2, Warehouse, ClipboardCheck, Upload, User as UserIcon,
  Camera, CreditCard, DollarSign, PackageCheck, QrCode, Tag, BarChart3, Fuel, Car,
} from 'lucide-react'
import { AddressAutocompleteInput } from '@/components/AddressAutocompleteInput'
import { PageTabs } from '@/components/PageTabs'
import PodFotosManager from '@/components/PodFotosManager'
import { calcularDistanciaKm } from '@/hooks/useGoogleMaps'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { buildWhatsAppUrl, expandirPlantilla, PLANTILLA_DEFAULT } from '@/lib/whatsapp'
import { COURIERS, SERVICIOS_POR_COURIER, esCourierApi } from '@/lib/couriers/catalogo'
import { cotizarEnvio, generarEnvioCourier, trackingEnvioCourier, type CotizacionOpcion } from '@/lib/couriers/api'
import { requiereDobleFirma, diffFactura } from '@/lib/enviosCourierPago'
import SignaturePad from '@/components/SignaturePad'
import { podFaltantes, SUBESTADOS_NO_ENTREGA, resolverNoEntrega, type SubestadoNoEntrega } from '@/lib/enviosPod'
import { productividadRepartidor, cumplimientoDia, ordenarHojaRuta, tokenExpiraAt } from '@/lib/enviosReparto'
import { costoEnvioPropio, diferenciaReal, DIFERENCIA_MOTIVOS } from '@/lib/enviosTarifas'
import { TIPOS_ENVIO, sugerirCourierPorCp, plazoDespachoVencido } from '@/lib/enviosCreacion'
import { costoCombustible, kmAcumuladoNuevo, desgloseIvaCombustible } from '@/lib/enviosRecurso'
import { generarEtiquetasA4PDF, type EtiquetaEnvio, type EtiquetasPorHoja } from '@/lib/etiquetasEnvioPDF'
import EnviosReportesPanel from '@/components/EnviosReportesPanel'
import toast from 'react-hot-toast'
import { BRAND } from '@/config/brand'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type EstadoEnvio = 'pendiente' | 'despachado' | 'en_camino' | 'en_bodega' | 'entregado' | 'devolucion' | 'cancelado'
type TabEnvio = 'envios' | 'pagos' | 'facturas' | 'reparto' | 'reportes'

const MEDIOS_PAGO_COURIER = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro']

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
  // ISS-178 — Rango horario: índice del array tenant.envio_rangos_horarios o '' para sin definir
  rango_horario_idx: string
  // POD — Prueba de entrega
  pod_fecha: string; pod_receptor: string; pod_notas: string; pod_url: string
  // EN3 — repartidor asignado (envío propio)
  repartidor_id: string
  // EN5 — tipo de envío (A2) + motivo + sucursal destino (traslado interno)
  tipo: string; motivo: string; sucursal_destino_id: string
  // EN7/G2 — vehículo (recurso) + km del envío propio
  recurso_id: string; km_recorridos: string
}
const FORM_VACIO: FormEnvio = {
  venta_id: '', cliente_nombre: '',
  courier: '', servicio: '', tracking_number: '', tracking_url: '',
  canal: 'POS', destino_id: '', destino_descripcion: '',
  peso_kg: '', largo_cm: '', ancho_cm: '', alto_cm: '',
  costo_cotizado: '', fecha_entrega_acordada: '', hora_entrega_acordada: '',
  zona_entrega: '', notas: '',
  pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '',
  rango_horario_idx: '', repartidor_id: '',
  tipo: 'venta', motivo: '', sucursal_destino_id: '',
  recurso_id: '', km_recorridos: '',
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
  // ISS-174 F2 — cotización por API de courier
  const [cotizando, setCotizando]   = useState(false)
  const [cotizaciones, setCotizaciones] = useState<CotizacionOpcion[]>([])
  const [destinoCpManual, setDestinoCpManual] = useState('')
  const [generandoId, setGenerandoId] = useState<string | null>(null)
  const [trackingId, setTrackingId]   = useState<string | null>(null)
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
  // EN5/A5 — desglose de ítems que van en este envío (editable)
  const [ventaItemsForm, setVentaItemsForm] = useState<Array<{ producto_id: string | null; nombre: string; cantidad: number; lpn: string | null }>>([])

  // POD modal — registrar prueba de entrega desde la fila expandida
  const [podModalId, setPodModalId]   = useState<string | null>(null)
  const [podForm, setPodForm]         = useState({ pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '', pod_dni: '' })
  const [savingPod, setSavingPod]     = useState(false)
  // EN2 — firma + conteo de fotos para validación de POD
  const [podFirmaDataUrl, setPodFirmaDataUrl] = useState<string | null>(null)
  const [podFirmaUrlExistente, setPodFirmaUrlExistente] = useState<string | null>(null)
  const [podFotosCount, setPodFotosCount] = useState(0)
  // EN2/D5 — modal "No entregado" (operador)
  const [noEntregaId, setNoEntregaId] = useState<string | null>(null)
  const [noEntregaSub, setNoEntregaSub] = useState<SubestadoNoEntrega>('ausente')
  const [noEntregaMotivo, setNoEntregaMotivo] = useState('')
  const [savingNoEntrega, setSavingNoEntrega] = useState(false)
  // EN4/B6 — modal "Registrar costo real" (diferencia vs cotizado)
  const [diffEnvio, setDiffEnvio] = useState<any | null>(null)
  const [diffCostoReal, setDiffCostoReal] = useState('')
  const [diffMotivo, setDiffMotivo] = useState<string>(DIFERENCIA_MOTIVOS[0])
  const [savingDiff, setSavingDiff] = useState(false)
  // ISS-166 (v1.8.40): el upload de foto del POD se delegó al componente PodFotosManager (migration 144).

  // ISS-169: Pagos courier
  const [pagosSeleccion, setPagosSeleccion] = useState<Set<string>>(new Set())
  const [pagoMedio, setPagoMedio]           = useState('Transferencia')
  const [pagoFecha, setPagoFecha]           = useState(new Date().toISOString().split('T')[0])
  const [savingPago, setSavingPago]         = useState(false)
  // EN1/C4 — doble firma por umbral
  const [pagoClaveMaestra, setPagoClaveMaestra] = useState('')

  // EN1/C3 — factura del courier (conciliación)
  const [factForm, setFactForm] = useState({ courier: '', nro_factura: '', periodo_desde: '', periodo_hasta: '', total_facturado: '', notas: '' })
  const [factArchivo, setFactArchivo] = useState<File | null>(null)
  const [savingFact, setSavingFact] = useState(false)
  const factFileRef = useRef<HTMLInputElement>(null)

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
      // EN5/A5 — ya NO se excluyen las ventas con envío (se permite dividir en varios envíos);
      // se marca cuántos envíos tiene cada una para que el operador lo sepa.
      const { data: conEnvio } = await supabase
        .from('envios').select('venta_id').eq('tenant_id', tenant!.id).not('venta_id', 'is', null)
      const cuentaEnvios = new Map<string, number>()
      for (const e of (conEnvio ?? []) as any[]) {
        if (e.venta_id) cuentaEnvios.set(e.venta_id, (cuentaEnvios.get(e.venta_id) ?? 0) + 1)
      }
      let q = supabase.from('ventas')
        .select('id, numero, numero_sucursal, sucursal_id, total, costo_envio, estado, origen, created_at, cliente_id, clientes(nombre, id)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'reservada'])
        .order('created_at', { ascending: false })
        .limit(20)
      if (ventaSearch) {
        const n = parseInt(ventaSearch)
        if (!isNaN(n)) q = q.eq('numero', n)
      }
      const { data } = await q
      return (data ?? []).map((v: any) => ({ ...v, _nEnvios: cuentaEnvios.get(v.id) ?? 0 }))
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
      // ISS-175: solo pagos a COURIER (tercero) pendientes. Envío propio nunca se le paga a un courier;
      // y los envíos cuyo costo ya cobró el cliente en la venta vienen con costo_pagado=true.
      let q = supabase.from('envios')
        .select('id, numero, courier, costo_cotizado, estado, created_at, sucursal_id, ventas(numero, numero_sucursal, sucursal_id, clientes(nombre))')
        .eq('tenant_id', tenant!.id)
        .eq('costo_pagado', false)
        .gt('costo_cotizado', 0)
        .neq('courier', 'Envío propio')
        .order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && (tab === 'pagos' || tab === 'facturas'),
  })

  // EN1/C2 — categoría de gasto "Transporte y fletes" (predefinida, mig 130) para el gasto auto del courier
  const { data: categoriaFleteId } = useQuery({
    queryKey: ['categoria-flete', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias_gasto')
        .select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Transporte y fletes').maybeSingle()
      return data?.id ?? null
    },
    enabled: !!tenant && (tab === 'pagos' || tab === 'facturas'),
  })

  // EN7/G2 — categoría de gasto "Combustible" (predefinida, mig 130/194) para el gasto del envío propio
  const { data: categoriaCombustibleId } = useQuery({
    queryKey: ['categoria-combustible', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias_gasto')
        .select('id').eq('tenant_id', tenant!.id).eq('nombre', 'Combustible').maybeSingle()
      return data?.id ?? null
    },
    enabled: !!tenant,
  })

  // EN7/G2 — modal de combustible: envío + monto estimado editable
  const [combustibleEnvio, setCombustibleEnvio] = useState<any | null>(null)
  const [combustibleMonto, setCombustibleMonto] = useState('')
  const [combustibleKm, setCombustibleKm] = useState('')
  const [savingCombustible, setSavingCombustible] = useState(false)

  const abrirCombustible = (e: any) => {
    const veh = (vehiculos as any[]).find(v => v.id === e.recurso_id)
    const km = Number(e.km_recorridos) || 0
    const estimado = costoCombustible(km, {
      consumoLitros100km: veh?.consumo_litros_100km,
      precioLitro: (tenant as any)?.envio_combustible_precio_litro,
    })
    setCombustibleEnvio(e)
    setCombustibleKm(km ? String(km) : '')
    setCombustibleMonto(estimado > 0 ? String(estimado) : '')
  }

  const registrarCombustible = async () => {
    if (!combustibleEnvio) return
    const monto = parseFloat(combustibleMonto) || 0
    const km = parseFloat(combustibleKm) || 0
    if (monto <= 0) { toast.error('Ingresá el monto del combustible'); return }
    const veh = (vehiculos as any[]).find(v => v.id === combustibleEnvio.recurso_id)
    setSavingCombustible(true)
    try {
      const ivaPct = Number((tenant as any)?.envio_courier_iva_pct ?? 21)
      const { iva } = desgloseIvaCombustible(monto, ivaPct)
      const { data: gastoIns, error: gErr } = await supabase.from('gastos').insert({
        tenant_id: tenant!.id,
        descripcion: `Combustible — envío #${combustibleEnvio.numero ?? combustibleEnvio.id.slice(-6)}${veh ? ` (${veh.nombre})` : ''}`,
        monto,
        categoria: 'Combustible',
        categoria_id: categoriaCombustibleId ?? null,
        recurso_id: combustibleEnvio.recurso_id ?? null,
        tipo_iva: ivaPct > 0 ? String(ivaPct) : null,
        iva_monto: iva > 0 ? iva : null,
        alicuota_iva: ivaPct > 0 ? ivaPct : null,
        iva_deducible: ivaPct > 0,
        deduce_ganancias: true,
        gasto_negocio: true,
        medio_pago: JSON.stringify([{ tipo: 'Efectivo', monto }]),
        fecha: new Date().toISOString().split('T')[0],
        sucursal_id: combustibleEnvio.sucursal_id ?? null,
        usuario_id: user?.id ?? null,
        monto_pagado: monto,
        estado_pago: 'pagado',
        notas: `Combustible del envío propio (${km} km)`,
      }).select('id').single()
      if (gErr) throw gErr
      // suma KM al vehículo + link al gasto
      if (combustibleEnvio.recurso_id && veh) {
        await supabase.from('recursos').update({ km_acumulado: kmAcumuladoNuevo(veh.km_acumulado, km) }).eq('id', combustibleEnvio.recurso_id)
      }
      await supabase.from('envios').update({ gasto_combustible_id: gastoIns.id, km_recorridos: km || combustibleEnvio.km_recorridos || null }).eq('id', combustibleEnvio.id)
      toast.success('Combustible registrado como gasto')
      qc.invalidateQueries({ queryKey: ['envios'] })
      qc.invalidateQueries({ queryKey: ['vehiculos-envio'] })
      qc.invalidateQueries({ queryKey: ['gastos'] })
      setCombustibleEnvio(null)
    } catch (e: any) { toast.error(e.message ?? 'Error al registrar combustible') }
    finally { setSavingCombustible(false) }
  }

  // EN1/C2 — sesión de caja abierta del usuario en la sucursal (para egreso si paga efectivo)
  const { data: sesionCajaPago } = useQuery({
    queryKey: ['caja-sesion-pago-courier', tenant?.id, sucursalId, user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, usuario_id, cajas(sucursal_id, es_caja_fuerte)')
        .eq('tenant_id', tenant!.id).is('cerrada_at', null)
      const abiertas = (data ?? []).filter((s: any) => s.cajas?.sucursal_id === sucursalId && !s.cajas?.es_caja_fuerte)
      return abiertas.find((s: any) => s.usuario_id === user?.id)?.id ?? abiertas[0]?.id ?? null
    },
    enabled: !!tenant && !!sucursalId && tab === 'pagos',
  })

  // EN3/G1 — repartidores activos (asignación + reparto)
  const { data: repartidores = [] } = useQuery({
    queryKey: ['repartidores-envio', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('repartidores')
        .select('id, nombre, telefono, vehiculo, activo').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // EN7/G2 — vehículos (recursos activos) para asociar al envío propio + auto-gasto combustible
  const { data: vehiculos = [] } = useQuery({
    queryKey: ['vehiculos-envio', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('recursos')
        .select('id, nombre, categoria, estado, consumo_litros_100km, km_acumulado')
        .eq('tenant_id', tenant!.id).eq('estado', 'activo').order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // EN3/G3 — hoja de ruta (estado de la pestaña Reparto)
  const [hrFecha, setHrFecha] = useState(new Date().toISOString().split('T')[0])
  const [hrRepartidor, setHrRepartidor] = useState('')
  const [hrGuardando, setHrGuardando] = useState(false)
  const [etqPorHoja, setEtqPorHoja] = useState<EtiquetasPorHoja>(6)

  const { data: enviosReparto = [] } = useQuery({
    queryKey: ['envios-reparto', tenant?.id, sucursalId, hrFecha, hrRepartidor],
    queryFn: async () => {
      let q = supabase.from('envios')
        .select('id, numero, estado, repartidor_id, zona_entrega, hora_entrega_acordada, fecha_entrega_acordada, token_transportista, ventas(numero, numero_sucursal, sucursal_id, clientes(nombre, telefono)), cliente_domicilios(calle, numero, ciudad)')
        .eq('tenant_id', tenant!.id)
        .eq('courier', 'Envío propio')
        .order('hora_entrega_acordada', { ascending: true })
      q = applyFilter(q)
      if (hrRepartidor) q = q.eq('repartidor_id', hrRepartidor)
      const { data } = await q
      // filtrar por fecha de entrega acordada = hrFecha (o sin fecha)
      return (data ?? []).filter((e: any) => !hrFecha || !e.fecha_entrega_acordada || e.fecha_entrega_acordada === hrFecha)
    },
    enabled: !!tenant && tab === 'reparto',
  })

  // EN1/C3 — facturas del courier cargadas (conciliación)
  const { data: courierFacturas = [] } = useQuery({
    queryKey: ['courier-facturas', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('courier_facturas')
        .select('*, courier_factura_lineas(id, envio_id, monto_registrado, monto_facturado)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
      q = applyFilter(q)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'facturas',
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
        // EN4/B1-B3 — motor de tarifas: factor KM + costo mínimo + tramos + recargo horario
        const costo = costoEnvioPropio(km, {
          costoKm,
          factorKm: (tenant as any)?.envio_factor_km,
          costoMinimo: (tenant as any)?.envio_costo_minimo,
          tramos: (tenant as any)?.envio_tramos,
          recargoHorario: (tenant as any)?.envio_recargo_horario,
        }, form.hora_entrega_acordada || null)
        if (costo > 0) setForm(f => ({ ...f, costo_cotizado: String(costo) }))
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
    setCotizaciones([])
  }

  // ISS-174 — CP de destino: del domicilio elegido o ingreso manual
  const destinoCp = (() => {
    const dom = (domiciliosCliente as any[]).find(d => d.id === form.destino_id)
    return dom?.codigo_postal || destinoCpManual.trim()
  })()
  const origenCp = (sucursalActiva as any)?.codigo_postal || ''

  const handleCotizar = async () => {
    if (!form.courier) { toast.error('Elegí un courier'); return }
    if (!esCourierApi(form.courier)) { toast.error(`${form.courier} todavía no tiene cotización por API`); return }
    if (!origenCp) { toast.error('La sucursal de origen no tiene código postal (cargalo en Sucursales)'); return }
    if (!destinoCp) { toast.error('Falta el código postal de destino'); return }
    setCotizando(true); setCotizaciones([])
    try {
      const ops = await cotizarEnvio({
        courier: form.courier, origen_cp: origenCp, destino_cp: destinoCp,
        peso_kg: parseFloat(form.peso_kg) || 1,
        largo_cm: form.largo_cm ? parseFloat(form.largo_cm) : undefined,
        ancho_cm: form.ancho_cm ? parseFloat(form.ancho_cm) : undefined,
        alto_cm: form.alto_cm ? parseFloat(form.alto_cm) : undefined,
      })
      setCotizaciones(ops)
      if (ops.length === 0) toast('Sin opciones para ese destino', { icon: 'ℹ️' })
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al cotizar')
    } finally { setCotizando(false) }
  }

  const elegirCotizacion = (op: CotizacionOpcion) => {
    setForm(f => ({ ...f, servicio: op.servicio, costo_cotizado: String(op.precio) }))
    toast.success(`Servicio "${op.servicio}" — $${op.precio.toLocaleString('es-AR')}`)
  }

  const handleGenerarCourier = async (envioId: string) => {
    setGenerandoId(envioId)
    try {
      const r = await generarEnvioCourier(envioId)
      toast.success(r.tracking_number ? `Orden generada · tracking ${r.tracking_number}` : 'Orden generada')
      qc.invalidateQueries({ queryKey: ['envios'] })
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al generar la orden')
    } finally { setGenerandoId(null) }
  }

  const handleActualizarTracking = async (envioId: string) => {
    setTrackingId(envioId)
    try {
      const r = await trackingEnvioCourier(envioId)
      toast.success(r.estado ? `Estado courier: ${r.estado}` : `${r.eventos.length} eventos de tracking`)
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al consultar tracking')
    } finally { setTrackingId(null) }
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveEnvio = useMutation({
    mutationFn: async () => {
      const payload: any = {
        tenant_id: tenant!.id,
        sucursal_id: sucursalId || null,
        venta_id: form.venta_id || null,
        // EN7/G2 — el select de courier queda oculto en envío propio y nunca cambia
        // form.courier: derivar 'Envío propio' de tipoEnvio en vez de confiar en el select.
        courier: tipoEnvio === 'propio' ? 'Envío propio' : (form.courier || null),
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
        // ISS-178 — snapshot del rango horario elegido (si se seleccionó)
        rango_horario_desde: (() => {
          const rangos: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
            ? (tenant as any).envio_rangos_horarios : []
          const r = form.rango_horario_idx !== '' ? rangos[Number(form.rango_horario_idx)] : null
          return r?.desde || null
        })(),
        rango_horario_hasta: (() => {
          const rangos: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
            ? (tenant as any).envio_rangos_horarios : []
          const r = form.rango_horario_idx !== '' ? rangos[Number(form.rango_horario_idx)] : null
          return r?.hasta || null
        })(),
        zona_entrega: form.zona_entrega.trim() || null,
        notas: form.notas.trim() || null,
        pod_fecha: form.pod_fecha || null,
        pod_receptor: form.pod_receptor.trim() || null,
        pod_notas: form.pod_notas.trim() || null,
        pod_url: form.pod_url.trim() || null,
        repartidor_id: form.repartidor_id || null,
        // EN5/A2 — tipo de envío + motivo + sucursal destino (traslado interno)
        tipo: form.tipo || 'venta',
        motivo: form.motivo.trim() || null,
        sucursal_destino_id: form.tipo === 'traslado_interno' ? (form.sucursal_destino_id || null) : null,
        // EN7/G2 — vehículo (recurso) + km del envío propio
        recurso_id: tipoEnvio === 'propio' ? (form.recurso_id || null) : null,
        km_recorridos: form.km_recorridos ? parseFloat(form.km_recorridos) : (distanciaKm ?? null),
        created_by: user?.id,
      }
      if (editId) {
        const { error } = await supabase.from('envios').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        // ISS-156: si el costo del envío ya lo cobró el cliente en la venta despachada,
        // o si es envío propio (sin courier a quien pagar), nace saldado → no va a Pagos Courier.
        const envioYaSaldado = payload.courier === 'Envío propio'
          || (!!ventaSeleccionada && Number(ventaSeleccionada.costo_envio ?? 0) > 0 && ventaSeleccionada.estado === 'despachada')
        const { data: nuevo, error } = await supabase.from('envios').insert({ ...payload, costo_pagado: envioYaSaldado }).select('id').single()
        if (error) throw error
        // EN5/A5 — desglose: persistir qué ítems se fueron en este envío (de la venta)
        if (nuevo?.id && ventaSeleccionada?.id && (ventaItemsForm as any[]).length > 0) {
          const filas = (ventaItemsForm as any[])
            .filter(it => Number(it.cantidad) > 0)
            .map(it => ({ tenant_id: tenant!.id, envio_id: nuevo.id, producto_id: it.producto_id ?? null, cantidad: Number(it.cantidad), lpn: it.lpn ?? null }))
          if (filas.length > 0) await supabase.from('envio_items').insert(filas)
        }
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
    onSuccess: (_, { estado, envio }) => {
      toast.success(`Estado: ${ESTADO_CFG[estado].label}`)
      qc.invalidateQueries({ queryKey: ['envios'] })
      // EN3/E5 — notificación "en camino" al cliente por WhatsApp (configurable)
      if (estado === 'en_camino') {
        const modo = (tenant as any)?.envio_notif_en_camino ?? 'wa'
        const tel = envio?.ventas?.clientes?.telefono
        if (modo !== 'no' && tel) {
          let msg = `¡Hola! Tu pedido ${envio.ventas ? formatVentaNum(envio.ventas) : `#${envio.numero ?? ''}`} de ${tenant?.nombre ?? BRAND.name} está en camino.`
          if (modo === 'wa_tracking' && envio.token_transportista) {
            msg += ` Seguí la entrega acá: ${(import.meta as any).env?.VITE_APP_URL ?? window.location.origin}/transporte/${envio.token_transportista}`
          }
          const url = buildWhatsAppUrl(tel, msg)
          if (url) window.open(url, '_blank', 'noopener')
        }
      }
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

  // EN2 — config POD del tenant (campos requeridos + mínimo de fotos)
  const podRequeridos = ((tenant as any)?.pod_campos_requeridos ?? { fecha: true, receptor: true }) as Record<string, boolean>
  const podFotoMin = Number((tenant as any)?.pod_foto_min ?? 0)

  // ── POD — guardar prueba de entrega (EN2/D1-D3) ──────────────────────────────
  const savePod = async () => {
    if (!podModalId) return
    // D1/D2 — validar campos requeridos configurados
    const faltan = podFaltantes(
      { fecha: podForm.pod_fecha, receptor: podForm.pod_receptor, dni: podForm.pod_dni,
        firma_url: podFirmaDataUrl ?? podFirmaUrlExistente, fotos: podFotosCount },
      podRequeridos, podFotoMin,
    )
    if (faltan.length > 0) { toast.error(`Faltan datos del POD: ${faltan.join(', ')}`); return }
    setSavingPod(true)
    try {
      // D3 — subir la firma (dataURL → storage) si se firmó en este modal
      let firmaUrl = podFirmaUrlExistente
      if (podFirmaDataUrl) {
        const blob = await (await fetch(podFirmaDataUrl)).blob()
        const path = `pod/${podModalId}/firma_${Date.now()}.png`
        const { error: upErr } = await supabase.storage.from('etiquetas-envios').upload(path, blob, { upsert: true, contentType: 'image/png' })
        if (!upErr) {
          const { data: signed } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
          firmaUrl = signed?.signedUrl ?? firmaUrl
        }
      }
      const { error } = await supabase.from('envios').update({
        pod_fecha:     podForm.pod_fecha || null,
        pod_receptor:  podForm.pod_receptor.trim() || null,
        pod_notas:     podForm.pod_notas.trim() || null,
        pod_url:       podForm.pod_url.trim() || null,
        pod_dni:       podForm.pod_dni.trim() || null,
        pod_firma_url: firmaUrl || null,
        estado:        'entregado',
      }).eq('id', podModalId)
      if (error) throw error
      toast.success('Prueba de entrega registrada')
      qc.invalidateQueries({ queryKey: ['envios'] })
      setPodModalId(null)
      setPodForm({ pod_fecha: '', pod_receptor: '', pod_notas: '', pod_url: '', pod_dni: '' })
      setPodFirmaDataUrl(null); setPodFirmaUrlExistente(null); setPodFotosCount(0)
    } catch (e: any) {
      toast.error(e.message ?? 'Error al guardar POD')
    } finally {
      setSavingPod(false)
    }
  }

  // ── EN2/D5+D6 — registrar "No entregado" (operador) ──────────────────────────
  const registrarNoEntrega = async () => {
    if (!noEntregaId) return
    if (!noEntregaMotivo.trim()) { toast.error('Indicá el motivo de la no entrega'); return }
    const envio = (envios as any[]).find(e => e.id === noEntregaId)
    const max = Number((tenant as any)?.envio_reintentos_max ?? 3)
    const r = resolverNoEntrega(Number(envio?.intentos ?? 0), max, noEntregaSub)
    setSavingNoEntrega(true)
    try {
      const { error } = await supabase.from('envios').update({
        estado: r.estado,
        intentos: r.nuevoIntentos,
        subestado_no_entrega: noEntregaSub,
        no_entrega_motivo: noEntregaMotivo.trim(),
      }).eq('id', noEntregaId)
      if (error) throw error
      toast.success(r.reintenta
        ? `Registrado — vuelve a "En camino" (intento ${r.nuevoIntentos}/${max})`
        : 'Registrado — pasa a Devolución')
      qc.invalidateQueries({ queryKey: ['envios'] })
      setNoEntregaId(null); setNoEntregaSub('ausente'); setNoEntregaMotivo('')
    } catch (e: any) { toast.error(e.message ?? 'Error al registrar') }
    finally { setSavingNoEntrega(false) }
  }


  // ── EN1/C2+C4: Marcar envíos pagados + gasto contable (solo courier tercero) ──
  const marcarPagados = async () => {
    if (pagosSeleccion.size === 0) { toast.error('Seleccioná al menos un envío'); return }
    setSavingPago(true)
    try {
      const seleccionados = (enviosPendientesPago as any[]).filter(e => pagosSeleccion.has(e.id))
      const totalPago = seleccionados.reduce((s, e) => s + Number(e.costo_cotizado ?? 0), 0)

      // C4 — doble firma: pre-check de UX (pedir la clave si hay umbral + clave configurada). El enforcement
      // REAL —incluido "supera el umbral pero NO hay clave configurada"— vive en el RPC marcar_envios_pagados.
      const umbral = Number((tenant as any)?.envio_pago_doble_firma_umbral ?? 0)
      if (requiereDobleFirma(totalPago, umbral) && (tenant as any)?.clave_maestra && !pagoClaveMaestra.trim()) {
        toast.error(`Este pago supera el umbral de doble firma ($${umbral.toLocaleString('es-AR')}): ingresá la clave maestra.`)
        setSavingPago(false); return
      }

      const generaGasto = (tenant as any)?.envio_courier_genera_gasto !== false
      const ivaPct = Number((tenant as any)?.envio_courier_iva_pct ?? 21)
      const esEfectivo = pagoMedio === 'Efectivo'

      // Pago atómico y clave-gated server-side (mig 238 marcar_envios_pagados): agrupa por courier, genera
      // un gasto por courier (con desglose de IVA) + su movimiento de caja y marca los envíos pagados, todo
      // en una sola transacción, con la doble firma verificada en el server.
      const { error } = await supabase.rpc('marcar_envios_pagados', {
        p_envio_ids: seleccionados.map(e => e.id),
        p_clave: pagoClaveMaestra.trim() || null,
        p_medio: pagoMedio,
        p_fecha: pagoFecha || null,
        p_caja_sesion_id: sesionCajaPago ?? null,
        p_genera_gasto: generaGasto,
        p_iva_pct: ivaPct,
        p_categoria_flete_id: categoriaFleteId ?? null,
      })
      if (error) throw error
      if (!sesionCajaPago && esEfectivo)
        toast(`⚠ Sin caja abierta — el egreso en efectivo no se registró en caja`, { icon: '⚠' })

      const n = seleccionados.length
      toast.success(`${n} envío${n > 1 ? 's' : ''} pagado${n > 1 ? 's' : ''}${generaGasto ? ' + gasto registrado' : ''}`)
      qc.invalidateQueries({ queryKey: ['envios-pendientes-pago'] })
      qc.invalidateQueries({ queryKey: ['envios'] })
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas'] })
      setPagosSeleccion(new Set())
      setPagoClaveMaestra('')
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSavingPago(false) }
  }

  // ── EN1/C3: Cargar factura del courier + conciliar contra lo registrado ───────
  const guardarFacturaCourier = async () => {
    if (!factForm.courier) { toast.error('Elegí el courier'); return }
    const totalFact = parseFloat(factForm.total_facturado) || 0
    setSavingFact(true)
    try {
      const desde = factForm.periodo_desde || null
      const hasta = factForm.periodo_hasta || null
      // Envíos del courier en el período (por fecha de pago; si no hay, por created_at)
      let q = supabase.from('envios')
        .select('id, costo_cotizado, fecha_pago_courier, created_at')
        .eq('tenant_id', tenant!.id).eq('courier', factForm.courier).gt('costo_cotizado', 0)
      q = applyFilter(q)
      const { data: enviosCourier } = await q
      const enRango = (enviosCourier ?? []).filter((e: any) => {
        const f = String(e.fecha_pago_courier || e.created_at || '').slice(0, 10)
        if (desde && f < desde) return false
        if (hasta && f > hasta) return false
        return true
      })
      const totalReg = enRango.reduce((s: number, e: any) => s + Number(e.costo_cotizado ?? 0), 0)
      const { diff } = diffFactura(totalFact, totalReg)

      let archivoUrl: string | null = null
      if (factArchivo) {
        const ext = factArchivo.name.split('.').pop() || 'pdf'
        const path = `facturas-courier/${tenant!.id}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('etiquetas-envios').upload(path, factArchivo)
        if (!upErr) {
          const { data: signed } = await supabase.storage.from('etiquetas-envios').createSignedUrl(path, 60 * 60 * 24 * 365)
          archivoUrl = signed?.signedUrl ?? null
        }
      }

      const { data: fact, error: fErr } = await supabase.from('courier_facturas').insert({
        tenant_id: tenant!.id, courier: factForm.courier,
        nro_factura: factForm.nro_factura.trim() || null,
        periodo_desde: desde, periodo_hasta: hasta,
        total_facturado: totalFact, total_registrado: totalReg, diferencia: diff,
        archivo_url: archivoUrl, estado: Math.abs(diff) < 1 ? 'conciliada' : 'borrador',
        notas: factForm.notas.trim() || null, sucursal_id: sucursalId || null, created_by: user?.id ?? null,
      }).select('id').single()
      if (fErr) throw fErr

      if (enRango.length > 0) {
        await supabase.from('courier_factura_lineas').insert(enRango.map((e: any) => ({
          tenant_id: tenant!.id, factura_id: fact.id, envio_id: e.id,
          monto_registrado: Number(e.costo_cotizado ?? 0), monto_facturado: null,
        })))
      }

      toast.success(Math.abs(diff) < 1
        ? 'Factura conciliada ✓ (sin diferencias)'
        : `Factura cargada — diferencia $${Math.abs(diff).toLocaleString('es-AR', { maximumFractionDigits: 0 })} ${diff > 0 ? '(courier facturó de más)' : '(facturó de menos)'}`)
      qc.invalidateQueries({ queryKey: ['courier-facturas'] })
      setFactForm({ courier: '', nro_factura: '', periodo_desde: '', periodo_hasta: '', total_facturado: '', notas: '' })
      setFactArchivo(null)
      if (factFileRef.current) factFileRef.current.value = ''
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar la factura') }
    finally { setSavingFact(false) }
  }

  // ── EN4/B6 — Registrar costo real → diferencia a-favor/pérdida (precio al cliente inmutable) ──
  const registrarDiferencia = async () => {
    if (!diffEnvio) return
    const real = parseFloat(diffCostoReal)
    if (isNaN(real) || real < 0) { toast.error('Ingresá el costo real'); return }
    const dif = diferenciaReal(Number(diffEnvio.costo_cotizado ?? 0), real)
    setSavingDiff(true)
    try {
      const { error } = await supabase.from('envios').update({
        costo_real: real,
        diferencia_tipo: dif.tipo,
        diferencia_monto: dif.monto,
        diferencia_motivo: dif.tipo === 'neutro' ? null : diffMotivo,
      }).eq('id', diffEnvio.id)
      if (error) throw error
      toast.success(dif.tipo === 'neutro' ? 'Costo real registrado (sin diferencia)'
        : `Costo real registrado — ${dif.tipo === 'a_favor' ? 'a favor' : 'pérdida'} $${dif.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
      qc.invalidateQueries({ queryKey: ['envios'] })
      setDiffEnvio(null); setDiffCostoReal(''); setDiffMotivo(DIFERENCIA_MOTIVOS[0])
    } catch (e: any) { toast.error(e.message ?? 'Error al guardar') }
    finally { setSavingDiff(false) }
  }

  // ── EN3/G3 — Hoja de ruta: ordenar + generar PDF + token agrupador ───────────
  const hojaRutaOrdenada = () => {
    const modo = (tenant as any)?.envio_hoja_ruta_modo ?? 'agrupada'
    return ordenarHojaRuta(
      (enviosReparto as any[]).map((e: any) => ({
        id: e.id, repartidor_id: e.repartidor_id, estado: e.estado,
        zona_entrega: e.zona_entrega, hora_entrega_acordada: e.hora_entrega_acordada,
      })),
      { proximidad: modo === 'agrupada_proximidad' },
    ).map(o => (enviosReparto as any[]).find((e: any) => e.id === o.id)).filter(Boolean)
  }

  const generarHojaRutaPDF = () => {
    const ordenados = hojaRutaOrdenada()
    if (ordenados.length === 0) { toast.error('No hay envíos para la hoja de ruta'); return }
    const rep = (repartidores as any[]).find(r => r.id === hrRepartidor)
    const doc = new jsPDF()
    doc.setFontSize(15); doc.text(`Hoja de ruta — ${tenant?.nombre ?? BRAND.name}`, 14, 16)
    doc.setFontSize(10)
    doc.text(`Fecha: ${formatFecha(hrFecha)}${rep ? `   ·   Repartidor: ${rep.nombre}` : ''}`, 14, 23)
    autoTable(doc, {
      startY: 28,
      head: [['#', 'Cliente', 'Dirección', 'Zona', 'Hora', 'Estado']],
      body: ordenados.map((e: any, i: number) => [
        String(i + 1),
        e.ventas?.clientes?.nombre ?? '—',
        [e.cliente_domicilios?.calle, e.cliente_domicilios?.numero, e.cliente_domicilios?.ciudad].filter(Boolean).join(' ') || '—',
        e.zona_entrega ?? '—',
        e.hora_entrega_acordada?.slice(0, 5) ?? '—',
        ESTADO_CFG[e.estado as EstadoEnvio]?.label ?? e.estado,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 58, 95] },
    })
    doc.save(`hoja_ruta_${hrFecha}${rep ? '_' + rep.nombre.replace(/\s+/g, '_') : ''}.pdf`)
  }

  // EN7/H3 — etiquetas A4 (4/6/12 por hoja) con QR + datos del destinatario, de la hoja de ruta del día
  const generarEtiquetas = async () => {
    const ordenados = hojaRutaOrdenada()
    if (ordenados.length === 0) { toast.error('No hay envíos para etiquetas'); return }
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin
    const etiquetas: EtiquetaEnvio[] = (ordenados as any[]).map((e: any) => ({
      numero: e.numero,
      negocio: tenant?.nombre ?? BRAND.name,
      destinatario: e.ventas?.clientes?.nombre ?? '—',
      direccion: [e.cliente_domicilios?.calle, e.cliente_domicilios?.numero, e.cliente_domicilios?.ciudad].filter(Boolean).join(' '),
      zona: e.zona_entrega,
      telefono: e.ventas?.clientes?.telefono,
      courier: 'Envío propio',
      qrTexto: e.token_transportista ? `${baseUrl}/transporte/${e.token_transportista}` : `Envío #${e.numero}`,
    }))
    try {
      await generarEtiquetasA4PDF(etiquetas, etqPorHoja)
    } catch (err: any) { toast.error(err.message ?? 'Error al generar etiquetas') }
  }

  const crearHojaRutaToken = async () => {
    const ordenados = hojaRutaOrdenada()
    if (ordenados.length === 0) { toast.error('No hay envíos para agrupar'); return }
    if (!hrRepartidor) { toast.error('Elegí un repartidor para la hoja agrupada'); return }
    setHrGuardando(true)
    try {
      const token = crypto.randomUUID()
      const { data: hoja, error } = await supabase.from('hojas_ruta').insert({
        tenant_id: tenant!.id, fecha: hrFecha, repartidor_id: hrRepartidor,
        token, sucursal_id: sucursalId || null, created_by: user?.id ?? null,
      }).select('id').single()
      if (error) throw error
      await supabase.from('hoja_ruta_envios').insert(ordenados.map((e: any, i: number) => ({
        tenant_id: tenant!.id, hoja_id: hoja.id, envio_id: e.id, orden: i,
      })))
      // asegurar token transportista por envío (para los links individuales de la hoja)
      for (const e of ordenados as any[]) {
        if (!e.token_transportista) {
          const t = crypto.randomUUID()
          const expira = tokenExpiraAt((tenant as any)?.envio_token_politica ?? 'al_entregar', Number((tenant as any)?.envio_token_dias ?? 30))
          await supabase.from('envios').update({ token_transportista: t, token_expira_at: expira }).eq('id', e.id)
        }
      }
      const url = `${import.meta.env.VITE_APP_URL || window.location.origin}/hoja-ruta/${token}`
      await navigator.clipboard.writeText(url).catch(() => {})
      toast.success('Hoja de ruta creada — link copiado para el chofer 📋', { duration: 4000 })
      qc.invalidateQueries({ queryKey: ['envios-reparto'] })
    } catch (e: any) { toast.error(e.message ?? 'Error al crear la hoja de ruta') }
    finally { setHrGuardando(false) }
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
    setVentaSeleccionada(null); setVentaSearch(''); setVentaItemsForm([])
    setDistanciaKm(null); setDireccionEntrega('')
    setShowModal(true)
  }
  const abrirEdicion = (e: any) => {
    setEditId(e.id)
    setTipoEnvio(e.courier === 'Envío propio' ? 'propio' : 'tercero')
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
      // ISS-178 — buscar el índice del rango que matchea (desde+hasta) en la config actual del tenant
      rango_horario_idx: (() => {
        const rangos: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
          ? (tenant as any).envio_rangos_horarios : []
        if (!e.rango_horario_desde || !e.rango_horario_hasta) return ''
        const idx = rangos.findIndex(r => r.desde === e.rango_horario_desde?.slice(0,5) && r.hasta === e.rango_horario_hasta?.slice(0,5))
        return idx >= 0 ? String(idx) : ''
      })(),
      repartidor_id: e.repartidor_id ?? '',
      tipo: e.tipo ?? 'venta', motivo: e.motivo ?? '', sucursal_destino_id: e.sucursal_destino_id ?? '',
      recurso_id: e.recurso_id ?? '', km_recorridos: e.km_recorridos ? String(e.km_recorridos) : '',
    })
    setVentaItemsForm([])
    setShowModal(true)
  }

  const seleccionarVenta = async (v: any) => {
    setVentaSeleccionada(v)
    setForm(f => ({
      ...f, venta_id: v.id,
      cliente_nombre: v.clientes?.nombre ?? '',
      canal: v.origen ?? 'POS',  // autocompletado desde el canal de la venta
    }))
    // EN5/A5 — cargar ítems de la venta y restar lo ya despachado en envíos previos
    const [{ data: vi }, { data: yaEnv }] = await Promise.all([
      supabase.from('venta_items').select('producto_id, cantidad, linea_id, productos(nombre), inventario_lineas(lpn)').eq('venta_id', v.id),
      supabase.from('envio_items').select('producto_id, cantidad, envios!inner(venta_id)').eq('envios.venta_id', v.id),
    ])
    const enviadoPorProd = new Map<string, number>()
    for (const e of (yaEnv ?? []) as any[]) {
      if (e.producto_id) enviadoPorProd.set(e.producto_id, (enviadoPorProd.get(e.producto_id) ?? 0) + Number(e.cantidad ?? 0))
    }
    setVentaItemsForm((vi ?? []).map((it: any) => {
      const yaEnviado = it.producto_id ? (enviadoPorProd.get(it.producto_id) ?? 0) : 0
      const restante = Math.max(0, Number(it.cantidad ?? 0) - yaEnviado)
      return { producto_id: it.producto_id ?? null, nombre: it.productos?.nombre ?? 'Ítem', cantidad: restante, lpn: (it.inventario_lineas as any)?.lpn ?? null }
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
      <PageTabs
        tabs={[
          { id: 'envios', label: 'Envíos', icon: Package2 },
          { id: 'pagos', label: 'Pagos Courier', icon: CreditCard, badge: (enviosPendientesPago as any[]).length || undefined },
          { id: 'facturas', label: 'Facturas Courier', icon: FileText },
          { id: 'reparto', label: 'Reparto', icon: Navigation },
          { id: 'reportes', label: 'Reportes', icon: BarChart3 },
        ]}
        active={tab}
        onChange={(id) => setTab(id as any)}
      />

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
                              {/* EN5/A4 — atrasado de despacho */}
                              {plazoDespachoVencido({ createdAt: e.created_at, estado: e.estado, canal: e.canal, plazos: (tenant as any)?.envio_plazo_despacho }).vencido && (
                                <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">
                                  <AlertTriangle size={9} /> Atrasado
                                </span>
                              )}
                              {/* EN5/A2 — tipo libre */}
                              {e.tipo && e.tipo !== 'venta' && (
                                <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                                  {TIPOS_ENVIO.find(t => t.v === e.tipo)?.t ?? e.tipo}
                                </span>
                              )}
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
                              {e.rango_horario_desde && e.rango_horario_hasta && (
                                <span className="block text-[11px] text-accent">
                                  {e.rango_horario_desde.slice(0,5)} – {e.rango_horario_hasta.slice(0,5)}
                                </span>
                              )}
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
                                  {/* EN4/B6: Registrar costo real (diferencia vs cotizado) */}
                                  {(e.costo_cotizado ?? 0) > 0 && (
                                    <button onClick={() => { setDiffEnvio(e); setDiffCostoReal(e.costo_real ? String(e.costo_real) : ''); setDiffMotivo(e.diferencia_motivo ?? DIFERENCIA_MOTIVOS[0]) }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                      <DollarSign size={13} /> {e.diferencia_tipo ? 'Costo real ✓' : 'Registrar costo real'}
                                    </button>
                                  )}
                                  {/* ISS-165: Compartir link con transportista */}
                                  <button onClick={async () => {
                                    let token = e.token_transportista
                                    if (!token) {
                                      token = crypto.randomUUID()
                                      // EN3/E1 — expiración del token según la política del tenant
                                      const expira = tokenExpiraAt((tenant as any)?.envio_token_politica ?? 'al_entregar', Number((tenant as any)?.envio_token_dias ?? 30))
                                      await supabase.from('envios').update({ token_transportista: token, token_expira_at: expira }).eq('id', e.id)
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
                                  {/* ISS-174 — Generar orden con el courier (API) */}
                                  {esCourierApi(e.courier) && !e.courier_orden_id && e.estado !== 'cancelado' && (
                                    <button onClick={() => handleGenerarCourier(e.id)} disabled={generandoId === e.id}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-blue-300 dark:border-blue-700 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-60">
                                      {generandoId === e.id ? <Loader2 size={13} className="animate-spin" /> : <Package2 size={13} />}
                                      {generandoId === e.id ? 'Generando…' : 'Generar con courier'}
                                    </button>
                                  )}
                                  {/* ISS-174 — Etiqueta del courier */}
                                  {e.etiqueta_url && (
                                    <a href={e.etiqueta_url} target="_blank" rel="noreferrer"
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-blue-300 dark:border-blue-700 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                                      <Tag size={13} /> Etiqueta
                                    </a>
                                  )}
                                  {/* ISS-174 — Actualizar tracking desde el courier */}
                                  {esCourierApi(e.courier) && e.tracking_number && (
                                    <button onClick={() => handleActualizarTracking(e.id)} disabled={trackingId === e.id}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-60">
                                      {trackingId === e.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                      Actualizar tracking
                                    </button>
                                  )}
                                  {e.ventas?.id && (
                                    <button onClick={() => navigate(`/ventas?id=${e.venta_id}`)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                      <ExternalLink size={13} /> Ver venta
                                    </button>
                                  )}
                                  {/* Auditoría 2026-06-11 — el envío que volvió no debe morir en el limbo:
                                      CTA que abre el flujo de devolución de la venta (reingreso de stock + NC/egreso). */}
                                  {e.estado === 'devolucion' && e.venta_id && (
                                    <button onClick={() => navigate(`/ventas?id=${e.venta_id}&devolver=1`)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-purple-300 dark:border-purple-700 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
                                      <RotateCcw size={13} /> Registrar devolución de la venta
                                    </button>
                                  )}
                                  {/* Registrar POD — disponible a partir de en_camino */}
                                  {(e.estado === 'en_camino' || e.estado === 'en_bodega' || e.estado === 'entregado') && (
                                    <button onClick={() => {
                                      setPodModalId(e.id)
                                      setPodForm({ pod_fecha: e.pod_fecha ?? '', pod_receptor: e.pod_receptor ?? '', pod_notas: e.pod_notas ?? '', pod_url: e.pod_url ?? '', pod_dni: e.pod_dni ?? '' })
                                      setPodFirmaDataUrl(null); setPodFirmaUrlExistente(e.pod_firma_url ?? null); setPodFotosCount(0)
                                    }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-green-300 dark:border-green-700 rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
                                      <ClipboardCheck size={13} /> {e.pod_fecha ? 'Actualizar POD' : 'Registrar POD'}
                                    </button>
                                  )}
                                  {/* EN7/G2 — Registrar combustible (envío propio con vehículo asignado) */}
                                  {e.courier === 'Envío propio' && e.recurso_id && (
                                    e.gasto_combustible_id ? (
                                      <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300 self-center">
                                        <Fuel size={13} /> Combustible registrado
                                      </span>
                                    ) : (
                                      <button onClick={() => abrirCombustible(e)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-300 dark:border-amber-700 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                                        <Fuel size={13} /> Registrar combustible
                                      </button>
                                    )
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
                                      setPodForm({ pod_fecha: new Date().toISOString().split('T')[0], pod_receptor: '', pod_notas: '', pod_url: '', pod_dni: e.pod_dni ?? '' })
                                      setPodFirmaDataUrl(null); setPodFirmaUrlExistente(e.pod_firma_url ?? null); setPodFotosCount(0)
                                    }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                      <ClipboardCheck size={13} /> Registrar entrega (POD)
                                    </button>
                                  )}
                                  {/* EN2/D5 — No entregado (sub-estado + reintento) */}
                                  {(e.estado === 'en_camino' || e.estado === 'en_bodega' || e.estado === 'despachado') && (
                                    <button onClick={() => { setNoEntregaId(e.id); setNoEntregaSub('ausente'); setNoEntregaMotivo('') }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-orange-300 dark:border-orange-700 rounded-lg text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
                                      <RotateCcw size={13} /> No entregado
                                    </button>
                                  )}
                                  {e.intentos > 0 && (
                                    <span className="text-[11px] px-2 py-1 rounded-full bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300 self-center">
                                      Intento {e.intentos}{e.subestado_no_entrega ? ` · ${SUBESTADOS_NO_ENTREGA.find(s => s.v === e.subestado_no_entrega)?.t ?? ''}` : ''}
                                    </span>
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
              {(() => {
                const totalSel = (enviosPendientesPago as any[]).filter(e => pagosSeleccion.has(e.id)).reduce((s, e) => s + (e.costo_cotizado ?? 0), 0)
                const umbral = Number((tenant as any)?.envio_pago_doble_firma_umbral ?? 0)
                const necesitaClave = requiereDobleFirma(totalSel, umbral) && !!(tenant as any)?.clave_maestra
                return necesitaClave ? (
                  <div>
                    <label className="block text-xs text-amber-600 dark:text-amber-400 mb-1">🔒 Clave maestra (supera umbral)</label>
                    <input type="password" autoComplete="new-password" value={pagoClaveMaestra} onChange={e => setPagoClaveMaestra(e.target.value)}
                      className="border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
                  </div>
                ) : null
              })()}
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
            {(tenant as any)?.envio_courier_genera_gasto !== false && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-2 mb-3 flex items-center gap-1">
                <DollarSign size={11} /> Al marcar pagado se genera un gasto en <strong>Transporte y fletes</strong> (IVA {Number((tenant as any)?.envio_courier_iva_pct ?? 21)}% crédito fiscal){pagoMedio === 'Efectivo' ? ' + egreso de caja' : ''}. Configurable en Config → Envíos.
              </p>
            )}

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

      {/* ══ TAB: FACTURAS COURIER (EN1/C3) ══ */}
      {tab === 'facturas' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1 flex items-center gap-2">
              <FileText size={16} className="text-accent" /> Cargar factura del courier
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Cargá la factura/resumen del courier por período. El sistema la concilia contra lo registrado y avisa si hay diferencias.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Courier</label>
                <select value={factForm.courier} onChange={e => setFactForm(f => ({ ...f, courier: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent">
                  <option value="">Elegí courier…</option>
                  {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nº factura</label>
                <input type="text" value={factForm.nro_factura} onChange={e => setFactForm(f => ({ ...f, nro_factura: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Total facturado</label>
                <input type="number" onWheel={ev => ev.currentTarget.blur()} value={factForm.total_facturado} onChange={e => setFactForm(f => ({ ...f, total_facturado: e.target.value }))}
                  placeholder="0" min="0" step="0.01"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Período desde</label>
                <input type="date" value={factForm.periodo_desde} onChange={e => setFactForm(f => ({ ...f, periodo_desde: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Período hasta</label>
                <input type="date" value={factForm.periodo_hasta} onChange={e => setFactForm(f => ({ ...f, periodo_hasta: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Archivo (PDF/CSV, opcional)</label>
                <input ref={factFileRef} type="file" accept=".pdf,.csv,image/*" onChange={e => setFactArchivo(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-accent/10 file:text-accent" />
              </div>
            </div>
            <div className="flex items-end justify-between gap-3">
              <input type="text" value={factForm.notas} onChange={e => setFactForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Notas (opcional)"
                className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent" />
              <button onClick={guardarFacturaCourier} disabled={savingFact || !factForm.courier}
                className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40 text-sm whitespace-nowrap">
                <ClipboardCheck size={16} /> {savingFact ? 'Conciliando…' : 'Cargar y conciliar'}
              </button>
            </div>
          </div>

          {/* Listado de facturas conciliadas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Facturas cargadas</h3>
            {(courierFacturas as any[]).length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Todavía no cargaste facturas de courier.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(courierFacturas as any[]).map((f: any) => {
                  const hayDif = Math.abs(Number(f.diferencia ?? 0)) > 1
                  return (
                    <div key={f.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                      <div className="flex-1 min-w-[160px]">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {f.courier} {f.nro_factura ? <span className="text-gray-400 font-normal">· Nº {f.nro_factura}</span> : null}
                        </p>
                        <p className="text-xs text-gray-400">
                          {f.periodo_desde ? `${formatFecha(f.periodo_desde)} – ${f.periodo_hasta ? formatFecha(f.periodo_hasta) : '…'}` : 'sin período'}
                          {' · '}{(f.courier_factura_lineas?.length ?? 0)} envío(s)
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-gray-500 dark:text-gray-400">Facturado: <strong className="text-gray-700 dark:text-gray-200">${Number(f.total_facturado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></p>
                        <p className="text-gray-500 dark:text-gray-400">Registrado: <strong className="text-gray-700 dark:text-gray-200">${Number(f.total_registrado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</strong></p>
                      </div>
                      <div className="flex items-center gap-2">
                        {hayDif ? (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <AlertTriangle size={12} /> Dif. ${Math.abs(Number(f.diferencia)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 flex items-center gap-1">
                            <CheckCircle size={12} /> Conciliada
                          </span>
                        )}
                        {f.archivo_url && (
                          <a href={f.archivo_url} target="_blank" rel="noopener" className="text-accent hover:underline text-xs flex items-center gap-1">
                            <ExternalLink size={12} /> Ver
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: REPARTO (EN3 — G3 hoja de ruta + cumplimiento + productividad) ══ */}
      {tab === 'reparto' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1 flex items-center gap-2">
              <Navigation size={16} className="text-accent" /> Hoja de ruta (envío propio)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Planificá el reparto del día por repartidor: orden de visita, hoja de ruta PDF y link agrupado para el chofer.
            </p>
            <div className="flex flex-wrap gap-3 items-end mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Fecha</label>
                <input type="date" value={hrFecha} onChange={e => setHrFecha(e.target.value)}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Repartidor</label>
                <select value={hrRepartidor} onChange={e => setHrRepartidor(e.target.value)}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  <option value="">Todos</option>
                  {(repartidores as any[]).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>
              <button onClick={generarHojaRutaPDF}
                className="flex items-center gap-2 border border-accent/40 text-accent px-3 py-2 rounded-xl text-sm hover:bg-accent/10">
                <Printer size={15} /> Hoja de ruta PDF
              </button>
              {/* EN7/H3 — etiquetas A4 con QR */}
              <div className="flex items-center gap-1.5">
                <select value={etqPorHoja} onChange={e => setEtqPorHoja(Number(e.target.value) as EtiquetasPorHoja)}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  <option value={4}>4/hoja</option>
                  <option value={6}>6/hoja</option>
                  <option value={12}>12/hoja</option>
                </select>
                <button onClick={generarEtiquetas}
                  className="flex items-center gap-2 border border-accent/40 text-accent px-3 py-2 rounded-xl text-sm hover:bg-accent/10">
                  <Tag size={15} /> Etiquetas A4
                </button>
              </div>
              <button onClick={crearHojaRutaToken} disabled={hrGuardando || !hrRepartidor}
                className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold px-4 py-2 rounded-xl text-sm disabled:opacity-40">
                <Send size={15} /> {hrGuardando ? 'Creando…' : 'Link agrupado para el chofer'}
              </button>
            </div>

            {/* Cumplimiento del día */}
            {(() => {
              const c = cumplimientoDia((enviosReparto as any[]).map((e: any) => ({ id: e.id, estado: e.estado })))
              return (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{c.total}</p>
                    <p className="text-xs text-gray-400">Planificados</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                    <p className="text-2xl font-bold text-green-600">{c.entregados}</p>
                    <p className="text-xs text-gray-400">Entregados</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-center">
                    <p className="text-2xl font-bold text-accent">{c.pct}%</p>
                    <p className="text-xs text-gray-400">Cumplimiento</p>
                  </div>
                </div>
              )
            })()}

            {/* Lista ordenada */}
            {(enviosReparto as any[]).length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Navigation size={30} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No hay envíos propios para esa fecha/repartidor.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {hojaRutaOrdenada().map((e: any, i: number) => (
                  <div key={e.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700">
                    <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {e.ventas?.clientes?.nombre ?? '—'} <span className="text-gray-400 font-normal">#{e.numero}</span>
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {[e.cliente_domicilios?.calle, e.cliente_domicilios?.numero, e.cliente_domicilios?.ciudad].filter(Boolean).join(' ') || e.zona_entrega || '—'}
                        {e.hora_entrega_acordada ? ` · ${e.hora_entrega_acordada.slice(0,5)}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_CFG[e.estado as EstadoEnvio]?.color ?? ''}`}>
                      {ESTADO_CFG[e.estado as EstadoEnvio]?.label ?? e.estado}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Productividad por repartidor */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Productividad por repartidor (del filtro)</h3>
            {(() => {
              const prod = productividadRepartidor((enviosReparto as any[]).map((e: any) => ({ id: e.id, repartidor_id: e.repartidor_id, estado: e.estado })))
              if (prod.length === 0) return <p className="text-xs text-gray-400 italic">Sin datos.</p>
              return (
                <div className="space-y-1.5">
                  {prod.map(p => {
                    const rep = (repartidores as any[]).find(r => r.id === p.repartidorId)
                    return (
                      <div key={p.repartidorId ?? 'sin'} className="flex items-center gap-3 text-sm p-2 rounded-lg border border-gray-100 dark:border-gray-700">
                        <span className="flex-1 font-medium text-gray-700 dark:text-gray-200">{rep?.nombre ?? 'Sin asignar'}</span>
                        <span className="text-xs text-gray-500">{p.entregados}/{p.asignados} entregados</span>
                        <span className="text-xs font-semibold text-accent">{p.pctCumplimiento}%</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ══ TAB: REPORTES (EN7 — H1 reportes + H2 alertas + export) ══ */}
      {tab === 'reportes' && (
        <EnviosReportesPanel tenant={tenant} sucursalId={sucursalId} />
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
              {/* EN5/A2 — Tipo de envío (libre sin venta) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de envío</label>
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  {TIPOS_ENVIO.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
                </select>
              </div>
              {form.tipo !== 'venta' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
                    <input type="text" value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                      placeholder="Ej: muestra para cliente X" className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  {form.tipo === 'traslado_interno' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sucursal destino</label>
                      <select value={form.sucursal_destino_id} onChange={e => setForm(f => ({ ...f, sucursal_destino_id: e.target.value }))}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Elegí…</option>
                        {(sucursales as any[]).filter(s => s.id !== sucursalId).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {/* Seleccionar venta */}
              {!editId && form.tipo === 'venta' && (
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
                            className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-100 flex items-center justify-between gap-2">
                            <span>{formatVentaNum(v)} — {v.clientes?.nombre ?? 'Sin cliente'} — {formatMoneda(v.total ?? 0)}</span>
                            {v._nEnvios > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 whitespace-nowrap">{v._nEnvios} envío{v._nEnvios > 1 ? 's' : ''}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* EN5/A5 — desglose: qué ítems se van en este envío */}
              {!editId && form.tipo === 'venta' && ventaSeleccionada && ventaItemsForm.length > 0 && (
                <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Contenido de este envío (editá lo que va ahora)</p>
                  <div className="space-y-1.5">
                    {ventaItemsForm.map((it, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 truncate">{it.nombre}{it.lpn ? <span className="text-gray-400"> · {it.lpn}</span> : null}</span>
                        <input type="number" onWheel={e => e.currentTarget.blur()} value={it.cantidad}
                          onChange={e => setVentaItemsForm(arr => arr.map((x, j) => j === i ? { ...x, cantidad: Math.max(0, parseFloat(e.target.value) || 0) } : x))}
                          min="0" className="w-20 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">Si dividís la venta en varios envíos, cargá acá solo lo que sale en éste. Lo ya despachado se descuenta automáticamente.</p>
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
                            // EN5/A3 — sugerir courier por CP (solo si no se eligió uno)
                            const sugerido = sugerirCourierPorCp(d.codigo_postal, (tenant as any)?.cp_courier_preferido)
                            setForm(f => ({
                              ...f, destino_id: d.id,
                              destino_descripcion: `${d.calle}${d.numero ? ` ${d.numero}` : ''}${d.piso_depto ? `, ${d.piso_depto}` : ''}, ${d.ciudad ?? ''} ${d.provincia ?? ''} ${d.codigo_postal ?? ''}`.trim(),
                              courier: (!f.courier && sugerido && tipoEnvio === 'tercero') ? sugerido : f.courier,
                            }))
                            if (sugerido && !form.courier && tipoEnvio === 'tercero') toast(`Sugerido: ${sugerido} (por CP ${d.codigo_postal})`, { icon: '📦' })
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
                {/* ISS-174 — Cotizar por API del courier */}
                {tipoEnvio === 'tercero' && esCourierApi(form.courier) && (
                  <div className="col-span-2 rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={handleCotizar} disabled={cotizando}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 font-medium">
                        {cotizando ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                        {cotizando ? 'Cotizando…' : `Cotizar con ${form.courier}`}
                      </button>
                      {!destinoCp && (
                        <input type="text" value={destinoCpManual} onChange={e => setDestinoCpManual(e.target.value)}
                          placeholder="CP destino" inputMode="numeric"
                          className="w-28 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      )}
                      <span className="text-[11px] text-gray-400">Origen CP {origenCp || '—'} → destino CP {destinoCp || '—'}</span>
                    </div>
                    {cotizaciones.length > 0 && (
                      <div className="space-y-1">
                        {cotizaciones.map((op, i) => (
                          <button key={i} type="button" onClick={() => elegirCotizacion(op)}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors
                              ${form.servicio === op.servicio ? 'border-accent bg-accent/10' : 'border-gray-200 dark:border-gray-600 hover:border-accent/50 bg-white dark:bg-gray-700'}`}>
                            <span className="font-medium text-gray-700 dark:text-gray-200">{op.servicio}</span>
                            <span className="flex items-center gap-3">
                              {op.plazo_dias != null && <span className="text-gray-400">{op.plazo_dias}d</span>}
                              <span className="font-semibold text-accent">${op.precio.toLocaleString('es-AR')}</span>
                            </span>
                          </button>
                        ))}
                        <p className="text-[10px] text-gray-400">Elegí una opción: setea servicio y costo (editable arriba).</p>
                      </div>
                    )}
                  </div>
                )}
                {/* Zona */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Zona de entrega</label>
                  <input type="text" value={form.zona_entrega} onChange={e => setForm(f => ({ ...f, zona_entrega: e.target.value }))}
                    placeholder="Ej: CABA, GBA Norte"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {/* EN3/G1 — Repartidor asignado (envío propio) */}
                {(form.courier === 'Envío propio' || form.repartidor_id) && (repartidores as any[]).length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Repartidor asignado</label>
                    <select value={form.repartidor_id} onChange={e => setForm(f => ({ ...f, repartidor_id: e.target.value }))}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                      <option value="">Sin asignar</option>
                      {(repartidores as any[]).map(r => <option key={r.id} value={r.id}>{r.nombre}{r.vehiculo ? ` (${r.vehiculo})` : ''}</option>)}
                    </select>
                  </div>
                )}
                {/* EN7/G2 — Vehículo (recurso) + KM para auto-gasto de combustible (envío propio) */}
                {tipoEnvio === 'propio' && (vehiculos as any[]).length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1.5"><Car size={13} className="text-gray-400" /> Vehículo</label>
                      <select value={form.recurso_id} onChange={e => setForm(f => ({ ...f, recurso_id: e.target.value }))}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        <option value="">Sin vehículo</option>
                        {(vehiculos as any[]).map(v => <option key={v.id} value={v.id}>{v.nombre}{v.consumo_litros_100km ? ` · ${v.consumo_litros_100km}L/100km` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">KM del envío</label>
                      <input type="number" min="0" step="0.1" value={form.km_recorridos}
                        onChange={e => setForm(f => ({ ...f, km_recorridos: e.target.value }))}
                        placeholder={distanciaKm != null ? String(distanciaKm) : 'auto'}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    </div>
                    <p className="col-span-2 text-[11px] text-gray-400 -mt-1 flex items-center gap-1"><Fuel size={11} /> El combustible se registra como gasto desde el detalle del envío (suma KM al vehículo).</p>
                  </div>
                )}
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
                {/* ISS-178 — Rango horario (alternativa a la hora exacta) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rango horario</label>
                  {(() => {
                    const rangos: Array<{ desde: string; hasta: string }> = Array.isArray((tenant as any)?.envio_rangos_horarios)
                      ? (tenant as any).envio_rangos_horarios : []
                    return (
                      <select
                        value={form.rango_horario_idx}
                        onChange={e => setForm(f => ({ ...f, rango_horario_idx: e.target.value }))}
                        disabled={rangos.length === 0}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 disabled:bg-gray-50 dark:disabled:bg-gray-800"
                      >
                        <option value="">{rangos.length === 0 ? 'Sin rangos configurados' : 'Sin definir'}</option>
                        {rangos.map((r, i) => (
                          <option key={i} value={String(i)}>{r.desde} – {r.hasta}</option>
                        ))}
                      </select>
                    )
                  })()}
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
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Comprobantes / fotos</label>
                      {editId ? (
                        <PodFotosManager
                          envioId={editId}
                          onPrincipalChange={(url) => setForm(f => ({ ...f, pod_url: url ?? '' }))}
                        />
                      ) : (
                        <p className="text-xs text-muted italic">Guardá el envío para agregar fotos del POD.</p>
                      )}
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
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <ClipboardCheck size={18} className="text-green-500" /> Prueba de entrega (POD)
              </h2>
              <button onClick={() => setPodModalId(null)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
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
                  <UserIcon size={13} className="inline mr-1" />Nombre de quien recibió {podRequeridos.receptor && <span className="text-red-500">*</span>}
                </label>
                <input type="text" value={podForm.pod_receptor} onChange={e => setPodForm(f => ({ ...f, pod_receptor: e.target.value }))}
                  placeholder="Ej: Juan García"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>

              {(podRequeridos.dni || podForm.pod_dni) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">DNI del receptor {podRequeridos.dni && <span className="text-red-500">*</span>}</label>
                  <input type="text" inputMode="numeric" value={podForm.pod_dni} onChange={e => setPodForm(f => ({ ...f, pod_dni: e.target.value }))}
                    placeholder="Ej: 30111222"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Comprobantes / fotos {(podRequeridos.foto || podFotoMin > 0) && <span className="text-red-500">*</span>}
                  {podFotoMin > 0 && <span className="text-xs text-gray-400 font-normal ml-1">(mín. {Math.max(podRequeridos.foto ? 1 : 0, podFotoMin)})</span>}
                </label>
                {podModalId && (
                  <PodFotosManager
                    envioId={podModalId}
                    onPrincipalChange={(url) => setPodForm(f => ({ ...f, pod_url: url ?? '' }))}
                    onCountChange={setPodFotosCount}
                  />
                )}
              </div>

              {(podRequeridos.firma || podFirmaUrlExistente) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Firma del receptor {podRequeridos.firma && <span className="text-red-500">*</span>}</label>
                  <SignaturePad accent="#16a34a" initialUrl={podFirmaUrlExistente} onChange={setPodFirmaDataUrl} />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observaciones</label>
                <textarea value={podForm.pod_notas} onChange={e => setPodForm(f => ({ ...f, pod_notas: e.target.value }))}
                  placeholder="Condición del paquete, horario real de entrega, etc." rows={2}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>

            <div className="px-5 py-4 flex gap-3 flex-shrink-0 border-t border-gray-100 dark:border-gray-700">
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

      {/* ══ MODAL: NO ENTREGADO (EN2/D5+D6) ══ */}
      {noEntregaId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <RotateCcw size={18} className="text-orange-500" /> Registrar no entregado
              </h2>
              <button onClick={() => setNoEntregaId(null)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo de la no entrega</label>
                <select value={noEntregaSub} onChange={e => setNoEntregaSub(e.target.value as SubestadoNoEntrega)}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                  {SUBESTADOS_NO_ENTREGA.map(s => <option key={s.v} value={s.v}>{s.t}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {noEntregaSub === 'ausente'
                    ? `Si quedan intentos vuelve a "En camino" para reintentar (máx. ${Number((tenant as any)?.envio_reintentos_max ?? 3)}).`
                    : 'Pasa directo a Devolución.'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Detalle</label>
                <textarea value={noEntregaMotivo} onChange={e => setNoEntregaMotivo(e.target.value)} rows={2}
                  placeholder="Ej: timbre sin respuesta, dirección inexistente…"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent resize-none bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setNoEntregaId(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                Cancelar
              </button>
              <button onClick={registrarNoEntrega} disabled={savingNoEntrega}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">
                {savingNoEntrega ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: REGISTRAR COSTO REAL — diferencia (EN4/B6) ══ */}
      {diffEnvio && (() => {
        const real = parseFloat(diffCostoReal)
        const prev = !isNaN(real) ? diferenciaReal(Number(diffEnvio.costo_cotizado ?? 0), real) : null
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <DollarSign size={18} className="text-accent" /> Costo real del envío
                </h2>
                <button onClick={() => setDiffEnvio(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  El precio que pagó el cliente (cotizado: <strong>${Number(diffEnvio.costo_cotizado ?? 0).toLocaleString('es-AR')}</strong>) <strong>no se modifica</strong>. Registrá el costo real para trazar la diferencia.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Costo real ($)</label>
                  <input type="number" onWheel={ev => ev.currentTarget.blur()} value={diffCostoReal} onChange={e => setDiffCostoReal(e.target.value)}
                    min="0" step="0.01" autoFocus
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                {prev && prev.tipo !== 'neutro' && (
                  <>
                    <div className={`rounded-xl px-3 py-2 text-sm font-medium ${prev.tipo === 'a_favor' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                      {prev.tipo === 'a_favor' ? '↓ A favor' : '↑ Pérdida'}: ${prev.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo de la diferencia</label>
                      <select value={diffMotivo} onChange={e => setDiffMotivo(e.target.value)}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        {DIFERENCIA_MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="px-5 pb-5 flex gap-3">
                <button onClick={() => setDiffEnvio(null)}
                  className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">Cancelar</button>
                <button onClick={registrarDiferencia} disabled={savingDiff}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">{savingDiff ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ MODAL: COMBUSTIBLE (EN7/G2) ══ */}
      {combustibleEnvio && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2"><Fuel size={18} className="text-amber-500" /> Registrar combustible</h2>
              <button onClick={() => setCombustibleEnvio(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Envío #{combustibleEnvio.numero ?? combustibleEnvio.id.slice(-6)} ·{' '}
                {(vehiculos as any[]).find(v => v.id === combustibleEnvio.recurso_id)?.nombre ?? 'vehículo'}.
                Genera un <strong>gasto en Combustible</strong> (IVA crédito fiscal) y suma los KM al vehículo.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">KM recorridos</label>
                  <input type="number" min="0" step="0.1" value={combustibleKm}
                    onChange={e => {
                      setCombustibleKm(e.target.value)
                      const veh = (vehiculos as any[]).find(v => v.id === combustibleEnvio.recurso_id)
                      const est = costoCombustible(parseFloat(e.target.value) || 0, { consumoLitros100km: veh?.consumo_litros_100km, precioLitro: (tenant as any)?.envio_combustible_precio_litro })
                      if (est > 0) setCombustibleMonto(String(est))
                    }}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto del gasto</label>
                  <input type="number" min="0" step="0.01" value={combustibleMonto}
                    onChange={e => setCombustibleMonto(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>
              {!(tenant as any)?.envio_combustible_precio_litro && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">Configurá el precio del litro en Config → Envíos para estimar el monto automáticamente.</p>
              )}
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setCombustibleEnvio(null)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">Cancelar</button>
              <button onClick={registrarCombustible} disabled={savingCombustible}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 text-sm">{savingCombustible ? 'Guardando…' : 'Registrar gasto'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
