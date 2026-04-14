import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, ShoppingCart, Package, Truck, X, Hash, Percent, CreditCard, User, FileText, Zap, DollarSign, Printer, Layers, Camera, Scissors, Gift, LayoutGrid, List, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { logActividad } from '@/lib/actividadLog'
import { getRebajeSort } from '@/lib/rebajeSort'
import { useCotizacion } from '@/hooks/useCotizacion'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { useGruposEstados } from '@/hooks/useGruposEstados'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { validarMediosPago, calcularSaldoPendiente, validarDespacho, validarSaldoMediosPago, acumularMediosPago, calcularVuelto, calcularEfectivoCaja, calcularComboRows, restaurarMediosPago, calcularLpnFuentes, type EstadoVenta, type MedioPagoItem, type LineaDisponible, type LpnFuente } from '@/lib/ventasValidation'
import toast from 'react-hot-toast'

type Tab = 'nueva' | 'historial'
type DescTipo = 'pct' | 'monto'

const ESTADOS: Record<EstadoVenta, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  reservada:  { label: 'Reservada',  color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30'   },
  despachada: { label: 'Finalizada', color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/30'  },
  cancelada:  { label: 'Cancelada',  color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/30'    },
  facturada:  { label: 'Facturada',  color: 'text-purple-700', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  devuelta:   { label: 'Devuelta',   color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
}

const MEDIOS_PAGO = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia', 'Mercado Pago', 'Otro']

function calcularEfectivo(mediosPago: MedioPagoItem[], total: number): number {
  const efectivos = mediosPago.filter(m => m.tipo === 'Efectivo')
  if (efectivos.length === 0) return 0
  const hayOtros = mediosPago.some(m => m.tipo && m.tipo !== 'Efectivo')
  if (efectivos.length === 1 && !efectivos[0].monto && !hayOtros) return total
  return efectivos.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
}

interface CartItem {
  producto_id: string
  nombre: string
  sku: string
  precio_unitario: number
  precio_costo: number
  cantidad: number
  descuento: number
  descuento_tipo: DescTipo
  tiene_series: boolean
  tiene_vencimiento: boolean
  regla_inventario?: string | null
  linea_id?: string
  lpn?: string
  lineas_disponibles?: LineaDisponible[]   // todas las líneas ordenadas por sort activo
  lpn_fuentes?: LpnFuente[]               // computed: qué líneas cubren la cantidad actual
  imagen_url?: string
  es_kit?: boolean
  alicuota_iva?: number
  series_seleccionadas: string[]
  series_disponibles: any[]
}

export default function VentasPage() {
  const { tenant, user } = useAuthStore()
  const { sucursalId, applyFilter } = useSucursalFilter()
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const { cotizacion: cotizacionUSD } = useCotizacion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => searchParams.get('id') ? 'historial' : 'nueva')
  const [ventaGrupoId, setVentaGrupoId] = useState<string | null>(null)

  // Nueva venta
  const [cart, setCart] = useState<CartItem[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteDropOpen, setClienteDropOpen] = useState(false)
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false)
  const [nuevoClienteForm, setNuevoClienteForm] = useState({ nombre: '', dni: '', telefono: '' })
  const [savingCliente, setSavingCliente] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [mediosPago, setMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  const [descuentoTotal, setDescuentoTotal] = useState('')
  const [descuentoTotalTipo, setDescuentoTotalTipo] = useState<DescTipo>('pct')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [ticketVenta, setTicketVenta] = useState<any | null>(null)
  const [saldoModal, setSaldoModal] = useState<{ ventaId: string; total: number; montoPagado: number; mediosPago: MedioPagoItem[] } | null>(null)
  const [modoVenta, setModoVenta] = useState<'reservada' | 'despachada' | 'pendiente'>('reservada')
  const [editandoPago, setEditandoPago] = useState(false)
  const [editMontoPagado, setEditMontoPagado] = useState('')
  const [savingMontoPagado, setSavingMontoPagado] = useState(false)

  // Devoluciones
  interface DevItem {
    venta_item_id: string
    producto_id: string
    nombre: string
    cantidad_original: number
    precio_unitario: number
    tiene_series: boolean
    venta_series: { serie_id: string; nro_serie: string }[]
    cantidad_devolver: number
    series_seleccionadas: string[]
  }
  const [devolucionVenta, setDevolucionVenta] = useState<any | null>(null)
  const [devItems, setDevItems] = useState<DevItem[]>([])
  const [devMotivo, setDevMotivo] = useState('')
  const [devMediosPago, setDevMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  const [devSaving, setDevSaving] = useState(false)
  const [devComprobante, setDevComprobante] = useState<any | null>(null)
  const [devolucionesOpen, setDevolucionesOpen] = useState(false)

  // Caja abierta
  const { data: sesionesAbiertas = [] } = useQuery({
    queryKey: ['caja-sesiones-abiertas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('caja_sesiones')
        .select('id, caja_id, cajas(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'abierta')
      return data ?? []
    },
    enabled: !!tenant,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string | null>(null)
  const sesionCajaId = cajaSeleccionadaId ?? (sesionesAbiertas.length === 1 ? (sesionesAbiertas[0] as any).id : null)

  // Historial
  const [searchHistorial, setSearchHistorial] = useState('')
  const [filterEstado, setFilterEstado] = useState<EstadoVenta | ''>('')
  const [filterCategoria, setFilterCategoria] = useState<string>('')
  const [ventaDetalle, setVentaDetalle] = useState<any | null>(null)

  // Modal series
  const [seriesModal, setSeriesModal] = useState<{ itemIdx: number; lineas: any[] } | null>(null)
  const [seriesBusqueda, setSeriesBusqueda] = useState('')

  const registrarClienteInline = async () => {
    const { nombre, dni, telefono } = nuevoClienteForm
    if (!nombre.trim()) { toast.error('El nombre es obligatorio'); return }
    if (!dni.trim()) { toast.error('El DNI es obligatorio'); return }
    if (!telefono.trim()) { toast.error('El teléfono es obligatorio'); return }
    setSavingCliente(true)
    try {
      const { data, error } = await supabase.from('clientes')
        .insert({ tenant_id: tenant!.id, nombre: nombre.trim(), dni: dni.trim(), telefono: telefono.trim() })
        .select('id, nombre').single()
      if (error) throw error
      setClienteId(data.id)
      setClienteNombre(data.nombre)
      setClienteTelefono(telefono.trim())
      setNuevoClienteOpen(false)
      setNuevoClienteForm({ nombre: '', dni: '', telefono: '' })
      toast.success('Cliente registrado')
    } catch (err: any) {
      toast.error(err.message?.includes('clientes_dni_tenant') ? 'Ya existe un cliente con ese DNI' : (err.message ?? 'Error al registrar'))
    } finally {
      setSavingCliente(false)
    }
  }

  useModalKeyboard({ isOpen: seriesModal !== null, onClose: () => { setSeriesModal(null); setSeriesBusqueda('') }, onConfirm: () => { setSeriesModal(null); setSeriesBusqueda('') } })
  useModalKeyboard({ isOpen: ventaDetalle !== null && saldoModal === null, onClose: () => { setVentaDetalle(null); setEditandoPago(false) } })
  useModalKeyboard({ isOpen: nuevoClienteOpen, onClose: () => { setNuevoClienteOpen(false); setNuevoClienteForm({ nombre: '', dni: '', telefono: '' }) }, onConfirm: registrarClienteInline })
  useModalKeyboard({ isOpen: saldoModal !== null, onClose: () => setSaldoModal(null) })

  // Foco en buscador de productos
  const [searchFocused, setSearchFocused] = useState(false)
  const [viewMode, setViewMode] = useState<'lista' | 'galeria'>('lista')

  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-venta', tenant?.id, productoSearch, ventaGrupoId, viewMode],
    queryFn: async () => {
      // Determinar estados del grupo activo
      const grupoActivo = ventaGrupoId === 'todos'
        ? null
        : ventaGrupoId
          ? grupos.find(g => g.id === ventaGrupoId)
          : grupoDefault
      const estadosFiltro = grupoActivo?.estado_ids ?? []

      // Buscar productos
      let prodQuery = supabase.from('productos')
        .select('id, nombre, sku, precio_venta, precio_costo, tiene_series, tiene_vencimiento, regla_inventario, stock_actual, unidad_medida, imagen_url, es_kit, alicuota_iva')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('nombre')
        .limit(viewMode === 'galeria' ? 60 : 20)
      if (productoSearch.length > 0)
        prodQuery = prodQuery.or(`nombre.ilike.%${productoSearch}%,sku.ilike.%${productoSearch}%`)
      const { data: prods } = await prodQuery

      if (!prods || prods.length === 0) return []

      // Calcular stock disponible por producto según el grupo activo
      const productoIds = prods.map((p: any) => p.id)

      // Traer líneas activas de estos productos con ubicación disponible para surtido
      let lineasQuery = supabase.from('inventario_lineas')
        .select('producto_id, cantidad, cantidad_reservada, estado_id, ubicaciones(disponible_surtido), inventario_series(id, activo, reservado)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .in('producto_id', productoIds)
        .not('ubicacion_id', 'is', null)

      // Si hay filtro de grupo, filtrar por estado
      if (estadosFiltro.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFiltro)
      }

      const { data: lineas } = await lineasQuery

      // Calcular stock disponible por producto (solo líneas con ubicación disponible para surtido)
      const stockMap: Record<string, number> = {}
      for (const linea of lineas ?? []) {
        if ((linea.ubicaciones as any)?.disponible_surtido === false) continue
        const pid = linea.producto_id
        if (!stockMap[pid]) stockMap[pid] = 0

        const tieneSeries = (linea.inventario_series ?? []).length > 0
        if (tieneSeries) {
          // Contar series activas y no reservadas
          const disponibles = (linea.inventario_series ?? [])
            .filter((s: any) => s.activo && !s.reservado).length
          stockMap[pid] += disponibles
        } else {
          // Cantidad - reservada
          const disponible = (linea.cantidad ?? 0) - (linea.cantidad_reservada ?? 0)
          stockMap[pid] += Math.max(0, disponible)
        }
      }

      // Filtrar productos con stock > 0 en el grupo y agregar stock calculado
      return prods
        .map((p: any) => ({
          ...p,
          stock_disponible: stockMap[p.id] ?? 0,
          stock_filtrado: estadosFiltro.length > 0, // indica que el stock está filtrado por grupo
        }))
        .filter((p: any) => estadosFiltro.length === 0 || (stockMap[p.id] ?? 0) > 0)
    },
    enabled: !!tenant,
  })

  const { data: clientesBusqueda = [] } = useQuery({
    queryKey: ['clientes-search', tenant?.id, clienteSearch],
    queryFn: async () => {
      let q = supabase.from('clientes').select('id, nombre, dni, telefono')
        .eq('tenant_id', tenant!.id).order('nombre').limit(10)
      if (clienteSearch) q = q.or(`nombre.ilike.%${clienteSearch}%,dni.ilike.%${clienteSearch}%`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && clienteDropOpen,
  })

  const { data: categoriasHistorial = [] } = useQuery({
    queryKey: ['categorias-historial', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  const { data: devolucionesPasadas = [] } = useQuery({
    queryKey: ['devoluciones-venta', ventaDetalle?.id],
    queryFn: async () => {
      const { data } = await supabase.from('devoluciones')
        .select('*, devolucion_items(*, productos(nombre,sku))')
        .eq('venta_id', ventaDetalle!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!ventaDetalle?.id,
  })

  const { data: ventas = [], isLoading: loadingVentas } = useQuery({
    queryKey: ['ventas', tenant?.id, filterEstado, sucursalId],
    queryFn: async () => {
      let q = supabase.from('ventas').select('*, venta_items(id, producto_id, cantidad, precio_unitario, descuento, subtotal, linea_id, productos(nombre,sku,precio_costo,tiene_series,tiene_vencimiento,regla_inventario,categoria_id), inventario_lineas(lpn), venta_series(serie_id, inventario_series(nro_serie)))')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false })
      if (filterEstado) q = q.eq('estado', filterEstado)
      q = applyFilter(q)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  // Abrir modal de venta directamente si viene con ?id= en la URL
  useEffect(() => {
    const id = searchParams.get('id')
    if (!id || loadingVentas) return
    const venta = ventas.find((v: any) => v.id === id)
    if (venta) {
      setVentaDetalle(venta)
      setSearchParams({}, { replace: true })
    }
  }, [ventas, loadingVentas, searchParams, setSearchParams])

  const agregarProducto = async (p: any) => {
    setProductoSearch('')

    // Usar stock_disponible calculado por el query (ya descuenta reservas y aplica filtro de grupo)
    const stockDisponible = p.stock_disponible ?? p.stock_actual ?? 0

    if (stockDisponible <= 0) {
      toast.error(p.stock_filtrado
        ? 'Sin stock disponible en el grupo seleccionado'
        : 'Este producto no tiene stock disponible')
      return
    }

    if (!p.precio_venta || p.precio_venta <= 0) {
      toast.error(`"${p.nombre}" no tiene precio de venta. Editá el producto antes de venderlo.`)
      return
    }

    // Si ya está en el carrito, incrementar (sumando todas las filas del mismo producto)
    const totalEnCarrito = cart.filter(c => c.producto_id === p.id).reduce((a, c) => a + c.cantidad, 0)
    if (totalEnCarrito > 0) {
      if (totalEnCarrito >= stockDisponible) { toast.error(`Stock disponible: ${stockDisponible}`); return }
      const idx = cart.findIndex(c => c.producto_id === p.id)
      setCart(prev => prev.map((c, i) => i === idx ? { ...c, cantidad: c.cantidad + 1 } : c))
      return
    }

    // Si tiene series, cargar líneas disponibles (filtrando por grupo si aplica)
    let seriesDisp: any[] = []
    if (p.tiene_series) {
      const grupoActivo = ventaGrupoId === 'todos'
        ? null
        : ventaGrupoId ? grupos.find(g => g.id === ventaGrupoId) : grupoDefault
      const estadosFiltro = grupoActivo?.estado_ids ?? []

      let lineasQuery = supabase.from('inventario_lineas')
        .select('id, lpn, estado_id, ubicaciones(disponible_surtido), inventario_series(id, nro_serie, activo, reservado)')
        .eq('producto_id', p.id).eq('activo', true)
        .not('ubicacion_id', 'is', null)

      if (estadosFiltro.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFiltro)
      }

      const { data: lineas } = await lineasQuery
      seriesDisp = (lineas ?? [])
        .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
        .flatMap((l: any) =>
          (l.inventario_series ?? [])
            .filter((s: any) => s.activo && !s.reservado)
            .map((s: any) => ({ ...s, lpn: l.lpn, linea_id: l.id }))
        )
    }

    // Para productos sin series: pre-fetch todas las líneas disponibles, calcular fuentes
    let primaryLpn: string | undefined
    let primaryLineaId: string | undefined
    let lineasDisponibles: LineaDisponible[] = []
    let lpnFuentes: LpnFuente[] = []
    if (!p.tiene_series) {
      const sortLineas = getRebajeSort(p.regla_inventario, tenant!.regla_inventario, p.tiene_vencimiento ?? false)
      const grupoActivo2 = ventaGrupoId === 'todos' ? null : ventaGrupoId ? grupos.find(g => g.id === ventaGrupoId) : grupoDefault
      const estadosFiltro2 = grupoActivo2?.estado_ids ?? []
      let lq = supabase.from('inventario_lineas')
        .select('id, lpn, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)')
        .eq('producto_id', p.id).eq('activo', true).gt('cantidad', 0).not('ubicacion_id', 'is', null)
      if (estadosFiltro2.length > 0) lq = lq.in('estado_id', estadosFiltro2)
      const { data: lineasRaw2 } = await lq
      const sortedLineas = (lineasRaw2 ?? [])
        .filter((l: any) => l.ubicaciones?.disponible_surtido !== false)
        .sort(sortLineas)
      lineasDisponibles = sortedLineas.map((l: any) => ({
        id: l.id,
        lpn: l.lpn ?? null,
        cantidad: l.cantidad,
        cantidad_reservada: l.cantidad_reservada ?? 0,
      }))
      lpnFuentes = calcularLpnFuentes(lineasDisponibles, 1)
      primaryLineaId = lpnFuentes[0]?.linea_id
      primaryLpn = lpnFuentes[0]?.lpn ?? undefined
    }

    const newItem: CartItem = {
      producto_id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      precio_unitario: p.precio_venta,
      precio_costo: p.precio_costo ?? 0,
      cantidad: 1,
      descuento: 0,
      descuento_tipo: 'pct',
      tiene_series: p.tiene_series,
      tiene_vencimiento: p.tiene_vencimiento ?? false,
      regla_inventario: p.regla_inventario ?? null,
      linea_id: primaryLineaId,
      lpn: primaryLpn,
      lineas_disponibles: lineasDisponibles,
      lpn_fuentes: lpnFuentes,
      imagen_url: p.imagen_url,
      alicuota_iva: (p as any).alicuota_iva ?? 21,
      series_seleccionadas: [],
      series_disponibles: seriesDisp,
    }
    setCart(prev => [...prev, newItem])
  }

  const handleBarcodeScan = async (code: string) => {
    setScannerOpen(false)
    // Buscar por codigo_barras o SKU exacto
    const { data: prods } = await supabase.from('productos')
      .select('id, nombre, sku, precio_venta, precio_costo, tiene_series, tiene_vencimiento, regla_inventario, stock_actual, unidad_medida, codigo_barras, es_kit, alicuota_iva')
      .eq('tenant_id', tenant!.id).eq('activo', true)
      .or(`codigo_barras.eq.${code},sku.eq.${code}`)
      .limit(1)

    if (!prods || prods.length === 0) {
      toast.error(`No se encontró ningún producto con código "${code}"`)
      return
    }
    // Calcular stock_disponible antes de agregar
    const p = { ...prods[0], stock_disponible: prods[0].stock_actual }
    await agregarProducto(p)
  }

  const updateItem = (idx: number, field: keyof CartItem, value: any) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: value }
      // Recomputa las fuentes de LPN cuando cambia la cantidad (solo non-series)
      if (field === 'cantidad' && !item.tiene_series && item.lineas_disponibles) {
        const nuevasCantidad = value as number
        const fuentes = calcularLpnFuentes(item.lineas_disponibles, nuevasCantidad)
        updated.lpn_fuentes = fuentes
        updated.linea_id = fuentes[0]?.linea_id
        updated.lpn = fuentes[0]?.lpn ?? undefined
      }
      return updated
    }))
  }

  const removeItem = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx))

  const { data: combosDisp = [] } = useQuery({
    queryKey: ['combos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('combos')
        .select('id, nombre, producto_id, cantidad, descuento_pct, descuento_tipo, descuento_monto')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const findCombo = (productoId: string, cantidad: number, item: CartItem) => {
    return (combosDisp as any[])
      .filter(c => {
        if (c.producto_id !== productoId || cantidad < c.cantidad) return false
        const tipo = c.descuento_tipo ?? 'pct'
        // No re-sugerir si ya está aplicado
        if (tipo === 'pct' && item.descuento_tipo === 'pct' && item.descuento === c.descuento_pct) return false
        if (tipo === 'monto_ars' && item.descuento_tipo === 'monto' && item.descuento === c.descuento_monto) return false
        if (tipo === 'monto_usd' && item.descuento_tipo === 'monto' && item.descuento === Math.round(c.descuento_monto * (cotizacionUSD || 1))) return false
        return true
      })
      .sort((a, b) => b.cantidad - a.cantidad)[0] ?? null
  }

  const comboDescLabel = (combo: any) => {
    const tipo = combo.descuento_tipo ?? 'pct'
    if (tipo === 'pct') return `${combo.descuento_pct}% off`
    if (tipo === 'monto_usd') return `USD ${combo.descuento_monto} off`
    return `$${combo.descuento_monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} off`
  }

  const aplicarCombo = (idx: number, combo: any) => {
    const item = cart[idx]
    const rows = calcularComboRows(item.cantidad, combo, cotizacionUSD || 1)
    const newItems: CartItem[] = rows.map(r => ({ ...item, cantidad: r.cantidad, descuento: r.descuento, descuento_tipo: r.descuento_tipo as DescTipo }))
    setCart(prev => [...prev.slice(0, idx), ...newItems, ...prev.slice(idx + 1)])
    const comboUnits = rows[0]?.cantidad ?? 0
    const rem = rows[1]?.cantidad ?? 0
    toast.success(`Combo aplicado: ${comboUnits} uds. con ${comboDescLabel(combo)}${rem > 0 ? ` + ${rem} sin descuento` : ''}`)
  }

  // Auto-aplicar combos cuando cambia el carrito
  const autoComboSig = useRef('')
  useEffect(() => {
    if (!combosDisp.length) return
    const sig = cart.map(i => `${i.producto_id}:${i.cantidad}:${i.descuento}:${i.descuento_tipo}`).join('|')
    if (sig === autoComboSig.current) return
    autoComboSig.current = sig

    const changes = new Map<string, CartItem[]>()
    const processed = new Set<string>()

    for (const item of cart) {
      if (item.tiene_series || processed.has(item.producto_id)) continue
      processed.add(item.producto_id)

      const productRows = cart.filter(r => r.producto_id === item.producto_id)
      const totalQty = productRows.reduce((s, r) => s + r.cantidad, 0)

      const combo = (combosDisp as any[])
        .filter(c => c.producto_id === item.producto_id && totalQty >= c.cantidad)
        .sort((a: any, b: any) => b.cantidad - a.cantidad)[0]
      if (!combo) continue

      const rows = calcularComboRows(totalQty, combo, cotizacionUSD || 1)
      const target: CartItem[] = rows.map(r => ({ ...item, cantidad: r.cantidad, descuento: r.descuento, descuento_tipo: r.descuento_tipo as DescTipo }))

      const curSig = productRows.map(r => `${r.cantidad}:${r.descuento}:${r.descuento_tipo}`).sort().join(',')
      const tgtSig = target.map(r => `${r.cantidad}:${r.descuento}:${r.descuento_tipo}`).sort().join(',')
      if (curSig !== tgtSig) {
        changes.set(item.producto_id, target)
        toast.success(`Combo aplicado: ${combo.cantidad}× con ${comboDescLabel(combo)}`)
      }
    }

    if (!changes.size) return

    const done = new Set<string>()
    const newCart: CartItem[] = []
    for (const item of cart) {
      if (changes.has(item.producto_id) && !done.has(item.producto_id)) {
        done.add(item.producto_id)
        newCart.push(...changes.get(item.producto_id)!)
      } else if (!changes.has(item.producto_id)) {
        newCart.push(item)
      }
    }

    const newSig = newCart.map(i => `${i.producto_id}:${i.cantidad}:${i.descuento}:${i.descuento_tipo}`).join('|')
    autoComboSig.current = newSig
    setCart(newCart)
  }, [cart, combosDisp, cotizacionUSD])

  const splitItem = (idx: number) => {
    setCart(prev => {
      const item = prev[idx]
      if (item.cantidad <= 1) return prev
      const reduced = { ...item, cantidad: item.cantidad - 1 }
      const newRow: CartItem = { ...item, cantidad: 1, descuento: 0, descuento_tipo: 'pct' }
      return [...prev.slice(0, idx), reduced, newRow, ...prev.slice(idx + 1)]
    })
  }

  const getItemSubtotal = (item: CartItem) => {
    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
    const base = item.precio_unitario * cant
    if (item.descuento_tipo === 'pct') return base * (1 - item.descuento / 100)
    return Math.max(0, base - item.descuento)
  }

  const subtotal = cart.reduce((acc, item) => acc + getItemSubtotal(item), 0)
  const descTotalVal = parseFloat(descuentoTotal) || 0
  const descTotalMonto = descuentoTotalTipo === 'pct' ? subtotal * descTotalVal / 100 : descTotalVal
  const total = Math.max(0, subtotal - descTotalMonto)

  // Medios de pago helpers
  const updateMedioPago = (idx: number, field: keyof MedioPagoItem, value: string) =>
    setMediosPago(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  const addMedioPago = () => setMediosPago(prev => [...prev, { tipo: '', monto: '' }])
  const removeMedioPago = (idx: number) => setMediosPago(prev => prev.filter((_, i) => i !== idx))

  const serializeMediosPago = (items: MedioPagoItem[], totalVenta: number): string | null => {
    const filled = items.filter(m => m.tipo)
    if (filled.length === 0) return null
    if (filled.length === 1 && !filled[0].monto)
      return JSON.stringify([{ tipo: filled[0].tipo, monto: totalVenta }])
    return JSON.stringify(filled.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) || 0 })))
  }

  const formatMedioPago = (raw: string | null | undefined): string => {
    if (!raw) return ''
    try {
      const arr = JSON.parse(raw) as { tipo: string; monto: number }[]
      if (Array.isArray(arr))
        return arr.map(p => p.monto ? `${p.tipo} $${p.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : p.tipo).join(' + ')
    } catch {}
    return raw
  }

  const totalAsignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const totalFaltante = total - totalAsignado

  const registrarVenta = async (estado: 'pendiente' | 'reservada' | 'despachada') => {
    if (cart.length === 0) { toast.error('Agregá al menos un producto'); return }
    for (const item of cart) {
      if (item.tiene_series && item.series_seleccionadas.length === 0) {
        toast.error(`Seleccioná las series para ${item.nombre}`); return
      }
      if (item.tiene_series && item.series_seleccionadas.length !== item.cantidad) {
        toast.error(`Seleccioná ${item.cantidad} serie(s) para ${item.nombre}`); return
      }
    }
    // Cliente obligatorio para pendiente y reservada
    if ((estado === 'pendiente' || estado === 'reservada') && !clienteId) {
      toast.error('Registrá o seleccioná un cliente para continuar.')
      return
    }
    // Validar medios de pago
    const errorPago = validarMediosPago(estado, mediosPago, total)
    if (errorPago) { toast.error(errorPago); return }
    const vuelto = calcularVuelto(mediosPago, total)
    const montoEfectivoCaja = calcularEfectivoCaja(mediosPago, total)
    if (estado === 'despachada' || estado === 'reservada') {
      if (sesionesAbiertas.length === 0) {
        toast.error('No hay caja abierta. Abrí una caja antes de registrar ventas.')
        return
      }
      if (sesionesAbiertas.length > 1 && !cajaSeleccionadaId) {
        toast.error('Hay varias cajas abiertas. Seleccioná en cuál registrar la venta.')
        return
      }
    }
    setSaving(true)
    const stockAlertas: Array<{ nombre: string; sku: string; stock_actual: number; stock_minimo: number }> = []
    try {
      // Crear venta
      const { data: venta, error: ventaError } = await supabase.from('ventas').insert({
        tenant_id: tenant!.id,
        cliente_id: clienteId || null,
        cliente_nombre: clienteNombre || null,
        cliente_telefono: clienteTelefono || null,
        estado,
        subtotal,
        descuento_total: descuentoTotalTipo === 'pct' ? descTotalVal : 0,
        total,
        medio_pago: serializeMediosPago(mediosPago, total),
        monto_pagado: estado === 'pendiente' ? 0 : Math.min(mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0), total),
        notas: notas || null,
        usuario_id: user?.id,
        sucursal_id: sucursalId || null,
        ...(estado === 'despachada' ? { despachado_at: new Date().toISOString() } : {}),
      }).select().single()
      if (ventaError) throw ventaError

      // Crear items
      for (const item of cart) {
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const itemSubtotal = getItemSubtotal(item)

        // Calcular linea_id para trazabilidad LPN→venta
        let ventaItemLineaId: string | null = null
        if (item.tiene_series && item.series_seleccionadas.length > 0) {
          const firstSerie = item.series_disponibles.find((s: any) => s.id === item.series_seleccionadas[0])
          ventaItemLineaId = firstSerie?.linea_id ?? null
          const allSameLinea = item.series_seleccionadas.every(sid => {
            const s = item.series_disponibles.find((d: any) => d.id === sid)
            return s?.linea_id === ventaItemLineaId
          })
          if (!allSameLinea) ventaItemLineaId = null
        } else {
          ventaItemLineaId = item.linea_id ?? null
        }

        const ivaRate = item.alicuota_iva ?? 21
        const ivaMonto = ivaRate > 0 ? itemSubtotal - itemSubtotal / (1 + ivaRate / 100) : 0

        const { data: ventaItem, error: itemError } = await supabase.from('venta_items').insert({
          tenant_id: tenant!.id,
          venta_id: venta.id,
          producto_id: item.producto_id,
          linea_id: ventaItemLineaId,
          cantidad: cant,
          precio_unitario: item.precio_unitario,
          precio_costo_historico: item.precio_costo || null,
          descuento: item.descuento_tipo === 'pct' ? item.descuento : 0,
          subtotal: itemSubtotal,
          alicuota_iva: ivaRate,
          iva_monto: parseFloat(ivaMonto.toFixed(2)),
        }).select().single()
        if (itemError) throw itemError

        // Guardar series seleccionadas
        if (item.tiene_series && item.series_seleccionadas.length > 0) {
          const { error: seriesError } = await supabase.from('venta_series').insert(
            item.series_seleccionadas.map(sid => ({
              tenant_id: tenant!.id,
              venta_id: venta.id,
              venta_item_id: ventaItem.id,
              serie_id: sid,
            }))
          )
          if (seriesError) throw seriesError

          if (estado === 'reservada') {
            await supabase.from('inventario_series').update({ reservado: true }).in('id', item.series_seleccionadas)
          } else if (estado === 'despachada') {
            await supabase.from('inventario_series').update({ activo: false, reservado: false }).in('id', item.series_seleccionadas)
          }
        }

        if (!item.tiene_series) {
          const sortLineas = getRebajeSort(item.regla_inventario, tenant!.regla_inventario, item.tiene_vencimiento)
          if (estado === 'reservada') {
            const { data: lineasRaw } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)').eq('producto_id', item.producto_id)
              .eq('activo', true).gt('cantidad', 0).not('ubicacion_id', 'is', null)
            const lineas = (lineasRaw ?? []).filter((l: any) => l.ubicaciones?.disponible_surtido !== false).sort(sortLineas)
            let restante = cant
            for (const linea of lineas) {
              if (restante <= 0) break
              const disponible = linea.cantidad - (linea.cantidad_reservada ?? 0)
              const areservar = Math.min(disponible, restante)
              if (areservar > 0) {
                await supabase.from('inventario_lineas')
                  .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + areservar }).eq('id', linea.id)
                restante -= areservar
              }
            }
          } else if (estado === 'despachada') {
            const { data: lineasRaw } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)').eq('producto_id', item.producto_id)
              .eq('activo', true).gt('cantidad', 0).not('ubicacion_id', 'is', null)
            const lineas = (lineasRaw ?? []).filter((l: any) => l.ubicaciones?.disponible_surtido !== false).sort(sortLineas)
            let restante = cant
            for (const linea of lineas) {
              if (restante <= 0) break
              const rebajar = Math.min(linea.cantidad, restante)
              const nuevaCant = linea.cantidad - rebajar
              await supabase.from('inventario_lineas')
                .update({ cantidad: nuevaCant, activo: nuevaCant > 0 }).eq('id', linea.id)
              restante -= rebajar
            }
          }
        }
        // B1: Sincronizar stock_actual y registrar movimiento al despachar
        if (estado === 'despachada') {
          const { data: prodData } = await supabase.from('productos')
            .select('stock_actual, stock_minimo, nombre, sku').eq('id', item.producto_id).single()
          if (prodData) {
            const stockAntes = prodData.stock_actual
            const stockDespues = Math.max(0, stockAntes - cant)
            await supabase.from('productos').update({ stock_actual: stockDespues }).eq('id', item.producto_id)
            await supabase.from('movimientos_stock').insert({
              tenant_id: tenant!.id,
              producto_id: item.producto_id,
              tipo: 'rebaje',
              cantidad: cant,
              stock_antes: stockAntes,
              stock_despues: stockDespues,
              motivo: `Venta #${venta.numero}`,
              usuario_id: user?.id,
              venta_id: venta.id,
            })
            // Alerta de stock bajo (fire-and-forget)
            if (stockDespues <= (prodData.stock_minimo ?? 0)) {
              stockAlertas.push({ nombre: prodData.nombre, sku: prodData.sku ?? '', stock_actual: stockDespues, stock_minimo: prodData.stock_minimo ?? 0 })
            }
          }
        }
      } // cierre del for (const item of cart)

      // Emails transaccionales (fire-and-forget, no bloquean el flujo)
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const ownerEmail = authUser?.email
      if (ownerEmail) {
        if (estado === 'despachada') {
          supabase.functions.invoke('send-email', {
            body: {
              type: 'venta_confirmada',
              to: ownerEmail,
              data: {
                numero: venta.numero,
                negocio: tenant!.nombre,
                total,
                items: cart.map(i => ({ nombre: i.nombre, cantidad: i.tiene_series ? i.series_seleccionadas.length : i.cantidad, subtotal: getItemSubtotal(i) })),
                medio_pago: serializeMediosPago(mediosPago, total) ?? '',
              },
            },
          }).catch(() => {/* silencioso */})
        }
        for (const alerta of stockAlertas) {
          supabase.functions.invoke('send-email', {
            body: { type: 'alerta_stock', to: ownerEmail, data: { ...alerta, negocio: tenant!.nombre } },
          }).catch(() => {/* silencioso */})
        }
      }

      logActividad({ entidad: 'venta', entidad_id: venta.id, entidad_nombre: `Venta #${venta.numero ?? ''}`, accion: 'crear', valor_nuevo: estado, pagina: '/ventas' })
      if (estado === 'despachada' && montoEfectivoCaja > 0 && sesionCajaId) {
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionCajaId,
          tipo: 'ingreso',
          concepto: `Venta #${venta.numero}`,
          monto: montoEfectivoCaja,
          usuario_id: user?.id,
        }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
      }
      // Registros informativos para medios no-efectivo (no afectan saldo)
      const totalNoCash = total - montoEfectivoCaja
      if (estado === 'despachada' && sesionCajaId && totalNoCash > 0.01) {
        const tiposNoCash = [...new Set(
          mediosPago.filter(m => m.tipo && m.tipo !== 'Efectivo' && m.tipo !== '').map(m => m.tipo)
        )].join(' + ')
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionCajaId,
          tipo: 'ingreso_informativo',
          concepto: `[${tiposNoCash || 'No efectivo'}] Venta #${venta.numero}`,
          monto: totalNoCash,
          usuario_id: user?.id,
        })
      }
      // Seña en caja: registrar efectivo cobrado al crear la reserva (fire-and-forget)
      if (estado === 'reservada' && montoEfectivoCaja > 0 && sesionCajaId) {
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant!.id,
          sesion_id: sesionCajaId,
          tipo: 'ingreso_reserva',
          concepto: `Seña Venta #${venta.numero}`,
          monto: montoEfectivoCaja,
          usuario_id: user?.id,
        }).then(() => qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] }))
      }
      // Seña no-efectivo: registrar como ingreso_informativo (fire-and-forget)
      if (estado === 'reservada' && sesionCajaId) {
        const totalNoCashSena = total - montoEfectivoCaja
        if (totalNoCashSena > 0.01) {
          const tiposNoCash = [...new Set(
            mediosPago.filter(m => m.tipo && m.tipo !== 'Efectivo' && m.tipo !== '').map(m => m.tipo)
          )].join(' + ')
          void supabase.from('caja_movimientos').insert({
            tenant_id: tenant!.id,
            sesion_id: sesionCajaId,
            tipo: 'ingreso_informativo',
            concepto: `[${tiposNoCash || 'No efectivo'}] Seña Venta #${venta.numero}`,
            monto: totalNoCashSena,
            usuario_id: user?.id,
          })
        }
      }
      const msg = estado === 'despachada' ? 'Venta finalizada' : estado === 'reservada' ? 'Venta reservada' : 'Venta registrada'
      toast.success(msg)
      setTicketVenta({ ...venta, items: cart.map(i => ({ ...i, subtotal: getItemSubtotal(i) })), vuelto: vuelto > 0.5 ? vuelto : 0 })
      setCart([]); setClienteId(null); setClienteSearch(''); setClienteNombre(''); setClienteTelefono('')
      setMediosPago([{ tipo: '', monto: '' }]); setDescuentoTotal(''); setNotas(''); setModoVenta('reservada')
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      setTab('nueva')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al registrar la venta')
    } finally {
      setSaving(false)
    }
  }

  const guardarMontoPagado = async () => {
    const nuevo = parseFloat(editMontoPagado)
    if (isNaN(nuevo) || nuevo < 0) { toast.error('Monto inválido'); return }
    if (nuevo > ventaDetalle!.total) { toast.error(`No puede superar el total ($${ventaDetalle!.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })})`); return }
    setSavingMontoPagado(true)
    try {
      const { error } = await supabase.from('ventas').update({ monto_pagado: nuevo }).eq('id', ventaDetalle!.id)
      if (error) throw error
      setVentaDetalle((prev: any) => ({ ...prev, monto_pagado: nuevo }))
      qc.invalidateQueries({ queryKey: ['ventas'] })
      setEditandoPago(false)
      toast.success('Pago actualizado')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al actualizar')
    } finally {
      setSavingMontoPagado(false)
    }
  }

  const modificarReserva = async () => {
    if (!ventaDetalle) return
    if (!confirm('¿Modificar esta reserva? Se cancelará la reserva actual y los productos volverán al carrito para que crees una nueva.')) return
    // Cancelar la reserva actual (libera stock reservado) y registrar motivo
    await cambiarEstado.mutateAsync({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' }).catch(() => null)
    const notaAnterior = ventaDetalle.notas ? `${ventaDetalle.notas} | ` : ''
    void supabase.from('ventas').update({
      notas: `${notaAnterior}Cancelada por modificación de productos — ${new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} por ${user?.nombre_display ?? 'usuario'}`
    }).eq('id', ventaDetalle.id)
    // Pre-poblar el carrito con los items de la venta
    const itemsBase: CartItem[] = (ventaDetalle.venta_items ?? [])
      .filter((item: any) => item.producto_id)
      .map((item: any) => ({
        producto_id: item.producto_id,
        nombre: item.productos?.nombre ?? '',
        sku: item.productos?.sku ?? '',
        precio_unitario: item.precio_unitario,
        precio_costo: item.productos?.precio_costo ?? 0,
        cantidad: item.cantidad,
        descuento: item.descuento ?? 0,
        descuento_tipo: 'pct' as DescTipo,
        tiene_series: item.productos?.tiene_series ?? false,
        tiene_vencimiento: item.productos?.tiene_vencimiento ?? false,
        regla_inventario: item.productos?.regla_inventario ?? null,
        series_seleccionadas: [],
        series_disponibles: [],
      }))
    // Para productos serializados, cargar series disponibles (activas y no reservadas)
    const cartConSeries = await Promise.all(itemsBase.map(async (cartItem) => {
      if (!cartItem.tiene_series) return cartItem
      const { data: lineasData } = await supabase.from('inventario_lineas')
        .select('id, lpn, inventario_series(id, nro_serie, activo, reservado)')
        .eq('producto_id', cartItem.producto_id)
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
      const seriesDisp = (lineasData ?? []).flatMap((l: any) =>
        (l.inventario_series ?? [])
          .filter((s: any) => s.activo && !s.reservado)
          .map((s: any) => ({ ...s, linea_id: l.id, lpn: l.lpn }))
      )
      return { ...cartItem, series_disponibles: seriesDisp }
    }))
    setCart(cartConSeries)
    if (ventaDetalle.cliente_id) { setClienteId(ventaDetalle.cliente_id); setClienteNombre(ventaDetalle.cliente_nombre ?? ''); setClienteTelefono(ventaDetalle.cliente_telefono ?? '') }
    // Restaurar medios de pago ya cobrados (monto_pagado de la reserva original)
    if (ventaDetalle.monto_pagado > 0) {
      const pagosRestaurados = restaurarMediosPago(ventaDetalle.medio_pago)
      if (pagosRestaurados.length > 0) setMediosPago(pagosRestaurados)
    }
    setModoVenta('reservada')
    setVentaDetalle(null)
    setTab('nueva')
    toast.success('Reserva cancelada — editá el carrito y volvé a reservar')
  }

  const abrirModalDevolucion = (venta: any) => {
    const items = (venta.venta_items ?? []).map((item: any) => ({
      venta_item_id: item.id,
      producto_id: item.producto_id,
      nombre: item.productos?.nombre ?? '',
      cantidad_original: item.cantidad,
      precio_unitario: item.precio_unitario,
      tiene_series: (item.productos?.tiene_series ?? false),
      venta_series: (item.venta_series ?? []).map((vs: any) => ({
        serie_id: vs.serie_id,
        nro_serie: vs.inventario_series?.nro_serie ?? '',
      })),
      cantidad_devolver: item.tiene_series ? 0 : item.cantidad,
      series_seleccionadas: [],
    }))
    setDevItems(items)
    setDevMotivo('')
    setDevMediosPago([{ tipo: '', monto: '' }])
    setDevolucionVenta(venta)
  }

  const procesarDevolucion = async () => {
    if (!devolucionVenta || !tenant) return
    const itemsADevolver = devItems.filter(i =>
      i.tiene_series ? i.series_seleccionadas.length > 0 : i.cantidad_devolver > 0
    )
    if (itemsADevolver.length === 0) {
      toast.error('Seleccioná al menos un ítem a devolver')
      return
    }

    // Validar que existe ubicación y estado de devolución configurados
    const { data: ubicDevData } = await supabase.from('ubicaciones')
      .select('id').eq('tenant_id', tenant.id).eq('es_devolucion', true).single()
    if (!ubicDevData) {
      toast.error('Configurá una ubicación de devolución en Configuración → Ubicaciones antes de continuar')
      return
    }
    const { data: estadoDevData } = await supabase.from('estados_inventario')
      .select('id').eq('tenant_id', tenant.id).eq('es_devolucion', true).single()
    if (!estadoDevData) {
      toast.error('Configurá un estado de devolución en Configuración → Estados antes de continuar')
      return
    }
    const ubicDevId = ubicDevData.id
    const estadoDevId = estadoDevData.id

    // Calcular monto total de la devolución
    const montoTotal = itemsADevolver.reduce((acc, i) => {
      const cant = i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver
      return acc + i.precio_unitario * cant
    }, 0)

    // Validar medio de pago si hay monto
    const mediosValidos = devMediosPago.filter(m => m.tipo && parseFloat(m.monto) > 0)
    const totalMedios = mediosValidos.reduce((a, m) => a + parseFloat(m.monto), 0)
    const hayEfectivo = mediosValidos.some(m => m.tipo === 'Efectivo')

    if (montoTotal > 0 && Math.abs(totalMedios - montoTotal) > 0.5) {
      toast.error(`Los medios de devolución ($${totalMedios.toLocaleString('es-AR', { maximumFractionDigits: 0 })}) no cubren el total ($${montoTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })})`)
      return
    }
    if (hayEfectivo && !sesionCajaId) {
      toast.error('No hay caja abierta. Abrí una caja antes de devolver en efectivo.')
      return
    }

    setDevSaving(true)
    let devId: string | null = null
    try {
      // 1. Calcular número NC si es facturada
      let numero_nc: string | null = null
      if (devolucionVenta.estado === 'facturada') {
        const { count } = await supabase.from('devoluciones')
          .select('id', { count: 'exact', head: true })
          .eq('venta_id', devolucionVenta.id)
        numero_nc = `NC-${devolucionVenta.numero}-${(count ?? 0) + 1}`
      }

      // 2. Insertar devolución
      const { data: dev, error: devError } = await supabase.from('devoluciones').insert({
        tenant_id: tenant.id,
        venta_id: devolucionVenta.id,
        numero_nc,
        origen: devolucionVenta.estado as 'despachada' | 'facturada',
        motivo: devMotivo || null,
        monto_total: montoTotal,
        medio_pago: mediosValidos.length > 0 ? JSON.stringify(mediosValidos.map(m => ({ tipo: m.tipo, monto: parseFloat(m.monto) }))) : null,
        created_by: user?.id,
      }).select().single()
      if (devError) throw devError
      devId = dev.id

      // 3. Procesar cada ítem
      for (const item of itemsADevolver) {
        const cantDev = item.tiene_series ? item.series_seleccionadas.length : item.cantidad_devolver

        if (item.tiene_series) {
          // Reactivar series originales
          await supabase.from('inventario_series')
            .update({ activo: true, reservado: false })
            .in('id', item.series_seleccionadas)
          // Buscar la linea de la primera serie para saber dónde está
          const { data: serieData } = await supabase.from('inventario_series')
            .select('linea_id').eq('id', item.series_seleccionadas[0]).single()
          if (serieData?.linea_id) {
            await supabase.from('inventario_lineas')
              .update({ activo: true })
              .eq('id', serieData.linea_id)
          }
          // Insertar devolucion_item sin linea_nueva (la serie ya existe)
          await supabase.from('devolucion_items').insert({
            devolucion_id: dev.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            precio_unitario: item.precio_unitario,
          })
          // Recalcular stock manualmente (trigger solo se ejecuta en UPDATE de inventario_series)
          const { data: prodData } = await supabase.from('productos').select('stock_actual').eq('id', item.producto_id).single()
          if (prodData) {
            await supabase.from('productos').update({ stock_actual: prodData.stock_actual + cantDev }).eq('id', item.producto_id)
          }
        } else {
          // No serializado: crear nueva inventario_lineas en ubicación DEV
          const { data: linea, error: lineaErr } = await supabase.from('inventario_lineas').insert({
            tenant_id: tenant.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            ubicacion_id: ubicDevId,
            estado_id: estadoDevId,
            notas: `Devolución de venta #${devolucionVenta.numero}`,
          }).select().single()
          if (lineaErr) throw lineaErr
          // Movimiento de ingreso
          const { data: prodData } = await supabase.from('productos').select('stock_actual').eq('id', item.producto_id).single()
          if (prodData) {
            await supabase.from('movimientos_stock').insert({
              tenant_id: tenant.id,
              producto_id: item.producto_id,
              tipo: 'ingreso',
              cantidad: cantDev,
              stock_antes: prodData.stock_actual,
              stock_despues: prodData.stock_actual + cantDev,
              motivo: `Devolución venta #${devolucionVenta.numero}`,
              usuario_id: user?.id,
              linea_id: linea.id,
              venta_id: devolucionVenta.id,
            })
          }
          // Insertar devolucion_item con referencia a la nueva linea
          await supabase.from('devolucion_items').insert({
            devolucion_id: dev.id,
            producto_id: item.producto_id,
            cantidad: cantDev,
            precio_unitario: item.precio_unitario,
            inventario_linea_nueva_id: linea.id,
          })
        }
      }

      // 4. Egreso en caja si hay efectivo
      if (hayEfectivo && sesionCajaId) {
        const montoEfectivo = mediosValidos
          .filter(m => m.tipo === 'Efectivo')
          .reduce((a, m) => a + parseFloat(m.monto), 0)
        void supabase.from('caja_movimientos').insert({
          tenant_id: tenant.id,
          sesion_id: sesionCajaId,
          tipo: 'egreso',
          concepto: `Devolución venta #${devolucionVenta.numero}${numero_nc ? ` · ${numero_nc}` : ''}`,
          monto: montoEfectivo,
          usuario_id: user?.id,
        })
      }

      // Marcar venta como "devuelta" si el total devuelto cubre el 100% del total
      const { data: todasDev } = await supabase
        .from('devoluciones')
        .select('monto_total')
        .eq('venta_id', devolucionVenta.id)
      const totalDevuelto = (todasDev ?? []).reduce((acc, d) => acc + Number(d.monto_total), 0)
      if (totalDevuelto >= Number(devolucionVenta.total) - 0.5) {
        await supabase.from('ventas').update({ estado: 'devuelta' }).eq('id', devolucionVenta.id)
      }

      toast.success(`Devolución procesada${numero_nc ? ` · ${numero_nc}` : ''}`)
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })

      // Mostrar comprobante
      setDevComprobante({
        numero_nc,
        venta_numero: devolucionVenta.numero,
        origen: devolucionVenta.estado,
        motivo: devMotivo,
        items: itemsADevolver.map(i => ({
          nombre: i.nombre,
          cantidad: i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver,
          precio_unitario: i.precio_unitario,
        })),
        monto_total: montoTotal,
        medio_pago: mediosValidos,
        created_at: new Date().toISOString(),
      })
      setDevolucionVenta(null)
    } catch (err: any) {
      // Rollback manual: eliminar el header de devolución si ya se insertó
      if (devId) {
        await supabase.from('devoluciones').delete().eq('id', devId)
      }
      toast.error(err.message ?? 'Error al procesar devolución')
    } finally {
      setDevSaving(false)
    }
  }

  const cambiarEstado = useMutation({
    mutationFn: async ({ ventaId, nuevoEstado, saldoMediosPago }: { ventaId: string; nuevoEstado: EstadoVenta; saldoMediosPago?: MedioPagoItem[] }) => {
      const venta = ventas.find((v: any) => v.id === ventaId)
      if (!venta) throw new Error('Venta no encontrada')

      if (nuevoEstado === 'despachada' || nuevoEstado === 'reservada') {
        if (sesionesAbiertas.length === 0) throw new Error('No hay caja abierta. Abrí una caja antes de continuar.')
        if (nuevoEstado === 'despachada' && sesionesAbiertas.length > 1 && !cajaSeleccionadaId)
          throw new Error('Hay varias cajas abiertas. Seleccioná en cuál registrar la venta desde el checkout.')
      }

      if (nuevoEstado === 'despachada') {
        const errorDespacho = validarDespacho(Number(venta.total ?? 0), Number(venta.monto_pagado ?? 0), saldoMediosPago)
        if (errorDespacho) throw new Error(errorDespacho)
      }

      const { data: items } = await supabase.from('venta_items')
        .select('*, venta_series(serie_id), productos(tiene_series, tiene_vencimiento, regla_inventario)')
        .eq('venta_id', ventaId)

      if (nuevoEstado === 'reservada') {
        // Reservar series y cantidad en líneas
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            await supabase.from('inventario_series').update({ reservado: true }).in('id', serieIds)
          } else {
            const prod = item.productos as any
            const sortLineas = getRebajeSort(prod?.regla_inventario, tenant!.regla_inventario, prod?.tiene_vencimiento ?? false)
            const { data: lineasRaw } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0).not('ubicacion_id', 'is', null)
            const lineas = (lineasRaw ?? []).filter((l: any) => l.ubicaciones?.disponible_surtido !== false).sort(sortLineas)
            let restante = item.cantidad
            for (const linea of lineas) {
              if (restante <= 0) break
              const disponible = linea.cantidad - (linea.cantidad_reservada ?? 0)
              const areservar = Math.min(disponible, restante)
              if (areservar > 0) {
                await supabase.from('inventario_lineas')
                  .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + areservar })
                  .eq('id', linea.id)
                restante -= areservar
              }
            }
          }
        }
        await supabase.from('ventas').update({ estado: 'reservada' }).eq('id', ventaId)

      } else if (nuevoEstado === 'despachada') {
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            // Desactivar series y quitar reserva
            await supabase.from('inventario_series')
              .update({ activo: false, reservado: false }).in('id', serieIds)
          } else {
            const prod = item.productos as any
            const sortLineas = getRebajeSort(prod?.regla_inventario, tenant!.regla_inventario, prod?.tiene_vencimiento ?? false)
            const { data: lineasRaw } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada, created_at, fecha_vencimiento, ubicaciones(prioridad, disponible_surtido)')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0).not('ubicacion_id', 'is', null)
            const lineas = (lineasRaw ?? []).filter((l: any) => l.ubicaciones?.disponible_surtido !== false).sort(sortLineas)
            let restante = item.cantidad
            for (const linea of lineas) {
              if (restante <= 0) break
              const rebajar = Math.min(linea.cantidad, restante)
              const nuevaCant = linea.cantidad - rebajar
              const nuevaReserva = Math.max(0, (linea.cantidad_reservada ?? 0) - rebajar)
              await supabase.from('inventario_lineas')
                .update({ cantidad: nuevaCant, cantidad_reservada: nuevaReserva, activo: nuevaCant > 0 })
                .eq('id', linea.id)
              restante -= rebajar
            }
          }
          // B1: Sincronizar stock_actual y registrar movimiento
          const { data: prodData } = await supabase.from('productos')
            .select('stock_actual').eq('id', item.producto_id).single()
          if (prodData) {
            const stockAntes = prodData.stock_actual
            const stockDespues = Math.max(0, stockAntes - item.cantidad)
            await supabase.from('productos').update({ stock_actual: stockDespues }).eq('id', item.producto_id)
            await supabase.from('movimientos_stock').insert({
              tenant_id: tenant!.id,
              producto_id: item.producto_id,
              tipo: 'rebaje',
              cantidad: item.cantidad,
              stock_antes: stockAntes,
              stock_despues: stockDespues,
              motivo: `Venta #${venta.numero}`,
              usuario_id: user?.id,
              venta_id: ventaId,
            })
          }
        }
        // Acumular saldo en medio_pago si lo hay
        let montoPagadoFinal = venta.monto_pagado ?? 0
        let mediosPagoFinal = venta.medio_pago
        if (saldoMediosPago && saldoMediosPago.length > 0) {
          const prevArr: { tipo: string; monto: number }[] = venta.medio_pago ? JSON.parse(venta.medio_pago) : []
          const acumulado = acumularMediosPago(prevArr, saldoMediosPago)
          mediosPagoFinal = JSON.stringify(acumulado)
          montoPagadoFinal += saldoMediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
        }
        await supabase.from('ventas')
          .update({ estado: 'despachada', despachado_at: new Date().toISOString(), medio_pago: mediosPagoFinal, monto_pagado: montoPagadoFinal })
          .eq('id', ventaId)
        // Registrar en caja el efectivo del saldo + la seña si no fue registrada al reservar
        const _sesionId = cajaSeleccionadaId ?? (sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null)
        if (_sesionId) {
          try {
            // Efectivo del saldo cobrado ahora
            const pagosSaldo = saldoMediosPago?.filter(m => m.tipo === 'Efectivo' && parseFloat(m.monto) > 0) ?? []
            const efectivoSaldo = pagosSaldo.reduce((s, m) => s + parseFloat(m.monto), 0)
            // Verificar si la seña ya fue registrada en caja al crear la reserva
            const { data: senaEnCaja } = await supabase.from('caja_movimientos')
              .select('monto').eq('tenant_id', tenant!.id)
              .eq('tipo', 'ingreso_reserva')
              .eq('concepto', `Seña Venta #${venta.numero}`)
              .maybeSingle()
            // Si ya está en caja: no duplicar. Si no: incluir seña en el ingreso (reserva sin sesión activa)
            const efectivoOriginal = senaEnCaja
              ? 0
              : (() => {
                  if (venta.medio_pago) {
                    try {
                      const arr = JSON.parse(venta.medio_pago) as { tipo: string; monto: number }[]
                      return arr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
                    } catch { return 0 }
                  }
                  return 0
                })()
            const efectivoTotal = efectivoSaldo + efectivoOriginal
            if (efectivoTotal > 0) {
              await supabase.from('caja_movimientos').insert({
                tenant_id: tenant!.id,
                sesion_id: _sesionId,
                tipo: 'ingreso',
                concepto: `Venta #${venta.numero}`,
                monto: efectivoTotal,
                usuario_id: user?.id,
              })
            }
            // No-efectivo: saldo cobrado ahora + no-efectivo original de la reserva
            const noCashSaldoItems = (saldoMediosPago ?? []).filter(m => m.tipo && m.tipo !== 'Efectivo' && parseFloat(m.monto) > 0)
            const noCashSaldoTotal = noCashSaldoItems.reduce((s, m) => s + parseFloat(m.monto), 0)
            const prevArr: { tipo: string; monto: number }[] = venta.medio_pago ? (() => { try { return JSON.parse(venta.medio_pago) } catch { return [] } })() : []
            // Non-cash original de reserva solo si ya fue registrado como ingreso_informativo (si no hubo sesión al reservar, no está en caja)
            const noCashOriginalTotal = senaEnCaja
              ? prevArr.filter(m => m.tipo !== 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
              : 0
            const noCashTotal = noCashSaldoTotal + noCashOriginalTotal
            if (noCashTotal > 0.01) {
              const tiposNoCash = [...new Set([
                ...noCashSaldoItems.map(m => m.tipo),
                ...(senaEnCaja ? prevArr.filter(m => m.tipo !== 'Efectivo').map(m => m.tipo) : []),
              ].filter(Boolean))].join(' + ')
              void supabase.from('caja_movimientos').insert({
                tenant_id: tenant!.id,
                sesion_id: _sesionId,
                tipo: 'ingreso_informativo',
                concepto: `[${tiposNoCash || 'No efectivo'}] Venta #${venta.numero}`,
                monto: noCashTotal,
                usuario_id: user?.id,
              })
            }
          } catch {}
        }

      } else if (nuevoEstado === 'cancelada') {
        // Liberar reservas
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            await supabase.from('inventario_series').update({ reservado: false }).in('id', serieIds)
          } else {
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad_reservada')
              .eq('producto_id', item.producto_id).eq('activo', true)
              .gt('cantidad_reservada', 0)
            let restante = item.cantidad
            for (const linea of lineas ?? []) {
              if (restante <= 0) break
              const liberar = Math.min(linea.cantidad_reservada ?? 0, restante)
              await supabase.from('inventario_lineas')
                .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) - liberar })
                .eq('id', linea.id)
              restante -= liberar
            }
          }
        }
        await supabase.from('ventas')
          .update({ estado: 'cancelada', cancelado_at: new Date().toISOString() })
          .eq('id', ventaId)
        // Dev. seña: si la reserva tenía efectivo cobrado → egreso en caja (fire-and-forget)
        if ((venta.monto_pagado ?? 0) > 0) {
          const cancelSesionId = cajaSeleccionadaId ?? (sesionesAbiertas.length > 0 ? (sesionesAbiertas[0] as any).id : null)
          if (cancelSesionId) {
            try {
              const prevArr = venta.medio_pago ? JSON.parse(venta.medio_pago) as { tipo: string; monto: number }[] : []
              const efectivoCobrado = prevArr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
              if (efectivoCobrado > 0) {
                void supabase.from('caja_movimientos').insert({
                  tenant_id: tenant!.id,
                  sesion_id: cancelSesionId,
                  tipo: 'egreso_devolucion_sena',
                  concepto: `Dev. seña Venta #${venta.numero}`,
                  monto: efectivoCobrado,
                  usuario_id: user?.id,
                })
              }
            } catch {}
          }
        }

      } else {
        await supabase.from('ventas').update({ estado: nuevoEstado }).eq('id', ventaId)
      }
      logActividad({ entidad: 'venta', entidad_id: ventaId, entidad_nombre: `Venta #${venta.numero ?? ''}`, accion: 'cambio_estado', valor_anterior: venta.estado, valor_nuevo: nuevoEstado, pagina: '/ventas' })
    },
    onSuccess: () => {
      toast.success('Estado actualizado')
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['caja-sesiones-abiertas', tenant?.id] })
      setVentaDetalle(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const filteredVentas = ventas.filter((v: any) => {
    if (searchHistorial) {
      const s = searchHistorial.toLowerCase()
      if (!v.numero?.toString().includes(s) && !(v.cliente_nombre ?? '').toLowerCase().includes(s)) return false
    }
    if (filterCategoria) {
      const tieneCategoria = (v.venta_items ?? []).some((item: any) => item.productos?.categoria_id === filterCategoria)
      if (!tieneCategoria) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Ventas</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Registrá y gestioná tus ventas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 -mb-2">
        {[{ id: 'nueva', label: 'Nueva venta', icon: Plus }, { id: 'historial', label: 'Historial', icon: FileText }].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`flex items-center gap-2 py-2.5 px-4 text-sm font-medium transition-all border-b-2 -mb-px
              ${tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── NUEVA VENTA ── */}
      {tab === 'nueva' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">

            {/* Buscador de productos */}
            <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds">
              <h2 className="font-semibold text-primary mb-3 flex items-center gap-2"><ShoppingCart size={16} /> Agregar productos</h2>

              {/* Filtro por grupo */}
              {grupos.length > 0 && (
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <Layers size={13} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">Ver stock de:</span>
                  <button onClick={() => setVentaGrupoId('todos')}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all
                      ${ventaGrupoId === 'todos' ? 'bg-primary text-white border-primary' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:border-gray-600'}`}>
                    Todos
                  </button>
                  {grupos.map(g => (
                    <button key={g.id}
                      onClick={() => setVentaGrupoId(ventaGrupoId === g.id ? null : g.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                        ${ventaGrupoId === g.id || (ventaGrupoId === null && g.es_default)
                          ? 'bg-primary text-white border-primary'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:border-gray-600'}`}>
                      {g.nombre}
                      {g.es_default && ventaGrupoId === null && <span className="text-yellow-300">★</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input type="text" value={productoSearch} onChange={e => setProductoSearch(e.target.value)}
                    placeholder="Buscar por nombre, SKU o código..."
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                  {viewMode === 'lista' && productosBusqueda.length > 0 && searchFocused && (
                    <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                      {(productosBusqueda as any[]).map(p => (
                        <button key={p.id} onClick={() => agregarProducto(p)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm border-b border-gray-50 last:border-0 flex items-center gap-3">
                          {/* Imagen pequeña */}
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {p.imagen_url
                              ? <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover" />
                              : <Package size={14} className="text-gray-300" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-medium truncate">{p.nombre}</span>
                              <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">{p.sku}</span>
                              {p.tiene_series && <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1 rounded flex-shrink-0">series</span>}
                              {p.es_kit && <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1 rounded flex-shrink-0" title="Producto KIT — asegurate de tener stock armado">KIT</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-semibold text-primary">${p.precio_venta?.toLocaleString('es-AR')}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {p.stock_filtrado
                                ? <span className="text-blue-600 dark:text-blue-400 font-medium">{p.stock_disponible} disp.</span>
                                : `${p.stock_actual} stock`
                              }
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors flex-shrink-0"
                  title="Escanear código de barras"
                >
                  <Camera size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode(v => v === 'lista' ? 'galeria' : 'lista')}
                  className={`px-3 py-2.5 border rounded-xl transition-colors flex-shrink-0
                    ${viewMode === 'galeria' ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-accent'}`}
                  title={viewMode === 'lista' ? 'Vista galería' : 'Vista lista'}
                >
                  {viewMode === 'lista' ? <LayoutGrid size={17} /> : <List size={17} />}
                </button>
              </div>

              {/* Galería de productos */}
              {viewMode === 'galeria' && productosBusqueda.length > 0 && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[28rem] overflow-y-auto pr-1">
                  {(productosBusqueda as any[]).map(p => (
                    <button key={p.id} onClick={() => agregarProducto(p)}
                      className="flex flex-col items-center text-center p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-accent hover:shadow-sm transition-all bg-surface h-full">
                      <div className="w-full aspect-square bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden mb-2">
                        {p.imagen_url
                          ? <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover rounded-lg" />
                          : <Package size={22} className="text-gray-300" />
                        }
                      </div>
                      <p className="text-xs font-medium text-primary line-clamp-2 leading-tight w-full">{p.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate w-full">{p.sku}</p>
                      <p className="text-sm font-bold text-primary mt-1">${p.precio_venta?.toLocaleString('es-AR')}</p>
                      <p className="text-xs mt-0.5">
                        {p.stock_filtrado
                          ? <span className="text-blue-600 dark:text-blue-400 font-medium">{p.stock_disponible} disp.</span>
                          : <span className={`${(p.stock_disponible ?? p.stock_actual) <= 0 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              {p.stock_disponible ?? p.stock_actual} stock
                            </span>
                        }
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Carrito */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl shadow-sm border border-border-ds overflow-hidden">
                <div className="px-4 py-3 border-b border-border-ds bg-page">
                  <h2 className="font-semibold text-primary flex items-center gap-2"><Package size={16} /> {cart.length} producto{cart.length !== 1 ? 's' : ''}</h2>
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-600">
                  {cart.map((item, idx) => (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <p className="font-medium text-primary">{item.nombre}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400 dark:text-gray-500">{item.sku}</span>
                            {!item.tiene_series && item.lpn_fuentes && item.lpn_fuentes.length > 0 && (
                              <>
                                {item.lpn_fuentes.slice(0, 3).map((f, fi) => (
                                  <span key={fi} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                                    {f.lpn ?? 'Sin LPN'}{item.lpn_fuentes!.length > 1 ? ` (${f.cantidad}u)` : ''}
                                  </span>
                                ))}
                                {item.lpn_fuentes.length > 3 && (
                                  <span className="text-xs text-gray-400 dark:text-gray-500">+{item.lpn_fuentes.length - 3} más</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!item.tiene_series && item.cantidad > 1 && (
                            <button onClick={() => splitItem(idx)} title="Separar 1 unidad con descuento diferente"
                              className="text-gray-300 hover:text-blue-400 transition-colors">
                              <Scissors size={14} />
                            </button>
                          )}
                          <button onClick={() => removeItem(idx)} title="Quitar producto del carrito" className="text-gray-300 hover:text-red-400 transition-colors"><X size={16} /></button>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-2">
                        {/* Cantidad */}
                        {!item.tiene_series && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => updateItem(idx, 'cantidad', Math.max(1, item.cantidad - 1))} title="Reducir cantidad"
                              className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">−</button>
                            <input
                              type="number" onWheel={e => e.currentTarget.blur()} min="1" value={item.cantidad}
                              onChange={e => updateItem(idx, 'cantidad', Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-12 text-center text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg py-0.5 focus:outline-none focus:border-accent"
                            />
                            <button onClick={() => updateItem(idx, 'cantidad', item.cantidad + 1)} title="Aumentar cantidad"
                              className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50">+</button>
                          </div>
                        )}

                        {/* Precio (sólo lectura — se edita desde Productos) */}
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-xs">$</span>
                          <div className="w-full pl-5 pr-2 py-1.5 border border-border-ds rounded-lg text-sm bg-page text-muted select-none">
                            {item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                          </div>
                        </div>

                        {/* Descuento con toggle % / $ */}
                        <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden w-28">
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={item.descuento}
                            onChange={e => updateItem(idx, 'descuento', parseFloat(e.target.value) || 0)}
                            className="w-full pl-2 pr-1 py-1.5 text-sm focus:outline-none" placeholder="0" />
                          <button onClick={() => updateItem(idx, 'descuento_tipo', item.descuento_tipo === 'pct' ? 'monto' : 'pct')}
                            title="Cambiar tipo de descuento (% o $)"
                            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-500 dark:text-gray-400 text-xs font-bold border-l border-gray-200 dark:border-gray-700 transition-colors">
                            {item.descuento_tipo === 'pct' ? '%' : '$'}
                          </button>
                        </div>

                        {/* Subtotal */}
                        <p className="text-sm font-semibold text-primary w-20 text-right">
                          ${getItemSubtotal(item).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>

                      {/* Precio tachado cuando hay descuento */}
                      {item.descuento > 0 && (() => {
                        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                        const precioOriginal = item.precio_unitario * cant
                        const precioFinal = getItemSubtotal(item)
                        return (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Precio lista:{' '}
                            <span className="line-through">${precioOriginal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                            {' '}→{' '}
                            <span className="text-green-600 dark:text-green-400 font-medium">${precioFinal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          </p>
                        )
                      })()}

                      {/* Sugerencia de combo */}
                      {!item.tiene_series && (() => {
                        const combo = findCombo(item.producto_id, item.cantidad, item)
                        if (!combo) return null
                        return (
                          <div className="mt-1.5 flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg px-3 py-1.5 border border-amber-200">
                            <Gift size={12} />
                            <span className="flex-1">Combo: {combo.cantidad}× con {comboDescLabel(combo)} disponible</span>
                            <button onClick={() => aplicarCombo(idx, combo)}
                              className="font-semibold hover:underline text-amber-800 dark:text-amber-400">
                              Aplicar
                            </button>
                          </div>
                        )
                      })()}

                      {/* Series */}
                      {item.tiene_series && (
                        <div className="mt-2">
                          <button onClick={() => setSeriesModal({ itemIdx: idx, lineas: item.series_disponibles })}
                            className="flex items-center gap-1.5 text-xs text-accent hover:underline">
                            <Hash size={12} />
                            {item.series_seleccionadas.length > 0
                              ? `${item.series_seleccionadas.length} serie(s) seleccionada(s) — cambiar`
                              : 'Seleccionar series'}
                          </button>
                          {item.series_seleccionadas.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.series_seleccionadas.map(sid => {
                                const s = item.series_disponibles.find(d => d.id === sid)
                                return s ? (
                                  <span key={sid} className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 px-1.5 py-0.5 rounded">{s.nro_serie}</span>
                                ) : null
                              })}
                            </div>
                          )}
                          {item.series_seleccionadas.length > 0 && (() => {
                            const lpns = [...new Set(item.series_seleccionadas.map(sid => {
                              const s = item.series_disponibles.find((d: any) => d.id === sid)
                              return s?.lpn as string | undefined
                            }).filter(Boolean))] as string[]
                            if (lpns.length === 0) return null
                            return (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {lpns.map(lpn => (
                                  <span key={lpn} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                                    {lpn}
                                  </span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Panel lateral */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1">
            {/* Cliente */}
            <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
              <h2 className="font-semibold text-primary flex items-center gap-2"><User size={16} /> Cliente</h2>
              {/* Autocomplete cliente registrado */}
              <div className="relative">
                {clienteId ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 border border-blue-300 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm">
                    <span className="flex-1 font-medium text-blue-800 dark:text-blue-400">{clienteNombre}</span>
                    <button onClick={() => { setClienteId(null); setClienteNombre(''); setClienteTelefono(''); setClienteSearch('') }} title="Quitar cliente" className="text-blue-400 hover:text-blue-700 dark:text-blue-400"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={clienteSearch}
                      onChange={e => { setClienteSearch(e.target.value); setClienteDropOpen(true) }}
                      onFocus={() => setClienteDropOpen(true)}
                      onBlur={() => setTimeout(() => setClienteDropOpen(false), 150)}
                      placeholder="Buscar por nombre o DNI..."
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                    />
                    {clienteDropOpen && clientesBusqueda.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {clientesBusqueda.map((c: any) => (
                          <button
                            key={c.id}
                            onMouseDown={() => {
                              setClienteId(c.id)
                              setClienteNombre(c.nombre)
                              setClienteTelefono(c.telefono ?? '')
                              setClienteSearch('')
                              setClienteDropOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm"
                          >
                            <span className="font-medium">{c.nombre}</span>
                            {c.dni && <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">DNI {c.dni}</span>}
                            {c.telefono && <span className="text-gray-400 dark:text-gray-500 ml-2">{c.telefono}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Registrar cliente nuevo inline */}
              {!clienteId && (
                nuevoClienteOpen ? (
                  <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-3 space-y-2 bg-blue-50 dark:bg-blue-900/10">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Nuevo cliente</p>
                    <input value={nuevoClienteForm.nombre} onChange={e => setNuevoClienteForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo *" autoFocus
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={nuevoClienteForm.dni} onChange={e => setNuevoClienteForm(f => ({ ...f, dni: e.target.value }))}
                        placeholder="DNI *"
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                      <input value={nuevoClienteForm.telefono} onChange={e => setNuevoClienteForm(f => ({ ...f, telefono: e.target.value }))}
                        placeholder="Teléfono *"
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setNuevoClienteOpen(false); setNuevoClienteForm({ nombre: '', dni: '', telefono: '' }) }}
                        className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-sm py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50">
                        Cancelar
                      </button>
                      <button onClick={registrarClienteInline} disabled={savingCliente}
                        className="flex-1 bg-accent hover:bg-accent/90 text-white text-sm font-semibold py-2 rounded-xl disabled:opacity-50">
                        {savingCliente ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNuevoClienteOpen(true)}
                    className="w-full text-sm text-accent border border-dashed border-accent/40 rounded-xl py-2 hover:bg-accent/5 transition-colors">
                    + Registrar cliente nuevo
                  </button>
                )
              )}
            </div>

            {/* Descuento general + Notas — solo para reservada/despachada */}
            {modoVenta !== 'pendiente' && cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Descuento general</label>
                  {descTotalVal > 0 && cart.some(i => i.descuento > 0) && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <span>⚠️</span>
                      <span>Hay descuentos por producto <strong>y</strong> descuento general activos</span>
                    </div>
                  )}
                  <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={descuentoTotal}
                      onChange={e => setDescuentoTotal(e.target.value)}
                      placeholder="0"
                      className="flex-1 px-3 py-2.5 text-sm focus:outline-none" />
                    <button onClick={() => setDescuentoTotalTipo(t => t === 'pct' ? 'monto' : 'pct')}
                      title="Cambiar tipo de descuento (% o $)"
                      className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-600 dark:text-gray-400 text-sm font-bold border-l border-gray-200 dark:border-gray-700 transition-colors min-w-10">
                      {descuentoTotalTipo === 'pct' ? '%' : '$'}
                    </button>
                  </div>
                </div>
                <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
                  placeholder="Notas (opcional)"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent resize-none" />
              </div>
            )}

            {/* Totales */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-2">
                {(() => {
                  const subtotalSinDesc = cart.reduce((acc, item) => {
                    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                    return acc + item.precio_unitario * cant
                  }, 0)
                  const descItemsTotal = subtotalSinDesc - subtotal
                  return (
                    <>
                      <div className="flex justify-between text-sm text-muted">
                        <span>Precio lista</span>
                        <span>${subtotalSinDesc.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      {descItemsTotal > 0 && (
                        <div className="flex justify-between text-sm text-info">
                          <span>Desc. por producto</span>
                          <span>−${descItemsTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-muted">
                        <span>Subtotal</span>
                        <span>${subtotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </>
                  )
                })()}
                {descTotalMonto > 0 && (
                  <div className="flex justify-between text-sm text-success">
                    <span>Desc. general {descuentoTotalTipo === 'pct' ? `(${descTotalVal}%)` : `($${descTotalVal})`}</span>
                    <span>−${descTotalMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-primary text-lg border-t border-border-ds pt-2">
                  <span>Total</span>
                  <span>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
                {/* IVA desglosado por alícuota real */}
                {total > 0 && (() => {
                  const ivaByRate: Record<number, number> = {}
                  cart.forEach(item => {
                    const itemSubtotal = getItemSubtotal(item)
                    const rate = item.alicuota_iva ?? 21
                    if (rate > 0) {
                      const iva = itemSubtotal - itemSubtotal / (1 + rate / 100)
                      ivaByRate[rate] = (ivaByRate[rate] ?? 0) + iva
                    }
                  })
                  const entries = Object.entries(ivaByRate)
                  if (entries.length === 0) return null
                  return (
                    <div className="space-y-0.5">
                      {entries.map(([rate, amount]) => (
                        <div key={rate} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                          <span>IVA {rate}% incluido</span>
                          <span>${(amount as number).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Método de pago — solo para reservada/despachada */}
            {modoVenta !== 'pendiente' && cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-3">
                <h2 className="font-semibold text-primary flex items-center gap-2"><CreditCard size={16} /> Método de pago</h2>

                {mediosPago.map((mp, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={mp.tipo} onChange={e => updateMedioPago(idx, 'tipo', e.target.value)}
                      className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                      <option value="">Medio de pago...</option>
                      {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                      onChange={e => updateMedioPago(idx, 'monto', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder="Monto"
                      className="w-24 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    {mediosPago.length > 1 && (
                      <button onClick={() => removeMedioPago(idx)} title="Quitar medio de pago" className="text-gray-400 dark:text-gray-500 hover:text-red-500 flex-shrink-0">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}

                <button onClick={addMedioPago}
                  className="flex items-center gap-1 text-xs text-accent hover:underline">
                  <Plus size={12} /> Agregar otro medio
                </button>

                {cart.length > 0 && totalAsignado > 0 && (() => {
                  const vueltoUI = calcularVuelto(mediosPago, total)
                  const esVuelto = vueltoUI > 0.5
                  return (
                    <p className={`text-xs text-right font-medium ${totalFaltante === 0 ? 'text-green-600 dark:text-green-400' : totalFaltante > 0 ? 'text-orange-500' : esVuelto ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {totalFaltante === 0
                        ? '✓ Total cubierto'
                        : totalFaltante > 0
                          ? `Falta asignar: $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                          : esVuelto
                            ? `Vuelto: $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                            : `Excede por: $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                    </p>
                  )
                })()}
              </div>
            )}

            {/* Acciones — estado caja + modo + botón */}
            {cart.length > 0 && (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-border-ds space-y-2">
                {(() => {
                  const efectivo = calcularEfectivo(mediosPago, total)
                  if (sesionesAbiertas.length === 0) return (
                    <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg px-3 py-2.5">
                      <span>⚠️</span><span>Sin caja abierta — no se puede vender ni reservar</span>
                    </div>
                  )
                  if (sesionesAbiertas.length > 1) return (
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Registrar en caja:</label>
                      <select value={cajaSeleccionadaId ?? ''} onChange={e => setCajaSeleccionadaId(e.target.value || null)}
                        className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent">
                        <option value="">— Seleccioná una caja —</option>
                        {(sesionesAbiertas as any[]).map(s => (
                          <option key={s.id} value={s.id}>{s.cajas?.nombre ?? 'Caja'}</option>
                        ))}
                      </select>
                    </div>
                  )
                  return (
                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-lg px-3 py-2.5">
                      <span>✓</span><span>{efectivo > 0 ? 'Efectivo' : 'Venta'} → {(sesionesAbiertas[0] as any).cajas?.nombre ?? 'Caja'}</span>
                    </div>
                  )
                })()}
                <div className="space-y-2 pt-1">
                  <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium">
                    {([
                      ['reservada', 'Reservar', ShoppingCart],
                      ['despachada', 'Venta directa', Zap],
                      ['pendiente', 'Presupuesto', FileText],
                    ] as const).map(([modo, label, Icon]) => (
                      <button key={modo} onClick={() => setModoVenta(modo)}
                        className={`flex-1 flex items-center justify-center gap-1 py-2 transition-colors ${modoVenta === modo ? 'bg-accent text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                        <Icon size={11} />{label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => registrarVenta(modoVenta)} disabled={saving}
                    className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {modoVenta === 'reservada' ? <ShoppingCart size={16} /> : modoVenta === 'despachada' ? <Zap size={16} /> : <FileText size={16} />}
                    {saving ? 'Guardando...' : modoVenta === 'reservada' ? 'Reservar stock' : modoVenta === 'despachada' ? 'Venta directa' : 'Guardar presupuesto'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={searchHistorial} onChange={e => setSearchHistorial(e.target.value)}
                placeholder="Buscar por N° o cliente..."
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value as EstadoVenta | '')}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {categoriasHistorial.length > 0 && (
              <select value={filterCategoria} onChange={e => setFilterCategoria(e.target.value)}
                className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                <option value="">Todas las categorías</option>
                {categoriasHistorial.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </div>

          <div className="bg-surface rounded-xl shadow-sm border border-border-ds overflow-hidden">
            {loadingVentas ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredVentas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <ShoppingCart size={40} className="mb-3 opacity-50" />
                <p>No hay ventas registradas</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-600">
                {filteredVentas.map((v: any) => {
                  const est = ESTADOS[v.estado as EstadoVenta]
                  return (
                    <div key={v.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                      onClick={() => setVentaDetalle(v)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-primary">#{v.numero}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>{est.label}</span>
                          {v.estado === 'reservada' && calcularSaldoPendiente(v.total ?? 0, v.monto_pagado ?? 0) > 0.5 && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                              Saldo ${calcularSaldoPendiente(v.total, v.monto_pagado ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-primary">${v.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-gray-400 dark:text-gray-500">
                        <span>{v.cliente_nombre ?? 'Sin cliente'} {v.medio_pago ? `· ${formatMedioPago(v.medio_pago)}` : ''}</span>
                        <span>{new Date(v.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(v.venta_items ?? []).map((item: any) => (
                          <span key={item.id} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">
                            {item.cantidad}× {item.productos?.nombre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal detalle venta */}
      {ventaDetalle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-primary">Venta #{ventaDetalle.numero}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.bg} ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.color}`}>
                    {ESTADOS[ventaDetalle.estado as EstadoVenta]?.label}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(ventaDetalle.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              </div>
              <button onClick={() => { setVentaDetalle(null); setEditandoPago(false) }} title="Cerrar" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>

            {ventaDetalle.cliente_nombre && (
              <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">Cliente:</span> {ventaDetalle.cliente_nombre}
                {ventaDetalle.cliente_telefono && ` · ${ventaDetalle.cliente_telefono}`}
              </div>
            )}

            <div className="space-y-2 mb-4">
              {(ventaDetalle.venta_items ?? []).map((item: any) => {
                const nrosSerie = (item.venta_series ?? [])
                  .map((vs: any) => vs.inventario_series?.nro_serie)
                  .filter(Boolean)
                const lpn = item.inventario_lineas?.lpn
                return (
                  <div key={item.id} className="flex justify-between text-sm bg-page rounded-xl px-3 py-2">
                    <div>
                      <p className="font-medium">{item.productos?.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{item.cantidad} × ${item.precio_unitario?.toLocaleString('es-AR')}</p>
                      {item.descuento > 0 && (() => {
                        const descMonto = (item.precio_unitario * item.cantidad) - item.subtotal
                        return (
                          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                            Descuento {item.descuento}% · −${descMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </p>
                        )
                      })()}
                      {nrosSerie.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {nrosSerie.map((s: string) => (
                            <span key={s} className="text-xs text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                        </div>
                      )}
                      {nrosSerie.length === 0 && lpn && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded mt-1 inline-block">LPN: {lpn}</span>
                      )}
                    </div>
                    <p className="font-semibold">${item.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-100 pt-3 mb-4 space-y-1 text-sm">
              {ventaDetalle.descuento_total > 0 && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>Descuento {ventaDetalle.descuento_total}%</span>
                  <span>−${(ventaDetalle.subtotal * ventaDetalle.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-primary text-base">
                <span>Total</span>
                <span>${ventaDetalle.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              {(ventaDetalle.total ?? 0) > 0 && (
                <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                  <span>IVA incluido (21%)</span>
                  <span>${((ventaDetalle.total ?? 0) - (ventaDetalle.total ?? 0) / 1.21).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              {ventaDetalle.medio_pago && <p className="text-gray-500 dark:text-gray-400">Medio de pago: {formatMedioPago(ventaDetalle.medio_pago)}</p>}
              {/* Pago parcial en reserva */}
              {ventaDetalle.estado === 'reservada' && (() => {
                const saldo = calcularSaldoPendiente(ventaDetalle.total ?? 0, ventaDetalle.monto_pagado ?? 0)
                return (
                  <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-700 dark:text-blue-300">Ya cobrado</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-300">${(ventaDetalle.monto_pagado ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                    {saldo > 0.5 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-600 dark:text-orange-400 font-semibold">Saldo pendiente</span>
                        <span className="font-bold text-orange-600 dark:text-orange-400">${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    )}
                    {editandoPago ? (
                      <div className="flex gap-2 items-center pt-1">
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={ventaDetalle.total} value={editMontoPagado}
                          onChange={e => setEditMontoPagado(e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent"
                          placeholder="Nuevo monto cobrado" autoFocus />
                        <button onClick={guardarMontoPagado} disabled={savingMontoPagado}
                          className="px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                          {savingMontoPagado ? '...' : 'Guardar'}
                        </button>
                        <button onClick={() => setEditandoPago(false)} className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditandoPago(true); setEditMontoPagado(String(ventaDetalle.monto_pagado ?? 0)) }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        Editar monto cobrado
                      </button>
                    )}
                  </div>
                )
              })()}
              {ventaDetalle.notas && (
                ventaDetalle.estado === 'cancelada'
                  ? (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5 text-sm">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5 uppercase tracking-wide">Motivo de cancelación</p>
                      <p className="text-red-700 dark:text-red-300">{ventaDetalle.notas}</p>
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Notas: {ventaDetalle.notas}</p>
                  )
              )}
            </div>

            {/* Devoluciones previas colapsable */}
            {devolucionesPasadas.length > 0 && (
              <div className="mb-4 rounded-xl border border-orange-200 dark:border-orange-800 overflow-hidden">
                <button
                  onClick={() => setDevolucionesOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-orange-50 dark:bg-orange-900/20 text-sm font-medium text-orange-700 dark:text-orange-400">
                  <span className="flex items-center gap-2"><RotateCcw size={14} /> Devoluciones ({devolucionesPasadas.length})</span>
                  {devolucionesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {devolucionesOpen && (
                  <div className="divide-y divide-orange-100 dark:divide-orange-800/40">
                    {(devolucionesPasadas as any[]).map((d: any) => (
                      <div key={d.id} className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="font-medium text-orange-600 dark:text-orange-400">{d.numero_nc ?? 'Sin NC'}</span>
                          <span>{new Date(d.created_at).toLocaleDateString('es-AR')}</span>
                        </div>
                        {d.motivo && <p className="text-gray-400 dark:text-gray-500">{d.motivo}</p>}
                        {(d.devolucion_items ?? []).map((di: any) => (
                          <p key={di.id}>{di.cantidad}× {di.productos?.nombre} — ${(di.precio_unitario * di.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                        ))}
                        <p className="font-semibold text-orange-600 dark:text-orange-400">Total: ${d.monto_total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Acciones según estado */}
            <div className="space-y-2">
              <button
                onClick={() => {
                  const items = (ventaDetalle.venta_items ?? []).map((item: any) => {
                    const nrosSerie = (item.venta_series ?? [])
                      .map((vs: any) => vs.inventario_series?.nro_serie)
                      .filter(Boolean)
                    return {
                      nombre: item.productos?.nombre ?? '',
                      cantidad: item.cantidad,
                      precio_unitario: item.precio_unitario,
                      descuento: item.descuento ?? 0,
                      descuento_tipo: 'pct' as DescTipo,
                      subtotal: item.subtotal,
                      tiene_series: nrosSerie.length > 0,
                      series_seleccionadas: nrosSerie,
                      lpn: item.inventario_lineas?.lpn ?? null,
                    }
                  })
                  setTicketVenta({ ...ventaDetalle, items })
                }}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm">
                <Printer size={15} /> Ver / Imprimir ticket
              </button>
              {ventaDetalle.estado === 'pendiente' && (
                <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'reservada' })}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all">
                  Reservar stock
                </button>
              )}
              {(ventaDetalle.estado === 'pendiente' || ventaDetalle.estado === 'reservada') && (
                <button onClick={() => {
                  const saldo = calcularSaldoPendiente(ventaDetalle.total ?? 0, ventaDetalle.monto_pagado ?? 0)
                  if (saldo > 0.5) {
                    setSaldoModal({
                      ventaId: ventaDetalle.id,
                      total: ventaDetalle.total,
                      montoPagado: ventaDetalle.monto_pagado ?? 0,
                      mediosPago: [{ tipo: '', monto: saldo.toFixed(2) }],
                    })
                  } else {
                    cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'despachada' })
                  }
                }}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2">
                  <Truck size={16} /> Finalizar (rebaja stock)
                </button>
              )}
              {ventaDetalle.estado === 'despachada' && (
                <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'facturada' })}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all">
                  Marcar como facturada
                </button>
              )}
              {['despachada', 'facturada'].includes(ventaDetalle.estado) && (
                <button onClick={() => abrirModalDevolucion(ventaDetalle)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-orange-200 text-orange-600 dark:text-orange-400 font-semibold py-2.5 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all text-sm">
                  <RotateCcw size={15} /> Devolver
                </button>
              )}
              {ventaDetalle.estado === 'reservada' && (
                <button onClick={modificarReserva} disabled={cambiarEstado.isPending}
                  className="w-full border-2 border-amber-200 text-amber-700 dark:text-amber-400 font-semibold py-2.5 rounded-xl hover:bg-amber-50 dark:bg-amber-900/20 transition-all text-sm flex items-center justify-center gap-2">
                  <ShoppingCart size={15} /> Modificar productos (cancela y recrea)
                </button>
              )}
              {['pendiente', 'reservada'].includes(ventaDetalle.estado) && (
                <button onClick={() => {
                  if (confirm('¿Cancelar esta venta? El stock reservado quedará disponible.'))
                    cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' })
                }}
                  disabled={cambiarEstado.isPending}
                  className="w-full border-2 border-red-200 text-red-600 dark:text-red-400 font-semibold py-2.5 rounded-xl hover:bg-red-50 dark:bg-red-900/20 transition-all">
                  Cancelar venta
                </button>
              )}
              {['cancelada', 'pendiente'].includes(ventaDetalle.estado) && (
                <button onClick={async () => {
                  if (!confirm('¿Eliminar definitivamente esta venta? Esta acción no se puede deshacer.')) return
                  const { error } = await supabase.from('ventas').delete().eq('id', ventaDetalle.id)
                  if (error) { toast.error('Error al eliminar'); return }
                  toast.success('Venta eliminada')
                  setVentaDetalle(null)
                  qc.invalidateQueries({ queryKey: ['ventas'] })
                }}
                  className="w-full border-2 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:border-red-200 hover:text-red-500 transition-all text-sm">
                  Eliminar venta
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal DEVOLUCIÓN */}
      {devolucionVenta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-primary flex items-center gap-2"><RotateCcw size={18} className="text-orange-500" /> Procesar devolución</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Venta #{devolucionVenta.numero} · {devolucionVenta.estado === 'facturada' ? 'Se generará nota de crédito' : 'Registra devolución sin NC'}</p>
              </div>
              <button onClick={() => setDevolucionVenta(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600 dark:text-gray-500"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Ítems a devolver */}
              <div>
                <p className="text-sm font-medium text-primary mb-2">Ítems a devolver</p>
                <div className="space-y-2">
                  {devItems.map((item, idx) => (
                    <div key={item.venta_item_id} className="bg-page rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{item.nombre}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">${item.precio_unitario.toLocaleString('es-AR', { maximumFractionDigits: 0 })} c/u</p>
                      </div>
                      {item.tiene_series ? (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Seleccioná series a devolver:</p>
                          <div className="flex flex-wrap gap-1">
                            {item.venta_series.map(vs => {
                              const sel = item.series_seleccionadas.includes(vs.serie_id)
                              return (
                                <button key={vs.serie_id}
                                  onClick={() => setDevItems(prev => prev.map((it, i) => i !== idx ? it : {
                                    ...it,
                                    series_seleccionadas: sel
                                      ? it.series_seleccionadas.filter(s => s !== vs.serie_id)
                                      : [...it.series_seleccionadas, vs.serie_id]
                                  }))}
                                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${sel ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-400 text-orange-700 dark:text-orange-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                                  {vs.nro_serie}
                                </button>
                              )
                            })}
                          </div>
                          {item.series_seleccionadas.length > 0 && (
                            <p className="text-xs text-orange-600 dark:text-orange-400">{item.series_seleccionadas.length} serie(s) · ${(item.precio_unitario * item.series_seleccionadas.length).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 mt-1">
                          <label className="text-xs text-gray-500 dark:text-gray-400">Cant. a devolver (máx {item.cantidad_original}):</label>
                          <input type="number" onWheel={e => e.currentTarget.blur()} min="0" max={item.cantidad_original}
                            value={item.cantidad_devolver}
                            onChange={e => setDevItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, cantidad_devolver: Math.min(item.cantidad_original, Math.max(0, parseInt(e.target.value) || 0)) }))}
                            className="w-20 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent" />
                          {item.cantidad_devolver > 0 && (
                            <span className="text-xs text-orange-600 dark:text-orange-400">${(item.precio_unitario * item.cantidad_devolver).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Total */}
              {(() => {
                const total = devItems.reduce((acc, i) => {
                  const cant = i.tiene_series ? i.series_seleccionadas.length : i.cantidad_devolver
                  return acc + i.precio_unitario * cant
                }, 0)
                return total > 0 ? (
                  <div className="flex justify-between items-center font-semibold text-sm bg-orange-50 dark:bg-orange-900/20 rounded-xl px-4 py-2.5 text-orange-700 dark:text-orange-300">
                    <span>Total a devolver</span>
                    <span>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                ) : null
              })()}

              {/* Motivo */}
              <div>
                <label className="block text-sm font-medium text-primary mb-1">Motivo (opcional)</label>
                <input type="text" value={devMotivo} onChange={e => setDevMotivo(e.target.value)}
                  placeholder="Producto dañado, talla incorrecta..."
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
              </div>

              {/* Medio de devolución */}
              <div>
                <label className="block text-sm font-medium text-primary mb-1">Medio de devolución</label>
                <div className="space-y-2">
                  {devMediosPago.map((mp, idx) => (
                    <div key={idx} className="flex gap-2">
                      <select value={mp.tipo} onChange={e => setDevMediosPago(prev => prev.map((m, i) => i !== idx ? m : { ...m, tipo: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent">
                        <option value="">Sin devolución monetaria</option>
                        {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {mp.tipo && (
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                          onChange={e => setDevMediosPago(prev => prev.map((m, i) => i !== idx ? m : { ...m, monto: e.target.value }))}
                          placeholder="Monto"
                          className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
                      )}
                      {devMediosPago.length > 1 && (
                        <button onClick={() => setDevMediosPago(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500 p-1"><X size={16} /></button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setDevMediosPago(prev => [...prev, { tipo: '', monto: '' }])}
                    className="text-xs text-accent hover:underline">+ Agregar medio</button>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setDevolucionVenta(null)}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                Cancelar
              </button>
              <button onClick={procesarDevolucion} disabled={devSaving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                {devSaving ? 'Procesando...' : <><RotateCcw size={15} /> Confirmar devolución</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal COMPROBANTE DEVOLUCIÓN */}
      {devComprobante && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6" id="devolucion-print">
            <div className="text-center mb-4 border-b border-dashed border-gray-300 dark:border-gray-600 pb-4">
              <p className="text-lg font-bold text-primary">{tenant?.nombre ?? 'Genesis360'}</p>
              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 mt-1">
                {devComprobante.numero_nc ?? 'Comprobante de devolución'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Venta #{devComprobante.venta_numero} · {new Date(devComprobante.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            {devComprobante.motivo && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Motivo: {devComprobante.motivo}</p>
            )}
            <div className="space-y-1.5 mb-4">
              {devComprobante.items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>{item.cantidad}× {item.nombre}</span>
                  <span className="font-medium">${(item.precio_unitario * item.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-gray-300 dark:border-gray-600 pt-3">
              <div className="flex justify-between font-bold text-base text-orange-600 dark:text-orange-400">
                <span>Total devuelto</span>
                <span>${devComprobante.monto_total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              {devComprobante.medio_pago?.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {devComprobante.medio_pago.map((m: any) => `${m.tipo} $${m.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`).join(' + ')}
                </p>
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => { window.print(); }}
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm flex items-center justify-center gap-2">
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => setDevComprobante(null)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl text-sm">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal TICKET */}
      {ticketVenta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6" id="ticket-print">
            <div className="text-center mb-4 border-b border-dashed border-gray-300 dark:border-gray-600 pb-4">
              <p className="text-lg font-bold text-primary">{tenant?.nombre ?? 'Genesis360'}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {new Date(ticketVenta.created_at ?? Date.now()).toLocaleString('es-AR', {
                  dateStyle: 'full', timeStyle: 'short'
                })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Venta #{ticketVenta.numero ?? '—'}</p>
            </div>

            {ticketVenta.cliente_nombre && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                <span className="font-medium">Cliente:</span> {ticketVenta.cliente_nombre}
              </p>
            )}

            <div className="space-y-1.5 mb-4">
              {(ticketVenta.items ?? []).map((item: any, i: number) => {
                const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                const precioOriginalItem = item.precio_unitario * cant
                return (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="font-medium">{item.nombre}</span>
                      <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">× {cant}</span>
                      {item.descuento > 0 && (
                        <span className="text-green-600 dark:text-green-400 text-xs ml-1">
                          -{item.descuento_tipo === 'pct' ? `${item.descuento}%` : `$${item.descuento}`}
                        </span>
                      )}
                      {item.tiene_series && (item.series_seleccionadas ?? []).length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                          S/N: {(item.series_seleccionadas as string[]).join(', ')}
                        </p>
                      )}
                      {!item.tiene_series && item.lpn_fuentes && item.lpn_fuentes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {item.lpn_fuentes.slice(0, 3).map((f: LpnFuente, fi: number) => (
                            <span key={fi} className="text-xs text-blue-600 dark:text-blue-400">
                              LPN: {f.lpn ?? '—'}{item.lpn_fuentes!.length > 1 ? ` (${f.cantidad}u)` : ''}
                            </span>
                          ))}
                          {item.lpn_fuentes.length > 3 && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">+{item.lpn_fuentes.length - 3} más</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {item.descuento > 0 && (
                        <span className="line-through text-gray-300 text-xs mr-1">
                          ${precioOriginalItem.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </span>
                      )}
                      <span className="font-medium">${item.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const precioLista = (ticketVenta.items ?? []).reduce((acc: number, item: any) => {
                const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                return acc + item.precio_unitario * cant
              }, 0)
              const tieneDescItems = precioLista > (ticketVenta.subtotal ?? 0)
              return (
                <div className="border-t border-dashed border-gray-300 dark:border-gray-600 pt-3 space-y-1">
                  {tieneDescItems && (
                    <div className="flex justify-between text-sm text-gray-400 dark:text-gray-500">
                      <span>Precio lista</span>
                      <span className="line-through">${precioLista.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Subtotal</span>
                    <span>${ticketVenta.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.descuento_total > 0 && (
                    <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                      <span>Descuento {ticketVenta.descuento_total}%</span>
                      <span>−${(ticketVenta.subtotal * ticketVenta.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-primary text-base">
                    <span>TOTAL</span>
                    <span>${ticketVenta.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.medio_pago && (() => {
                    let pagos: { tipo: string; monto: number }[] = []
                    try { const p = JSON.parse(ticketVenta.medio_pago); if (Array.isArray(p)) pagos = p } catch {}
                    if (pagos.length === 0)
                      return <p className="text-xs text-gray-400 dark:text-gray-500 text-right">{ticketVenta.medio_pago}</p>
                    return (
                      <div className="space-y-0.5 pt-1 border-t border-dashed border-gray-200 dark:border-gray-700 mt-1">
                        {pagos.map((p, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                            <span>{p.tipo}</span>
                            {p.monto > 0 && <span>${p.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                          </div>
                        ))}
                        {ticketVenta.vuelto > 0 && (
                          <div className="flex justify-between text-sm font-semibold text-green-600 dark:text-green-400 border-t border-dashed border-gray-200 dark:border-gray-700 pt-1 mt-1">
                            <span>Vuelto</span>
                            <span>${ticketVenta.vuelto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            <p className="text-center text-xs text-gray-300 mt-4 border-t border-dashed border-gray-200 dark:border-gray-700 pt-3">
              ¡Gracias por su compra!
            </p>

            <div className="flex gap-2 mt-4">
              <button onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 py-2 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => setTicketVenta(null)}
                className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2 rounded-xl text-sm transition-all">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal selección de series */}
      {seriesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary">Seleccionar series</h2>
              <button onClick={() => { setSeriesModal(null); setSeriesBusqueda('') }} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"><X size={20} /></button>
            </div>
            {/* Buscador */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Buscar N/S o LPN..."
                value={seriesBusqueda}
                onChange={e => setSeriesBusqueda(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
              {seriesModal.lineas.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No hay series disponibles</p>
              ) : seriesModal.lineas
                  .filter((s: any) => !seriesBusqueda || s.nro_serie?.toLowerCase().includes(seriesBusqueda.toLowerCase()) || s.lpn?.toLowerCase().includes(seriesBusqueda.toLowerCase()))
                  .map((s: any) => {
                const selected = cart[seriesModal.itemIdx]?.series_seleccionadas.includes(s.id)
                return (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={selected}
                      onChange={e => {
                        const current = cart[seriesModal.itemIdx].series_seleccionadas
                        const updated = e.target.checked
                          ? [...current, s.id]
                          : current.filter(id => id !== s.id)
                        updateItem(seriesModal.itemIdx, 'series_seleccionadas', updated)
                        updateItem(seriesModal.itemIdx, 'cantidad', updated.length)
                      }} />
                    <span className="text-sm">{s.nro_serie}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{s.lpn}</span>
                  </label>
                )
              })}
            </div>
            <button onClick={() => { setSeriesModal(null); setSeriesBusqueda('') }}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all">
              Confirmar ({cart[seriesModal.itemIdx]?.series_seleccionadas.length} seleccionadas)
            </button>
          </div>
        </div>
      )}

      {/* Escáner de código de barras */}
      {scannerOpen && (
        <BarcodeScanner
          title="Escanear producto"
          onDetected={handleBarcodeScan}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Modal saldo restante al despachar reserva */}
      {saldoModal && (() => {
        const saldo = calcularSaldoPendiente(saldoModal.total, saldoModal.montoPagado)
        const errorSaldo = validarSaldoMediosPago(saldoModal.mediosPago, saldo)
        const asignado = saldoModal.mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
        const faltante = saldo - asignado
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-primary flex items-center gap-2"><Truck size={16} /> Cobrar saldo y finalizar</h2>
                <button onClick={() => setSaldoModal(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X size={18} /></button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="bg-page rounded-xl p-3 text-sm space-y-1">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Total venta</span>
                    <span>${saldoModal.total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Ya cobrado</span>
                    <span>−${saldoModal.montoPagado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-primary border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
                    <span>Saldo a cobrar</span>
                    <span>${saldo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Medio de pago para el saldo:</p>
                {saldoModal.mediosPago.map((mp, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select value={mp.tipo}
                      onChange={e => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.map((m, i) => i === idx ? { ...m, tipo: e.target.value } : m) } : s)}
                      className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                      <option value="">Medio de pago...</option>
                      {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input type="number" onWheel={e => e.currentTarget.blur()} min="0" value={mp.monto}
                      onChange={e => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.map((m, i) => i === idx ? { ...m, monto: e.target.value } : m) } : s)}
                      className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    {saldoModal.mediosPago.length > 1 && (
                      <button onClick={() => setSaldoModal(s => s ? { ...s, mediosPago: s.mediosPago.filter((_, i) => i !== idx) } : s)}
                        className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => setSaldoModal(s => s ? { ...s, mediosPago: [...s.mediosPago, { tipo: '', monto: '' }] } : s)}
                  className="text-xs text-accent hover:underline">+ Agregar medio</button>
                {faltante > 0.5 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Falta asignar ${faltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                )}
                {faltante < -0.5 && (
                  <p className="text-xs text-red-500">El monto excede el saldo por ${Math.abs(faltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                )}
              </div>
              <div className="px-5 pb-5 flex gap-3">
                <button onClick={() => setSaldoModal(null)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                  Cancelar
                </button>
                <button
                  disabled={cambiarEstado.isPending || !!errorSaldo}
                  onClick={() => {
                    cambiarEstado.mutate({ ventaId: saldoModal.ventaId, nuevoEstado: 'despachada', saldoMediosPago: saldoModal.mediosPago })
                    setSaldoModal(null)
                  }}
                  className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50 text-sm flex items-center justify-center gap-2">
                  <Truck size={15} /> Finalizar venta
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
