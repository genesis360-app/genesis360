import { useState, useRef, useEffect, Fragment } from 'react'
import { logActividad } from '@/lib/actividadLog'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, Search, Plus, Minus, Hash, X, Info, Layers, ChevronRight, ChevronDown,
  User, Clock, Package, TrendingDown, TrendingUp, AlertTriangle, Camera,
  MapPin, Tag, Settings2, ExternalLink, Combine, Trash2, ChevronUp, Play, RotateCcw, Copy, LayoutList, Building, Upload,
  ShoppingBasket, CheckCircle2, ChevronLeft, ClipboardList, Check,
} from 'lucide-react'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { LpnAccionesModal } from '@/components/LpnAccionesModal'
import { MasivoModal } from '@/components/MasivoModal'
import type { MasivoTipo } from '@/components/MasivoModal'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useGruposEstados } from '@/hooks/useGruposEstados'
import { useCotizacion } from '@/hooks/useCotizacion'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { PlanProgressBar } from '@/components/PlanProgressBar'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import toast from 'react-hot-toast'
import type { Producto, KitReceta, InventarioConteo, ProductoEstructura } from '@/lib/supabase'
import { getRebajeSort } from '@/lib/rebajeSort'
import { convertirUnidad, unidadesCompatibles } from '@/lib/unidades'

type Tab = 'inventario' | 'agregar' | 'quitar' | 'kits' | 'conteo' | 'historial' | 'autorizaciones'
type ModalType = 'ingreso' | 'rebaje' | null

const emptyIngreso = {
  productoSearch: '', cantidad: '', motivo: '', ubicacionId: '',
  estadoId: '', proveedorId: '', nroLote: '', fechaVencimiento: '', lpn: '',
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block ml-1">
      <button type="button" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="text-gray-400 dark:text-gray-500 hover:text-accent transition-colors align-middle">
        <Info size={14} />
      </button>
      {show && (
        <div className="absolute z-50 left-5 top-0 w-64 bg-primary text-white text-xs rounded-xl p-3 shadow-xl">
          {text}
        </div>
      )}
    </div>
  )
}

/** Convierte cantidad ingresada desde unidad alternativa a la unidad base del producto. */
function resolverCantidad(raw: string, unitAlt: string | null, unitBase: string | null | undefined): number {
  const n = parseFloat(raw)
  if (isNaN(n) || n <= 0) return 0
  if (!unitAlt || !unitBase || unitAlt === unitBase) return n
  const converted = convertirUnidad(n, unitAlt, unitBase)
  return converted ?? n
}

export default function InventarioPage() {
  const { tenant, user } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { cotizacion: cotizacionNum } = useCotizacion()
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const { limits } = usePlanLimits()
  const { sucursalId, sucursales, puedeVerTodas, applyFilter } = useSucursalFilter()

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('inventario')

  // ── Movimientos tab state ──────────────────────────────────────────────────
  const [modal, setModal] = useState<ModalType>(null)
  const [masivoModal, setMasivoModal] = useState<MasivoTipo | null>(null)
  const [movSearch, setMovSearch] = useState('')
  const [movScannerOpen, setMovScannerOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null)
  const [form, setForm] = useState(emptyIngreso)
  const [series, setSeries] = useState<string[]>([''])
  const [rebajeLpn, setRebajeLpn] = useState('')
  const [rebajeLinea, setRebajeLinea] = useState<any | null>(null)
  const [rebajeCantidad, setRebajeCantidad] = useState('')
  const [rebajeMotivo, setRebajeMotivo] = useState('')
  const [rebajeSeries, setRebajeSeries] = useState<string[]>([])
  const [rebajeSearch, setRebajeSearch] = useState('')
  const [rebajeGrupoId, setRebajeGrupoId] = useState<string | null>(null)
  const [movDetalle, setMovDetalle] = useState<any | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const [ingresoMotivoSelect, setIngresoMotivoSelect] = useState('')
  const [rebajeMotivoSelect, setRebajeMotivoSelect] = useState('')
  const [ingresoUnitAlt, setIngresoUnitAlt] = useState<string | null>(null)
  const [rebajeUnitAlt, setRebajeUnitAlt] = useState<string | null>(null)
  const [ingresoEstructuraId, setIngresoEstructuraId] = useState('')
  // Sucursal explícita para el ingreso (solo cuando Dueño está en vista global "todas")
  const [ingresoSucursalId, setIngresoSucursalId] = useState<string | null>(null)

  // ── Inventario tab state ───────────────────────────────────────────────────
  const [invSearch, setInvSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [filterCat, setFilterCat] = useState('') // '' = todos, '__sin__' = sin categoría, else = id
  const [filterUbic, setFilterUbic] = useState('') // '' = todos, '__sin__' = sin ubicación, else = id
  const [filterEstado, setFilterEstado] = useState('') // '' = todos, '__sin__' = sin estado, else = id
  const [filterProv, setFilterProv] = useState('') // '' = todos, '__sin__' = sin proveedor, else = id
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [invScannerOpen, setInvScannerOpen] = useState(false)
  const [lpnAcciones, setLpnAcciones] = useState<{ linea: any; producto: any } | null>(null)
  const [seriesModal, setSeriesModal] = useState<{ lpn: string; series: any[] } | null>(null)

  // Pre-fill search from ?search= URL param (e.g. link desde AlertasPage)
  useEffect(() => {
    const s = searchParams.get('search')
    if (s) {
      setTab('inventario')
      setInvSearch(s)
      setSearchParams({}, { replace: true })
    }
  }, [])

  // ── Masivo inline (Agregar Stock) ──────────────────────────────────────────
  type MasivoRow = {
    _id: string
    producto_id: string
    nombre: string
    sku: string
    unidad_medida: string | null
    tiene_series: boolean
    tiene_lote: boolean
    tiene_vencimiento: boolean
    cantidad: string
    estado_id: string
    ubicacion_id: string
    nro_lote: string
    fecha_vencimiento: string
    lpn: string
    series_txt: string
    showExtra: boolean
  }
  const [masivoInline, setMasivoInline] = useState(false)
  const [masivoRows, setMasivoRows] = useState<MasivoRow[]>([])
  const [masivoSearch, setMasivoSearch] = useState('')
  const [masivoScannerOpen, setMasivoScannerOpen] = useState(false)
  const [masivoFocusIdx, setMasivoFocusIdx] = useState<number | null>(null)
  const [masivoSearchFocused, setMasivoSearchFocused] = useState(false)
  const masivoSearchRef = useRef<HTMLInputElement>(null)
  const masivoQtyRefs = useRef<(HTMLInputElement | null)[]>([])

  // ── Kits tab state ─────────────────────────────────────────────────────────
  const [kitExpandedId, setKitExpandedId] = useState<string | null>(null)
  const [kitSearch, setKitSearch] = useState('')
  const [showKittingModal, setShowKittingModal] = useState(false)
  const [kittingKitId, setKittingKitId] = useState<string | null>(null)
  const [kittingCantidad, setKittingCantidad] = useState('1')
  const [kittingUbicacionId, setKittingUbicacionId] = useState('')
  const [kittingNotas, setKittingNotas] = useState('')
  // Receta form
  const [showRecetaForm, setShowRecetaForm] = useState<string | null>(null) // kit producto_id
  const [recetaCompSearch, setRecetaCompSearch] = useState('')
  const [recetaCantidad, setRecetaCantidad] = useState('1')
  // Desarmado inverso
  const [showDesarmarModal, setShowDesarmarModal] = useState(false)
  const [desarmarKitId, setDesarmarKitId] = useState<string | null>(null)

  // Inventario vista
  const [invVista, setInvVista] = useState<'producto' | 'ubicacion'>('producto')

  // Clonar KIT
  const [clonarOrigenId, setClonarOrigenId] = useState<string | null>(null)
  const [clonarDestinoId, setClonarDestinoId] = useState('')
  const [desarmarCantidad, setDesarmarCantidad] = useState('1')
  const [desarmarNotas, setDesarmarNotas] = useState('')

  // ── Conteo tab state ───────────────────────────────────────────────────────
  type ConteoRow = {
    linea_id: string; producto_id: string; nombre: string; sku: string
    unidad_medida: string; lpn: string; cantidad_esperada: number; cantidad_contada: string
  }
  const [conteoTipo, setConteoTipo] = useState<'ubicacion' | 'producto'>('ubicacion')
  const [conteoRefId, setConteoRefId] = useState('')
  const [conteoRows, setConteoRows] = useState<ConteoRow[]>([])
  const [conteoNotas, setConteoNotas] = useState('')
  const [showConteoForm, setShowConteoForm] = useState(false)
  const [conteoExpandedId, setConteoExpandedId] = useState<string | null>(null)
  const [continuandoConteoId, setContinuandoConteoId] = useState<string | null>(null)
  const [conteoLoading, setConteoLoading] = useState(false)

  // ── Historial filters ──────────────────────────────────────────────────────
  const [filterHistFechaDesde, setFilterHistFechaDesde] = useState('')
  const [filterHistFechaHasta, setFilterHistFechaHasta] = useState('')
  const [filterHistCatId, setFilterHistCatId] = useState('')
  const [filterHistTipo, setFilterHistTipo] = useState('')
  const [filterHistMotivo, setFilterHistMotivo] = useState('')

  // ── Autorizaciones tab state ───────────────────────────────────────────────
  const [autEstado, setAutEstado] = useState<'pendiente' | 'aprobada' | 'rechazada'>('pendiente')
  const [autRechazoId, setAutRechazoId] = useState<string | null>(null)
  const [autMotivoRechazo, setAutMotivoRechazo] = useState('')

  // ── Combinar LPNs state (Sprint D) ─────────────────────────────────────────
  type SelectedLinea = { id: string; lpn: string; cantidad: number; producto_id: string; nro_lote: string | null; fecha_vencimiento: string | null }
  const [selectedLineas, setSelectedLineas] = useState<string[]>([])
  const [selectedLineasInfo, setSelectedLineasInfo] = useState<SelectedLinea[]>([])
  const [showCombinarModal, setShowCombinarModal] = useState(false)
  const [combinarMode, setCombinarMode] = useState<'fusionar' | 'madre'>('fusionar')
  const [combinarDestinoId, setCombinarDestinoId] = useState('')
  const [combinarParentLpn, setCombinarParentLpn] = useState('')
  // Bulk actions
  const [showBulkEstado, setShowBulkEstado] = useState(false)
  const [showBulkUbicacion, setShowBulkUbicacion] = useState(false)
  const [bulkEstadoId, setBulkEstadoId] = useState('')
  const [bulkUbicacionId, setBulkUbicacionId] = useState('')
  const [showBulkEditar, setShowBulkEditar] = useState(false)
  const [bulkEditForm, setBulkEditForm] = useState({ sucursal_id: '', nro_lote: '', fecha_vencimiento: '', proveedor_id: '' })
  const [bulkEditCampos, setBulkEditCampos] = useState({ sucursal: false, lote: false, vencimiento: false, proveedor: false })

  // ── Shared queries ─────────────────────────────────────────────────────────
  const { data: estados = [] } = useQuery({
    queryKey: ['estados_inventario', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('estados_inventario').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ── Movimientos queries ────────────────────────────────────────────────────
  const { data: movimientos = [], isLoading: movLoading } = useQuery({
    queryKey: ['movimientos', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase
        .from('movimientos_stock')
        .select('*, productos(nombre,sku,unidad_medida,categoria_id,categorias(id,nombre)), users(nombre_display), estados_inventario(nombre,color), inventario_lineas(lpn, nro_lote, fecha_vencimiento, precio_costo_snapshot, ubicaciones(nombre), proveedores(nombre), inventario_series(nro_serie)), ventas(numero)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(100)
      q = applyFilter(q)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-busqueda', tenant?.id, form.productoSearch],
    queryFn: async () => {
      let q = supabase.from('productos')
        .select('id, nombre, sku, stock_actual, unidad_medida, imagen_url, tiene_series, tiene_lote, tiene_vencimiento, ubicacion_id, precio_costo')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre').limit(5)
      if (form.productoSearch.length > 0)
        q = q.or(`nombre.ilike.%${form.productoSearch}%,sku.ilike.%${form.productoSearch}%,codigo_barras.eq.${form.productoSearch}`)
      const { data } = await q
      return (data ?? []) as unknown as Producto[]
    },
    enabled: !!tenant && (form.productoSearch.length > 0 || searchFocused),
  })

  const { data: masivoBusqueda = [] } = useQuery({
    queryKey: ['productos-masivo-busqueda', tenant?.id, masivoSearch],
    queryFn: async () => {
      let q = supabase.from('productos')
        .select('id, nombre, sku, unidad_medida, tiene_series, tiene_lote, tiene_vencimiento, precio_costo, precio_venta')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre').limit(5)
      if (masivoSearch.length > 0)
        q = q.or(`nombre.ilike.%${masivoSearch}%,sku.ilike.%${masivoSearch}%,codigo_barras.eq.${masivoSearch}`)
      const { data } = await q
      return (data ?? []) as unknown as Producto[]
    },
    enabled: !!tenant && masivoInline && (masivoSearch.length > 0 || masivoSearchFocused),
  })

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('motivos_movimiento')
        .select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('ubicaciones').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('proveedores').select('*').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: estructurasIngreso = [] } = useQuery<ProductoEstructura[]>({
    queryKey: ['estructuras-producto', selectedProduct?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('producto_estructuras')
        .select('id, nombre, is_default')
        .eq('producto_id', selectedProduct!.id)
        .order('is_default', { ascending: false })
      const list = (data ?? []) as ProductoEstructura[]
      const def = list.find(e => e.is_default) ?? list[0]
      if (def) setIngresoEstructuraId(def.id)
      return list
    },
    enabled: !!selectedProduct && modal === 'ingreso',
  })

  const { data: lineasProducto = [] } = useQuery({
    queryKey: ['lineas-producto', selectedProduct?.id, sucursalId],
    queryFn: async () => {
      const tieneSeries = (selectedProduct as any).tiene_series
      let q = supabase.from('inventario_lineas')
        .select('*, estados_inventario(nombre,color), ubicaciones(nombre,prioridad), inventario_series(id,nro_serie,activo)')
        .eq('producto_id', selectedProduct!.id)
        .eq('activo', true)
        .order('created_at', { ascending: true })
      if (!tieneSeries) q = q.gt('cantidad', 0)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      const sortFn = getRebajeSort(
        (selectedProduct as any).regla_inventario,
        tenant!.regla_inventario,
        (selectedProduct as any).tiene_vencimiento ?? false
      )
      return (data ?? []).sort(sortFn)
    },
    enabled: !!selectedProduct && modal === 'rebaje',
  })

  // ── Inventario queries ─────────────────────────────────────────────────────
  const { data: productos = [], isLoading: invLoading } = useQuery({
    queryKey: ['productos', tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('*, categorias(id, nombre), proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario',
  })

  const { data: lineasData = { byProducto: {} as Record<string, any[]>, byUbicacion: {} as Record<string, any[]> }, isLoading: lineasLoading } = useQuery({
    queryKey: ['inventario_lineas_all', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase
        .from('inventario_lineas')
        .select('*, estados_inventario(nombre,color,es_disponible_venta), ubicaciones(nombre,prioridad), proveedores(nombre), inventario_series(id, nro_serie, activo, reservado), productos(nombre,sku,unidad_medida)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('created_at', { ascending: true })
      q = applyFilter(q)
      const { data, error } = await q
      if (error) throw error
      const byProducto: Record<string, any[]> = {}
      const byUbicacion: Record<string, any[]> = {}
      for (const l of data ?? []) {
        if (!byProducto[l.producto_id]) byProducto[l.producto_id] = []
        byProducto[l.producto_id].push(l)
        const ubicKey = l.ubicacion_id ?? '__sin_ubicacion__'
        if (!byUbicacion[ubicKey]) byUbicacion[ubicKey] = []
        byUbicacion[ubicKey].push(l)
      }
      return { byProducto, byUbicacion }
    },
    enabled: !!tenant && tab === 'inventario',
  })
  const lineasMap = lineasData.byProducto
  const ubicacionLineasMap = lineasData.byUbicacion

  // ── Kits queries ───────────────────────────────────────────────────────────
  const { data: kitsProductos = [] } = useQuery({
    queryKey: ['kits-productos', tenant?.id, kitSearch, sucursalId],
    queryFn: async () => {
      let q = supabase.from('productos')
        .select('id, nombre, sku, stock_actual, unidad_medida, es_kit')
        .eq('tenant_id', tenant!.id).eq('activo', true).eq('es_kit', true).order('nombre')
      if (kitSearch) q = q.or(`nombre.ilike.%${kitSearch}%,sku.ilike.%${kitSearch}%`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && tab === 'kits',
  })

  const { data: recetasMap = {} } = useQuery({
    queryKey: ['kit-recetas', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await supabase.from('kit_recetas')
        .select('*, componente:comp_producto_id(id, nombre, sku, stock_actual, unidad_medida)')
        .eq('tenant_id', tenant!.id)
      const map: Record<string, KitReceta[]> = {}
      for (const r of data ?? []) {
        if (!map[r.kit_producto_id]) map[r.kit_producto_id] = []
        map[r.kit_producto_id].push(r)
      }
      return map
    },
    enabled: !!tenant && tab === 'kits',
  })

  const { data: kitsEnArmado = [] } = useQuery({
    queryKey: ['kits-en-armado', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data } = await supabase.from('kitting_log')
        .select('*, kit:kit_producto_id(nombre, sku)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'en_armado')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant && tab === 'kits',
  })

  // Stock por sucursal de kits + componentes (reemplaza productos.stock_actual global)
  const { data: stockKitsSucursal = {} } = useQuery({
    queryKey: ['stock-kits-sucursal', tenant?.id, sucursalId, kitsProductos.map(k => k.id).join(',')],
    queryFn: async () => {
      const allIds = new Set<string>()
      kitsProductos.forEach(k => allIds.add(k.id))
      Object.entries(recetasMap).forEach(([kitId, rs]) => {
        allIds.add(kitId)
        ;(rs as any[]).forEach(r => allIds.add(r.comp_producto_id))
      })
      if (allIds.size === 0) return {}
      const { data } = await supabase
        .from('inventario_lineas')
        .select('producto_id, cantidad')
        .eq('tenant_id', tenant!.id)
        .eq('sucursal_id', sucursalId!)
        .eq('activo', true)
        .in('producto_id', [...allIds])
      const map: Record<string, number> = {}
      for (const l of data ?? []) {
        map[l.producto_id] = (map[l.producto_id] ?? 0) + (Number(l.cantidad) || 0)
      }
      return map
    },
    enabled: !!tenant && tab === 'kits' && !!sucursalId && kitsProductos.length > 0,
    staleTime: 0,
  })

  // Helper: stock en sucursal activa para kits/componentes (fallback a stock_actual global)
  function kStock(productoId: string, globalStock: number): number {
    if (!sucursalId) return globalStock
    return stockKitsSucursal[productoId] ?? 0
  }

  const { data: compsBusqueda = [] } = useQuery({
    queryKey: ['productos-comps-busqueda', tenant?.id, recetaCompSearch, showRecetaForm],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, stock_actual, unidad_medida')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .or(`nombre.ilike.%${recetaCompSearch}%,sku.ilike.%${recetaCompSearch}%`)
        .neq('id', showRecetaForm!) // no puede ser componente de sí mismo
        .limit(8)
      return data ?? []
    },
    enabled: !!tenant && !!showRecetaForm && recetaCompSearch.length > 1,
  })

  // ── Conteo queries ─────────────────────────────────────────────────────────
  const { data: conteoHistorial = [] } = useQuery({
    queryKey: ['conteo-historial', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase
        .from('inventario_conteos')
        .select('*, ubicaciones(nombre), productos(nombre,sku), inventario_conteo_items(*, productos(nombre,sku,unidad_medida)), users:created_by(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(30)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      return (data ?? []) as InventarioConteo[]
    },
    enabled: !!tenant && tab === 'conteo',
  })

  const { data: productosParaConteo = [] } = useQuery({
    queryKey: ['productos-para-conteo', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'conteo',
  })

  // ── Historial categorías (lazy, solo cuando tab='historial') ──────────────
  const { data: categoriasHistorial = [] } = useQuery({
    queryKey: ['categorias-historial', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias').select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

  // ── Autorizaciones (lazy, solo Dueño/SUPERVISOR/ADMIN) ─────────────────────
  const puedeVerAutorizaciones = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO'].includes(user?.rol ?? '')

  const { data: autorizaciones = [], isLoading: autLoading, refetch: refetchAut } = useQuery({
    queryKey: ['autorizaciones_inventario', tenant?.id, autEstado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('autorizaciones_inventario')
        .select('*, inventario_lineas(lpn, cantidad, producto_id, productos(nombre, sku, unidad_medida)), users!solicitado_por(nombre_display)')
        .eq('tenant_id', tenant!.id)
        .eq('estado', autEstado)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'autorizaciones' && puedeVerAutorizaciones,
  })

  // ── Helper: stock por sucursal activa (o global si no hay sucursal) ──────────
  // Uso: movimientos_stock.stock_antes / stock_despues + display en formularios
  async function getStockAntesSucursal(productoId: string, efectivaSucId: string | null): Promise<number> {
    if (efectivaSucId) {
      const { data } = await supabase
        .from('inventario_lineas')
        .select('cantidad')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', productoId)
        .eq('sucursal_id', efectivaSucId)
        .eq('activo', true)
      return (data ?? []).reduce((s: number, l: any) => s + (Number(l.cantidad) || 0), 0)
    }
    const { data } = await supabase.from('productos').select('stock_actual').eq('id', productoId).single()
    return data?.stock_actual ?? 0
  }

  // Query reactiva: stock del producto seleccionado en la sucursal activa (para display en formularios)
  const effSucursalIngreso = sucursalId ?? ingresoSucursalId
  const { data: stockEnSucursal } = useQuery({
    queryKey: ['stock-en-sucursal', selectedProduct?.id, effSucursalIngreso],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventario_lineas')
        .select('cantidad')
        .eq('tenant_id', tenant!.id)
        .eq('producto_id', selectedProduct!.id)
        .eq('sucursal_id', effSucursalIngreso!)
        .eq('activo', true)
      return (data ?? []).reduce((s: number, l: any) => s + (Number(l.cantidad) || 0), 0)
    },
    enabled: !!selectedProduct && !!effSucursalIngreso,
    staleTime: 0,
  })

  const aprobarAutorizacion = useMutation({
    mutationFn: async (aut: any) => {
      const linea = aut.inventario_lineas
      if (aut.tipo === 'ajuste_cantidad') {
        const { cantidad_nueva, cantidad_anterior } = aut.datos_cambio
        const { error } = await supabase.from('inventario_lineas').update({ cantidad: cantidad_nueva }).eq('id', aut.linea_id)
        if (error) throw error
        const diff = cantidad_nueva - cantidad_anterior
        if (Math.abs(diff) > 0.001) {
          const lineaSucId = linea?.sucursal_id ?? null
          const stockAntes = await getStockAntesSucursal(linea?.producto_id, lineaSucId)
          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id, producto_id: linea?.producto_id,
            tipo: diff > 0 ? 'ajuste_ingreso' : 'ajuste_rebaje',
            cantidad: Math.abs(diff),
            stock_antes: stockAntes,
            stock_despues: Math.max(0, stockAntes + diff),
            motivo: `Ajuste aprobado — LPN ${linea?.lpn}`,
            usuario_id: user?.id,
            sucursal_id: lineaSucId,
          })
        }
      } else if (aut.tipo === 'eliminar_serie') {
        const { serie_id } = aut.datos_cambio
        const { error } = await supabase.from('inventario_series').update({ activo: false }).eq('id', serie_id)
        if (error) throw error
        const lineaSucId = linea?.sucursal_id ?? null
        const stockAntes = await getStockAntesSucursal(linea?.producto_id, lineaSucId)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id, producto_id: linea?.producto_id,
          tipo: 'rebaje', cantidad: 1,
          stock_antes: stockAntes, stock_despues: Math.max(0, stockAntes - 1),
          motivo: `Serie eliminada (aprobada) — LPN ${linea?.lpn}`,
          usuario_id: user?.id,
          sucursal_id: lineaSucId,
        })
      } else if (aut.tipo === 'eliminar_lpn') {
        const cantEliminada = aut.datos_cambio.cantidad ?? linea?.cantidad ?? 0
        await supabase.from('inventario_series').update({ activo: false }).eq('linea_id', aut.linea_id)
        const { error } = await supabase.from('inventario_lineas').update({ activo: false, cantidad: 0 }).eq('id', aut.linea_id)
        if (error) throw error
        if (cantEliminada > 0) {
          const lineaSucId = linea?.sucursal_id ?? null
          const stockAntes = await getStockAntesSucursal(linea?.producto_id, lineaSucId)
          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id, producto_id: linea?.producto_id,
            tipo: 'rebaje', cantidad: cantEliminada,
            stock_antes: stockAntes, stock_despues: Math.max(0, stockAntes - cantEliminada),
            motivo: `LPN eliminado (aprobado) — ${linea?.lpn}`,
            usuario_id: user?.id,
            sucursal_id: lineaSucId,
          })
        }
      } else if (aut.tipo === 'bulk_edit') {
        const { linea_ids, campos } = aut.datos_cambio as { linea_ids: string[]; campos: Record<string, any> }
        if (linea_ids?.length && Object.keys(campos).length) {
          const { error } = await supabase.from('inventario_lineas').update(campos).in('id', linea_ids)
          if (error) throw error
        }
      }
      await supabase.from('autorizaciones_inventario').update({ estado: 'aprobada', aprobado_por: user?.id }).eq('id', aut.id)
      const tipoLabel = aut.tipo === 'ajuste_cantidad' ? 'Ajuste de cantidad'
        : aut.tipo === 'eliminar_serie' ? 'Eliminación de serie'
        : aut.tipo === 'eliminar_lpn' ? 'Eliminación de LPN'
        : 'Edición masiva de atributos'
      logActividad({
        entidad: 'inventario_linea',
        entidad_id: aut.linea_id ?? '',
        entidad_nombre: aut.tipo === 'bulk_edit'
          ? `Bulk edit — ${(aut.datos_cambio?.linea_ids?.length ?? 0)} LPN(s)`
          : (linea?.productos?.nombre ?? linea?.lpn ?? aut.linea_id),
        accion: 'editar',
        campo: aut.tipo,
        valor_anterior: String(aut.datos_cambio?.cantidad_anterior ?? ''),
        valor_nuevo: aut.tipo === 'bulk_edit'
          ? JSON.stringify(aut.datos_cambio?.campos ?? {})
          : String(aut.datos_cambio?.cantidad_nueva ?? aut.datos_cambio?.cantidad ?? ''),
        pagina: '/inventario',
      })
    },
    onSuccess: () => {
      toast.success('Autorización aprobada y ejecutada')
      qc.invalidateQueries({ queryKey: ['autorizaciones_inventario'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rechazarAutorizacion = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      if (!motivo.trim()) throw new Error('Ingresá un motivo de rechazo')
      await supabase.from('autorizaciones_inventario').update({
        estado: 'rechazada', aprobado_por: user?.id, motivo_rechazo: motivo,
      }).eq('id', id)
    },
    onSuccess: () => {
      toast.success('Autorización rechazada')
      setAutRechazoId(null)
      setAutMotivoRechazo('')
      qc.invalidateQueries({ queryKey: ['autorizaciones_inventario'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Bulk actions en LPNs ─────────────────────────────────────────────────
  const bulkCambiarEstado = useMutation({
    mutationFn: async (estadoId: string) => {
      const { error } = await supabase
        .from('inventario_lineas')
        .update({ estado_id: estadoId })
        .in('id', selectedLineas)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Estado actualizado en ${selectedLineas.length} LPN(s)`)
      setSelectedLineas([]); setSelectedLineasInfo([])
      setShowBulkEstado(false); setBulkEstadoId('')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkCambiarUbicacion = useMutation({
    mutationFn: async (ubicacionId: string) => {
      const { error } = await supabase
        .from('inventario_lineas')
        .update({ ubicacion_id: ubicacionId })
        .in('id', selectedLineas)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Ubicación actualizada en ${selectedLineas.length} LPN(s)`)
      setSelectedLineas([]); setSelectedLineasInfo([])
      setShowBulkUbicacion(false); setBulkUbicacionId('')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkEditarAtributos = useMutation({
    mutationFn: async () => {
      if (selectedLineas.length === 0) throw new Error('No hay LPNs seleccionados')
      const esDeposito = user?.rol === 'DEPOSITO'

      // Construir payload de campos a cambiar
      const campos: Record<string, any> = {}
      if (bulkEditCampos.sucursal && bulkEditForm.sucursal_id !== '') campos.sucursal_id = bulkEditForm.sucursal_id || null
      if (bulkEditCampos.lote)      campos.nro_lote = bulkEditForm.nro_lote.trim() || null
      if (bulkEditCampos.vencimiento) campos.fecha_vencimiento = bulkEditForm.fecha_vencimiento || null
      if (bulkEditCampos.proveedor && bulkEditForm.proveedor_id !== '') campos.proveedor_id = bulkEditForm.proveedor_id || null

      if (Object.keys(campos).length === 0) throw new Error('Seleccioná al menos un campo para cambiar')

      if (esDeposito) {
        const { error } = await supabase.from('autorizaciones_inventario').insert({
          tenant_id: tenant!.id,
          tipo: 'bulk_edit',
          linea_id: null,
          datos_cambio: { linea_ids: selectedLineas, campos },
          estado: 'pendiente',
          solicitado_por: user?.id,
        })
        if (error) throw error
        return { esAutorizacion: true }
      }

      const { error } = await supabase
        .from('inventario_lineas')
        .update(campos)
        .in('id', selectedLineas)
      if (error) throw error
    },
    onSuccess: (result: any) => {
      if (result?.esAutorizacion) {
        toast.success(`Solicitud de edición enviada — ${selectedLineas.length} LPN(s) pendientes de aprobación`)
        qc.invalidateQueries({ queryKey: ['autorizaciones_inventario'] })
      } else {
        toast.success(`${selectedLineas.length} LPN(s) actualizados`)
        qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      }
      setSelectedLineas([]); setSelectedLineasInfo([])
      setShowBulkEditar(false)
      setBulkEditForm({ sucursal_id: '', nro_lote: '', fecha_vencimiento: '', proveedor_id: '' })
      setBulkEditCampos({ sucursal: false, lote: false, vencimiento: false, proveedor: false })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Combinar LPNs mutations (Sprint D) ────────────────────────────────────
  const fusionarLineas = useMutation({
    mutationFn: async () => {
      if (selectedLineas.length < 2) throw new Error('Seleccioná al menos 2 LPNs')
      const dest = selectedLineasInfo.find(l => l.id === combinarDestinoId)
      if (!dest) throw new Error('Seleccioná el LPN destino')
      const sources = selectedLineasInfo.filter(l => l.id !== combinarDestinoId)
      const productoIds = new Set(selectedLineasInfo.map(l => l.producto_id))
      if (productoIds.size > 1) throw new Error('Solo podés fusionar LPNs del mismo producto')
      const totalTransfer = sources.reduce((sum, l) => sum + l.cantidad, 0)

      const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', dest.producto_id).single()
      const stockAntes = prod?.stock_actual ?? 0

      const { error: e1 } = await supabase.from('inventario_lineas')
        .update({ cantidad: dest.cantidad + totalTransfer, updated_at: new Date().toISOString() })
        .eq('id', dest.id)
      if (e1) throw e1

      const { error: e2 } = await supabase.from('inventario_lineas')
        .update({ activo: false, cantidad: 0, updated_at: new Date().toISOString() })
        .in('id', sources.map(l => l.id))
      if (e2) throw e2

      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id,
        producto_id: dest.producto_id,
        tipo: 'ajuste_ingreso',
        cantidad: totalTransfer,
        stock_antes: stockAntes,
        stock_despues: stockAntes + totalTransfer,
        motivo: `Fusión LPN — recibe de ${sources.map(l => l.lpn).join(', ')}`,
        usuario_id: user?.id,
        linea_id: dest.id,
        sucursal_id: sucursalId || null,
      })
    },
    onSuccess: () => {
      toast.success('LPNs fusionados correctamente')
      setSelectedLineas([])
      setSelectedLineasInfo([])
      setShowCombinarModal(false)
      setCombinarDestinoId('')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const asignarMadre = useMutation({
    mutationFn: async () => {
      if (!combinarParentLpn.trim()) throw new Error('Ingresá el LPN madre')
      const { error } = await supabase.from('inventario_lineas')
        .update({ parent_lpn_id: combinarParentLpn.trim(), updated_at: new Date().toISOString() })
        .in('id', selectedLineas)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('LPN Madre asignado')
      setSelectedLineas([])
      setSelectedLineasInfo([])
      setShowCombinarModal(false)
      setCombinarParentLpn('')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────
  const cambiarEstadoLinea = useMutation({
    mutationFn: async ({ lineaId, estadoId }: { lineaId: string; estadoId: string }) => {
      const { error } = await supabase.from('inventario_lineas').update({ estado_id: estadoId || null }).eq('id', lineaId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Estado actualizado'); qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] }) },
    onError: () => toast.error('Error al actualizar'),
  })

  const ingresoMutation = useMutation({
    mutationFn: async () => {
      if (limits && !limits.puede_crear_movimiento)
        throw new Error('Límite de movimientos del plan alcanzado. Upgradeá tu plan o comprá movimientos extra.')
      if (!selectedProduct) throw new Error('Seleccioná un producto')
      // Validar sucursal: si no hay sucursal activa ni seleccionada en el form, bloquear
      if (!sucursalId && !ingresoSucursalId)
        throw new Error('Seleccioná una sucursal de destino para el ingreso antes de confirmar.')
      const tieneSeries = (selectedProduct as any).tiene_series
      const tieneLote = (selectedProduct as any).tiene_lote
      const tieneVencimiento = (selectedProduct as any).tiene_vencimiento
      const cant = tieneSeries
        ? series.filter(s => s.trim()).length
        : resolverCantidad(form.cantidad, ingresoUnitAlt, (selectedProduct as any).unidad_medida)
      if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
      if (tieneLote && !form.nroLote.trim()) throw new Error('Este producto requiere número de lote')
      if (tieneVencimiento && !form.fechaVencimiento) throw new Error('Este producto requiere fecha de vencimiento')

      // I-05: Validar mono_sku en la ubicación seleccionada
      if (form.ubicacionId) {
        const { data: ubicData } = await supabase
          .from('ubicaciones')
          .select('mono_sku, nombre')
          .eq('id', form.ubicacionId)
          .single()
        if (ubicData?.mono_sku) {
          const { data: otraLinea } = await supabase
            .from('inventario_lineas')
            .select('producto_id, productos(nombre, sku)')
            .eq('tenant_id', tenant!.id)
            .eq('ubicacion_id', form.ubicacionId)
            .eq('activo', true)
            .neq('producto_id', selectedProduct.id)
            .gt('cantidad', 0)
            .limit(1)
            .maybeSingle()
          if (otraLinea) {
            const otro = (otraLinea as any).productos?.nombre ?? 'otro producto'
            throw new Error(`La ubicación "${ubicData.nombre}" es Mono-SKU y ya tiene "${otro}"`)
          }
        }
      }

      // Validar unicidad de LPN por tenant
      if (form.lpn.trim()) {
        const { data: lpnExiste } = await supabase
          .from('inventario_lineas')
          .select('id, productos(nombre)')
          .eq('tenant_id', tenant!.id)
          .eq('lpn', form.lpn.trim())
          .eq('activo', true)
          .maybeSingle()
        if (lpnExiste) {
          const prodNombre = (lpnExiste as any).productos?.nombre ?? 'otro SKU'
          throw new Error(`El LPN "${form.lpn.trim()}" ya existe en ${prodNombre}`)
        }
      }

      const stockAntes = await getStockAntesSucursal(selectedProduct.id, sucursalId ?? ingresoSucursalId ?? null)

      const { data: linea, error: lineaError } = await supabase
        .from('inventario_lineas')
        .insert({
          tenant_id: tenant!.id,
          producto_id: selectedProduct.id,
          lpn: form.lpn || null,
          cantidad: tieneSeries ? 0 : cant,
          estado_id: form.estadoId || null,
          ubicacion_id: form.ubicacionId || null,
          proveedor_id: form.proveedorId || null,
          nro_lote: form.nroLote || null,
          fecha_vencimiento: form.fechaVencimiento || null,
          precio_costo_snapshot: (selectedProduct as any).precio_costo || null,
          precio_venta_snapshot: (selectedProduct as any).precio_venta || null,
          estructura_id: ingresoEstructuraId || null,
          sucursal_id: sucursalId ?? ingresoSucursalId ?? null,
        })
        .select().single()
      if (lineaError) throw lineaError

      if (tieneSeries) {
        const seriesValidas = series.filter(s => s.trim())
        if (seriesValidas.length === 0) throw new Error('Ingresá al menos un número de serie')
        const { error: seriesError } = await supabase.from('inventario_series').insert(
          seriesValidas.map(nro => ({
            tenant_id: tenant!.id,
            producto_id: selectedProduct.id,
            linea_id: linea.id,
            nro_serie: nro.trim(),
            estado_id: form.estadoId || null,
          }))
        )
        if (seriesError) {
          if (seriesError.code === '23505') throw new Error('Una o más series ya existen')
          throw seriesError
        }
      }

      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id,
        producto_id: selectedProduct.id,
        tipo: 'ingreso',
        cantidad: cant,
        stock_antes: stockAntes,
        stock_despues: stockAntes + cant,
        motivo: form.motivo || null,
        estado_id: form.estadoId || null,
        usuario_id: user?.id,
        linea_id: linea.id,
        sucursal_id: sucursalId || null,
      })
    },
    onSuccess: () => {
      toast.success('Ingreso registrado')
      logActividad({
        entidad: 'inventario_linea',
        entidad_nombre: (selectedProduct as any)?.nombre ?? '',
        accion: 'crear',
        valor_nuevo: `Ingreso de stock — ${(selectedProduct as any)?.nombre ?? ''}`,
        pagina: '/inventario',
      })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rebajeMutation = useMutation({
    mutationFn: async () => {
      if (limits && !limits.puede_crear_movimiento)
        throw new Error('Límite de movimientos del plan alcanzado. Upgradeá tu plan o comprá movimientos extra.')
      if (!selectedProduct || !rebajeLinea) throw new Error('Seleccioná producto y línea')
      const tieneSeries = (selectedProduct as any).tiene_series

      const stockAntes = await getStockAntesSucursal(selectedProduct.id, sucursalId)

      if (tieneSeries) {
        if (rebajeSeries.length === 0) throw new Error('Seleccioná al menos una serie')
        const { error: seriesError } = await supabase.from('inventario_series').update({ activo: false }).in('id', rebajeSeries)
        if (seriesError) throw seriesError
        const { count } = await supabase.from('inventario_series').select('id', { count: 'exact', head: true }).eq('linea_id', rebajeLinea.id).eq('activo', true)
        if (count === 0) {
          await supabase.from('inventario_lineas').update({ activo: false }).eq('id', rebajeLinea.id)
        }
      } else {
        const cant = resolverCantidad(rebajeCantidad, rebajeUnitAlt, (selectedProduct as any).unidad_medida)
        if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
        const disponible = rebajeLinea.cantidad - (rebajeLinea.cantidad_reservada ?? 0)
        if (cant > disponible) throw new Error(`Stock disponible insuficiente: ${disponible} u. (${rebajeLinea.cantidad} total − ${rebajeLinea.cantidad_reservada ?? 0} reservada(s))`)
        const nuevaCant = rebajeLinea.cantidad - cant
        await supabase.from('inventario_lineas').update({ cantidad: nuevaCant, activo: nuevaCant > 0 }).eq('id', rebajeLinea.id)
      }

      const cant = tieneSeries ? rebajeSeries.length : resolverCantidad(rebajeCantidad, rebajeUnitAlt, (selectedProduct as any).unidad_medida)
      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id,
        producto_id: selectedProduct.id,
        tipo: 'rebaje',
        cantidad: cant,
        stock_antes: stockAntes,
        stock_despues: Math.max(0, stockAntes - cant),
        motivo: rebajeMotivo || null,
        usuario_id: user?.id,
        linea_id: rebajeLinea.id,
        sucursal_id: sucursalId || null,
      })
    },
    onSuccess: () => {
      toast.success('Rebaje registrado')
      logActividad({
        entidad: 'inventario_linea',
        entidad_nombre: (selectedProduct as any)?.nombre ?? '',
        accion: 'cambio_estado',
        valor_nuevo: `Rebaje de stock — ${(selectedProduct as any)?.nombre ?? ''}`,
        pagina: '/inventario',
      })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Kit mutations ──────────────────────────────────────────────────────────
  const agregarReceta = useMutation({
    mutationFn: async ({ kitId, compId }: { kitId: string; compId: string }) => {
      const cant = parseFloat(recetaCantidad)
      if (isNaN(cant) || cant <= 0) throw new Error('Cantidad inválida')
      const { error } = await supabase.from('kit_recetas').insert({
        tenant_id: tenant!.id, kit_producto_id: kitId, comp_producto_id: compId, cantidad: cant,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Componente agregado')
      qc.invalidateQueries({ queryKey: ['kit-recetas'] })
      setRecetaCompSearch(''); setRecetaCantidad('1')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const eliminarReceta = useMutation({
    mutationFn: async (recetaId: string) => {
      const { error } = await supabase.from('kit_recetas').delete().eq('id', recetaId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast.success('Componente eliminado'); qc.invalidateQueries({ queryKey: ['kit-recetas'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const clonarKitRecetas = useMutation({
    mutationFn: async ({ origenId, destinoId }: { origenId: string; destinoId: string }) => {
      const recetas = recetasMap[origenId] ?? []
      if (recetas.length === 0) throw new Error('El KIT origen no tiene receta')
      for (const r of recetas) {
        await supabase.from('kit_recetas').upsert({
          tenant_id: tenant!.id,
          kit_producto_id: destinoId,
          comp_producto_id: r.comp_producto_id,
          cantidad: r.cantidad,
        }, { onConflict: 'tenant_id,kit_producto_id,comp_producto_id' })
      }
    },
    onSuccess: () => {
      toast.success('Receta clonada')
      qc.invalidateQueries({ queryKey: ['kit-recetas'] })
      setClonarOrigenId(null); setClonarDestinoId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const iniciarArmado = useMutation({
    mutationFn: async () => {
      const cant = parseFloat(kittingCantidad)
      if (!kittingKitId || isNaN(cant) || cant <= 0) throw new Error('Datos inválidos')
      const recetas = recetasMap[kittingKitId] ?? []
      if (recetas.length === 0) throw new Error('El KIT no tiene receta configurada')

      // 1. Verificar stock disponible en la sucursal activa
      for (const r of recetas) {
        const comp = r.componente as any
        const requerido = r.cantidad * cant
        const disponible = kStock(r.comp_producto_id, comp?.stock_actual ?? 0)
        if (disponible < requerido) {
          throw new Error(`Stock insuficiente de ${comp?.nombre ?? r.comp_producto_id}: necesitás ${requerido} ${comp?.unidad_medida ?? ''}, hay ${disponible}${sucursalId ? ' (en esta sucursal)' : ''}`)
        }
      }

      // 2. Reservar componentes (incrementar cantidad_reservada en sus líneas)
      const componentesReservados: { linea_id: string; comp_producto_id: string; cantidad: number }[] = []
      for (const r of recetas) {
        const cantComp = r.cantidad * cant
        let lineasQ = supabase.from('inventario_lineas')
          .select('id, cantidad, cantidad_reservada')
          .eq('tenant_id', tenant!.id).eq('producto_id', r.comp_producto_id).eq('activo', true)
          .order('created_at', { ascending: true })
        if (sucursalId) lineasQ = lineasQ.eq('sucursal_id', sucursalId)
        const { data: lineas } = await lineasQ

        let restante = cantComp
        for (const linea of lineas ?? []) {
          if (restante <= 0) break
          const disponibleLinea = linea.cantidad - (linea.cantidad_reservada ?? 0)
          const aReservar = Math.min(disponibleLinea, restante)
          if (aReservar <= 0) continue
          await supabase.from('inventario_lineas')
            .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + aReservar })
            .eq('id', linea.id)
          componentesReservados.push({ linea_id: linea.id, comp_producto_id: r.comp_producto_id, cantidad: aReservar })
          restante -= aReservar
        }
      }

      // 3. Crear kitting_log en estado 'en_armado'
      await supabase.from('kitting_log').insert({
        tenant_id: tenant!.id, kit_producto_id: kittingKitId,
        cantidad_kits: cant, ubicacion_id: kittingUbicacionId || null,
        usuario_id: user?.id ?? null, notas: kittingNotas || null,
        tipo: 'armado', estado: 'en_armado',
        componentes_reservados: componentesReservados,
      })
    },
    onSuccess: () => {
      toast.success('Armado iniciado — componentes reservados')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['kits-en-armado'] })
      qc.invalidateQueries({ queryKey: ['kits-productos'] })
      setShowKittingModal(false)
      setKittingCantidad('1'); setKittingUbicacionId(''); setKittingNotas('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const confirmarArmado = useMutation({
    mutationFn: async (logId: string) => {
      const log = kitsEnArmado.find((l: any) => l.id === logId) as any
      if (!log) throw new Error('Armado no encontrado')
      const reservados: { linea_id: string; comp_producto_id: string; cantidad: number }[] = log.componentes_reservados ?? []

      // 1. Rebaje de componentes (descontar de cantidad + liberar reserva)
      const cantsByComp: Record<string, number> = {}
      for (const entry of reservados) {
        const { data: linea } = await supabase.from('inventario_lineas')
          .select('cantidad, cantidad_reservada').eq('id', entry.linea_id).single()
        if (!linea) continue
        await supabase.from('inventario_lineas').update({
          cantidad: linea.cantidad - entry.cantidad,
          cantidad_reservada: Math.max(0, (linea.cantidad_reservada ?? 0) - entry.cantidad),
        }).eq('id', entry.linea_id)
        cantsByComp[entry.comp_producto_id] = (cantsByComp[entry.comp_producto_id] ?? 0) + entry.cantidad
      }
      for (const [prodId, cantTotal] of Object.entries(cantsByComp)) {
        const saComp = await getStockAntesSucursal(prodId, sucursalId)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id, producto_id: prodId,
          tipo: 'rebaje', cantidad: cantTotal,
          stock_antes: saComp, stock_despues: Math.max(0, saComp - cantTotal),
          motivo: `Kitting x${log.cantidad_kits} [${log.kit_producto_id}]`,
          usuario_id: user?.id ?? null,
          sucursal_id: sucursalId || null,
        })
      }

      // 2. Ingreso del KIT
      await supabase.from('inventario_lineas').insert({
        tenant_id: tenant!.id, producto_id: log.kit_producto_id,
        cantidad: log.cantidad_kits, ubicacion_id: log.ubicacion_id ?? null, activo: true,
        sucursal_id: sucursalId || null,
      })
      const saKit = await getStockAntesSucursal(log.kit_producto_id, sucursalId)
      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id, producto_id: log.kit_producto_id,
        tipo: 'kitting', cantidad: log.cantidad_kits,
        stock_antes: saKit, stock_despues: saKit + log.cantidad_kits,
        motivo: log.notas || `Kitting x${log.cantidad_kits}`,
        usuario_id: user?.id ?? null,
        sucursal_id: sucursalId || null,
      })

      // 3. Marcar log como completado
      await supabase.from('kitting_log').update({ estado: 'completado' }).eq('id', logId)
    },
    onSuccess: () => {
      toast.success('KIT armado y stock ingresado')
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['kits-en-armado'] })
      qc.invalidateQueries({ queryKey: ['kits-productos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelarArmado = useMutation({
    mutationFn: async (logId: string) => {
      const log = kitsEnArmado.find((l: any) => l.id === logId) as any
      if (!log) throw new Error('Armado no encontrado')
      const reservados: { linea_id: string; comp_producto_id: string; cantidad: number }[] = log.componentes_reservados ?? []

      // Liberar cantidad_reservada en cada línea
      for (const entry of reservados) {
        const { data: linea } = await supabase.from('inventario_lineas')
          .select('cantidad_reservada').eq('id', entry.linea_id).single()
        if (!linea) continue
        await supabase.from('inventario_lineas').update({
          cantidad_reservada: Math.max(0, (linea.cantidad_reservada ?? 0) - entry.cantidad),
        }).eq('id', entry.linea_id)
      }

      await supabase.from('kitting_log').update({ estado: 'cancelado' }).eq('id', logId)
    },
    onSuccess: () => {
      toast.success('Armado cancelado — componentes liberados')
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['kits-en-armado'] })
      qc.invalidateQueries({ queryKey: ['kits-productos'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const desarmarKit = useMutation({
    mutationFn: async () => {
      const cant = parseFloat(desarmarCantidad)
      if (!desarmarKitId || isNaN(cant) || cant <= 0) throw new Error('Datos inválidos')
      const recetas = recetasMap[desarmarKitId] ?? []
      if (recetas.length === 0) throw new Error('El KIT no tiene receta configurada')

      // 1. Verificar que hay stock suficiente del KIT en inventario_lineas (filtrado por sucursal)
      let lineasKitQ = supabase.from('inventario_lineas')
        .select('id, cantidad, cantidad_reservada')
        .eq('tenant_id', tenant!.id).eq('producto_id', desarmarKitId).eq('activo', true)
      if (sucursalId) lineasKitQ = lineasKitQ.eq('sucursal_id', sucursalId)
      const { data: lineasKit } = await lineasKitQ
      const stockDisponibleKit = (lineasKit ?? []).reduce((s: number, l: any) => s + (l.cantidad - (l.cantidad_reservada ?? 0)), 0)
      if (stockDisponibleKit < cant) {
        throw new Error(`Stock insuficiente del KIT: necesitás ${cant}, hay ${stockDisponibleKit} disponibles`)
      }

      // 2. Rebaje del KIT (FIFO)
      let restanteKit = cant
      for (const linea of (lineasKit ?? [])) {
        if (restanteKit <= 0) break
        const disponible = linea.cantidad - (linea.cantidad_reservada ?? 0)
        const aRebajar = Math.min(disponible, restanteKit)
        if (aRebajar <= 0) continue
        await supabase.from('inventario_lineas').update({ cantidad: linea.cantidad - aRebajar }).eq('id', linea.id)
        restanteKit -= aRebajar
      }
      const saKitDes = await getStockAntesSucursal(desarmarKitId, sucursalId)
      await supabase.from('movimientos_stock').insert({
        tenant_id: tenant!.id, producto_id: desarmarKitId,
        tipo: 'des_kitting', cantidad: cant,
        stock_antes: saKitDes, stock_despues: Math.max(0, saKitDes - cant),
        motivo: desarmarNotas || `Desarmado x${cant}`,
        usuario_id: user?.id ?? null,
        sucursal_id: sucursalId || null,
      })

      // 3. Ingreso de cada componente según receta
      for (const r of recetas) {
        const cantComp = r.cantidad * cant
        await supabase.from('inventario_lineas').insert({
          tenant_id: tenant!.id, producto_id: r.comp_producto_id,
          cantidad: cantComp, activo: true,
          sucursal_id: sucursalId || null,
        })
        const saComp = await getStockAntesSucursal(r.comp_producto_id, sucursalId)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id, producto_id: r.comp_producto_id,
          tipo: 'ingreso', cantidad: cantComp,
          stock_antes: saComp, stock_despues: saComp + cantComp,
          motivo: `Desarmado KIT x${cant} [${desarmarKitId}]`,
          usuario_id: user?.id ?? null,
          sucursal_id: sucursalId || null,
        })
      }

      // 4. Log
      await supabase.from('kitting_log').insert({
        tenant_id: tenant!.id, kit_producto_id: desarmarKitId,
        cantidad_kits: cant, usuario_id: user?.id ?? null,
        notas: desarmarNotas || null, tipo: 'desarmado',
      })
    },
    onSuccess: () => {
      toast.success('KIT desarmado con éxito — componentes ingresados al stock')
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['kits-productos'] })
      setShowDesarmarModal(false)
      setDesarmarCantidad('1'); setDesarmarNotas('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Conteo helpers ─────────────────────────────────────────────────────────
  const cargarLineasParaConteo = async () => {
    if (!conteoRefId || !tenant) return
    setConteoLoading(true)
    try {
      let q = supabase.from('inventario_lineas')
        .select('id, producto_id, lpn, cantidad, activo, productos(nombre,sku,unidad_medida), inventario_series(id,activo)')
        .eq('tenant_id', tenant.id).eq('activo', true)
      if (conteoTipo === 'ubicacion') {
        if (conteoRefId === '__sin__') q = (q as any).is('ubicacion_id', null)
        else q = q.eq('ubicacion_id', conteoRefId)
      } else {
        q = q.eq('producto_id', conteoRefId)
      }
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      const rows: ConteoRow[] = (data ?? []).map((l: any) => {
        const prod = l.productos ?? {}
        const seriesActivas = (l.inventario_series ?? []).filter((s: any) => s.activo).length
        const cantEsperada = seriesActivas > 0 ? seriesActivas : (l.cantidad ?? 0)
        return {
          linea_id: l.id,
          producto_id: l.producto_id,
          nombre: prod.nombre ?? '',
          sku: prod.sku ?? '',
          unidad_medida: prod.unidad_medida ?? '',
          lpn: l.lpn ?? '',
          cantidad_esperada: cantEsperada,
          cantidad_contada: String(cantEsperada),
        }
      })
      if (rows.length === 0) toast('No hay stock en esta ubicación/producto', { icon: 'ℹ️' })
      setConteoRows(rows)
    } finally {
      setConteoLoading(false)
    }
  }

  const resetConteoForm = () => {
    setShowConteoForm(false); setConteoRows([]); setConteoNotas(''); setConteoRefId('')
    setContinuandoConteoId(null)
  }

  // ISS-100: Cargar borrador en el form para continuar editando
  const continuarConteo = (c: InventarioConteo) => {
    setConteoTipo(c.tipo)
    setConteoRefId(c.ubicacion_id ?? c.producto_id ?? '')
    setConteoNotas(c.notas ?? '')
    setConteoRows((c.inventario_conteo_items ?? []).map(item => ({
      linea_id: item.inventario_linea_id ?? '',
      producto_id: item.producto_id,
      nombre: item.productos?.nombre ?? '—',
      sku: item.productos?.sku ?? '',
      unidad_medida: item.productos?.unidad_medida ?? 'unidad',
      lpn: item.lpn ?? '',
      cantidad_esperada: item.cantidad_esperada,
      cantidad_contada: String(item.cantidad_contada),
    })))
    setContinuandoConteoId(c.id)
    setShowConteoForm(true)
    setConteoExpandedId(null)
  }

  const guardarConteoBorrador = useMutation({
    mutationFn: async () => {
      if (conteoRows.length === 0) throw new Error('Cargá el stock antes de guardar')
      let conteoId = continuandoConteoId
      if (conteoId) {
        // ISS-100: actualizar borrador existente
        const { error: uErr } = await supabase.from('inventario_conteos')
          .update({ notas: conteoNotas || null }).eq('id', conteoId)
        if (uErr) throw uErr
        await supabase.from('inventario_conteo_items').delete().eq('conteo_id', conteoId)
      } else {
        const { data: conteo, error: cErr } = await supabase.from('inventario_conteos').insert({
          tenant_id: tenant!.id, tipo: conteoTipo,
          ubicacion_id: conteoTipo === 'ubicacion' && conteoRefId && conteoRefId !== '__sin__' ? conteoRefId : null,
          producto_id: conteoTipo === 'producto' ? conteoRefId : null,
          estado: 'borrador', notas: conteoNotas || null, ajuste_aplicado: false,
          created_by: user?.id, sucursal_id: sucursalId || null,
        }).select().single()
        if (cErr) throw cErr
        conteoId = conteo.id
      }
      const { error: iErr } = await supabase.from('inventario_conteo_items').insert(
        conteoRows.map(row => ({
          conteo_id: conteoId!, inventario_linea_id: row.linea_id, producto_id: row.producto_id,
          lpn: row.lpn || null, cantidad_esperada: row.cantidad_esperada,
          cantidad_contada: parseFloat(row.cantidad_contada) || 0,
        }))
      )
      if (iErr) throw iErr
    },
    onSuccess: () => {
      toast.success('Conteo guardado como borrador')
      qc.invalidateQueries({ queryKey: ['conteo-historial'] })
      resetConteoForm()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const finalizarConteoYAplicar = useMutation({
    mutationFn: async () => {
      if (conteoRows.length === 0) throw new Error('Cargá el stock antes de finalizar')
      let conteoId = continuandoConteoId
      if (conteoId) {
        // ISS-100: actualizar borrador existente → marcar como finalizado
        const { error: uErr } = await supabase.from('inventario_conteos')
          .update({ estado: 'finalizado', notas: conteoNotas || null, ajuste_aplicado: true }).eq('id', conteoId)
        if (uErr) throw uErr
        await supabase.from('inventario_conteo_items').delete().eq('conteo_id', conteoId)
      } else {
        const { data: conteo, error: cErr } = await supabase.from('inventario_conteos').insert({
          tenant_id: tenant!.id, tipo: conteoTipo,
          ubicacion_id: conteoTipo === 'ubicacion' && conteoRefId && conteoRefId !== '__sin__' ? conteoRefId : null,
          producto_id: conteoTipo === 'producto' ? conteoRefId : null,
          estado: 'finalizado', notas: conteoNotas || null, ajuste_aplicado: true,
          created_by: user?.id, sucursal_id: sucursalId || null,
        }).select().single()
        if (cErr) throw cErr
        conteoId = conteo.id
      }
      await supabase.from('inventario_conteo_items').insert(
        conteoRows.map(row => ({
          conteo_id: conteoId!, inventario_linea_id: row.linea_id, producto_id: row.producto_id,
          lpn: row.lpn || null, cantidad_esperada: row.cantidad_esperada,
          cantidad_contada: parseFloat(row.cantidad_contada) || 0,
        }))
      )
      let ajustes = 0
      for (const row of conteoRows) {
        const contada = parseFloat(row.cantidad_contada) || 0
        const diff = contada - row.cantidad_esperada
        if (Math.abs(diff) < 0.001) continue
        await supabase.from('inventario_lineas').update({ cantidad: contada, activo: contada > 0 }).eq('id', row.linea_id)
        const stockAntes = await getStockAntesSucursal(row.producto_id, sucursalId)
        await supabase.from('movimientos_stock').insert({
          tenant_id: tenant!.id, producto_id: row.producto_id,
          tipo: diff > 0 ? 'ajuste_ingreso' : 'ajuste_rebaje', cantidad: Math.abs(diff),
          stock_antes: stockAntes,
          stock_despues: Math.max(0, stockAntes + diff),
          motivo: `Conteo de inventario${row.lpn ? ` — LPN ${row.lpn}` : ` — ${row.sku}`}`,
          usuario_id: user?.id, linea_id: row.linea_id, sucursal_id: sucursalId || null,
        })
        ajustes++
      }
      return ajustes
    },
    onSuccess: (ajustes) => {
      toast.success(`Conteo finalizado — ${ajustes} ajuste${ajustes !== 1 ? 's' : ''} aplicado${ajustes !== 1 ? 's' : ''}`)
      qc.invalidateQueries({ queryKey: ['conteo-historial'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      resetConteoForm()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ISS-100: eliminar borrador de conteo
  const eliminarConteo = useMutation({
    mutationFn: async (conteoId: string) => {
      const { error } = await supabase.from('inventario_conteos').delete().eq('id', conteoId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Borrador eliminado')
      qc.invalidateQueries({ queryKey: ['conteo-historial'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const closeModal = () => {
    setModal(null); setSelectedProduct(null)
    setForm(emptyIngreso); setSeries([''])
    setRebajeLpn(''); setRebajeLinea(null)
    setRebajeCantidad(''); setRebajeMotivo(''); setRebajeSeries([])
    setRebajeSearch(''); setRebajeGrupoId(null)
    setIngresoMotivoSelect(''); setRebajeMotivoSelect('')
    setIngresoUnitAlt(null); setRebajeUnitAlt(null)
    setIngresoEstructuraId('')
    setIngresoSucursalId(null)
  }

  useModalKeyboard({
    isOpen: modal !== null,
    onClose: closeModal,
    onConfirm: () => {
      if (modal === 'ingreso' && !ingresoMutation.isPending) ingresoMutation.mutate()
      if (modal === 'rebaje' && !rebajeMutation.isPending) rebajeMutation.mutate()
    },
  })

  // ── Shortcuts de teclado por tab (cuando no hay modal abierto) ────────────
  useEffect(() => {
    if (modal !== null || lpnAcciones) return // modal ya abierto, lo maneja useModalKeyboard
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const enInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      // ── Tab Agregar Stock ──────────────────────────────────────────────────
      if (tab === 'agregar') {
        if (e.key === 'Enter' && !enInput) { e.preventDefault(); setModal('ingreso') }
        if (e.key === 'Escape') { e.preventDefault(); setSelectedProduct(null); setForm(emptyIngreso) }
      }

      // ── Tab Quitar Stock ───────────────────────────────────────────────────
      if (tab === 'quitar') {
        if (e.key === 'Enter' && !enInput) { e.preventDefault(); setModal('rebaje') }
        if (e.key === 'Escape') { e.preventDefault(); setSelectedProduct(null); setRebajeLinea(null) }
      }

      // ── Tab Conteos ────────────────────────────────────────────────────────
      if (tab === 'conteo') {
        if (e.key === 'Escape' && showConteoForm) {
          e.preventDefault()
          resetConteoForm()
          return
        }
        if (e.key === 'Enter' && !enInput) {
          e.preventDefault()
          if (!showConteoForm) {
            // Estado 1: abrir nuevo conteo
            setShowConteoForm(true)
          } else if (conteoRows.length === 0 && conteoRefId && !conteoLoading) {
            // Estado 2: cargar stock (solo si hay ubicación/SKU seleccionado)
            cargarLineasParaConteo()
          } else if (conteoRows.length > 0 && !finalizarConteoYAplicar.isPending) {
            // Estado 3: finalizar y aplicar ajustes
            finalizarConteoYAplicar.mutate()
          }
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tab, modal, lpnAcciones, showConteoForm, conteoRows.length, conteoRefId,
      conteoLoading, finalizarConteoYAplicar.isPending])

  const handleBarcodeScan = async (code: string) => {
    setMovScannerOpen(false)
    const { data: prods } = await supabase.from('productos')
      .select('id, nombre, sku, stock_actual, unidad_medida, imagen_url, tiene_series, tiene_lote, tiene_vencimiento, ubicacion_id, precio_costo')
      .eq('tenant_id', tenant!.id).eq('activo', true)
      .or(`codigo_barras.eq.${code},sku.eq.${code}`)
      .limit(1)
    if (!prods || prods.length === 0) {
      toast.error(`No se encontró ningún producto con código "${code}"`)
      return
    }
    const prod = prods[0] as unknown as Producto
    setSelectedProduct(prod)
    setForm(f => ({ ...f, productoSearch: '', ubicacionId: (prod as any).ubicacion_id ?? f.ubicacionId }))
  }

  // ── Masivo inline helpers ─────────────────────────────────────────────────
  const addMasivoRow = (prod: any) => {
    setMasivoRows(prev => {
      // Same SKU + no lote required → increment quantity
      const existingIdx = prev.findIndex(r => r.producto_id === prod.id && !r.nro_lote && !prod.tiene_lote && !prod.tiene_series)
      if (existingIdx >= 0) {
        const updated = [...prev]
        const prevCant = parseFloat(updated[existingIdx].cantidad) || 0
        updated[existingIdx] = { ...updated[existingIdx], cantidad: String(prevCant + 1) }
        setMasivoFocusIdx(existingIdx)
        return updated
      }
      const newRow: MasivoRow = {
        _id: crypto.randomUUID(),
        producto_id: prod.id,
        nombre: prod.nombre,
        sku: prod.sku,
        unidad_medida: prod.unidad_medida ?? null,
        tiene_series: prod.tiene_series ?? false,
        tiene_lote: prod.tiene_lote ?? false,
        tiene_vencimiento: prod.tiene_vencimiento ?? false,
        cantidad: '1',
        estado_id: '',
        ubicacion_id: '',
        nro_lote: '',
        fecha_vencimiento: '',
        lpn: '',
        series_txt: '',
        showExtra: !!(prod.tiene_lote || prod.tiene_vencimiento || prod.tiene_series),
      }
      setMasivoFocusIdx(prev.length)
      return [...prev, newRow]
    })
    setMasivoSearch('')
    setTimeout(() => masivoSearchRef.current?.focus(), 50)
  }

  const handleMasivoScan = async (code: string) => {
    setMasivoScannerOpen(false)
    const { data: prods } = await supabase.from('productos')
      .select('id, nombre, sku, unidad_medida, tiene_series, tiene_lote, tiene_vencimiento, precio_costo, precio_venta')
      .eq('tenant_id', tenant!.id).eq('activo', true)
      .or(`codigo_barras.eq.${code},sku.eq.${code}`)
      .limit(1)
    if (!prods || prods.length === 0) {
      toast.error(`No se encontró ningún producto con código "${code}"`)
      setTimeout(() => masivoSearchRef.current?.focus(), 50)
      return
    }
    addMasivoRow(prods[0])
  }

  // Focus effect: when masivoFocusIdx changes, focus the qty input
  useEffect(() => {
    if (masivoFocusIdx !== null) {
      setTimeout(() => {
        masivoQtyRefs.current[masivoFocusIdx]?.focus()
        masivoQtyRefs.current[masivoFocusIdx]?.select()
        setMasivoFocusIdx(null)
      }, 50)
    }
  }, [masivoFocusIdx])

  const procesarMasivoIngreso = useMutation({
    mutationFn: async () => {
      if (limits && !limits.puede_crear_movimiento)
        throw new Error('Límite de movimientos del plan alcanzado')
      if (masivoRows.length === 0) throw new Error('Agregá al menos un producto')
      const errores: string[] = []
      let exitos = 0

      for (const row of masivoRows) {
        try {
          const cant = row.tiene_series
            ? row.series_txt.split('\n').filter(s => s.trim()).length
            : Math.max(0, parseFloat(row.cantidad) || 0)
          if (!cant || cant <= 0) { errores.push(`${row.sku}: cantidad inválida`); continue }
          if (row.tiene_lote && !row.nro_lote.trim()) { errores.push(`${row.sku}: requiere lote`); continue }
          if (row.tiene_vencimiento && !row.fecha_vencimiento) { errores.push(`${row.sku}: requiere vencimiento`); continue }

          const { data: prodAntes } = await supabase.from('productos').select('precio_costo,precio_venta').eq('id', row.producto_id).single()
          const stockAntes = await getStockAntesSucursal(row.producto_id, sucursalId)

          const { data: linea, error: lineaError } = await supabase.from('inventario_lineas').insert({
            tenant_id: tenant!.id,
            producto_id: row.producto_id,
            lpn: row.lpn || null,
            cantidad: row.tiene_series ? 0 : cant,
            estado_id: row.estado_id || null,
            ubicacion_id: row.ubicacion_id || null,
            nro_lote: row.nro_lote || null,
            fecha_vencimiento: row.fecha_vencimiento || null,
            precio_costo_snapshot: (prodAntes as any)?.precio_costo ?? null,
            precio_venta_snapshot: (prodAntes as any)?.precio_venta ?? null,
            sucursal_id: sucursalId ?? null,
          }).select().single()
          if (lineaError) { errores.push(`${row.sku}: ${lineaError.message}`); continue }

          if (row.tiene_series) {
            const seriesValidas = row.series_txt.split('\n').filter(s => s.trim())
            if (seriesValidas.length === 0) { errores.push(`${row.sku}: sin series`); continue }
            const { error: seriesError } = await supabase.from('inventario_series').insert(
              seriesValidas.map(nro => ({
                tenant_id: tenant!.id,
                producto_id: row.producto_id,
                linea_id: linea.id,
                nro_serie: nro.trim(),
                estado_id: row.estado_id || null,
              }))
            )
            if (seriesError) { errores.push(`${row.sku}: ${seriesError.message}`); continue }
          }

          await supabase.from('movimientos_stock').insert({
            tenant_id: tenant!.id,
            producto_id: row.producto_id,
            tipo: 'ingreso',
            cantidad: cant,
            stock_antes: stockAntes,
            stock_despues: stockAntes + cant,
            usuario_id: user?.id,
            linea_id: linea.id,
            sucursal_id: sucursalId || null,
          })
          exitos++
        } catch (e: any) {
          errores.push(`${row.sku}: ${e.message}`)
        }
      }

      if (exitos === 0 && errores.length > 0) throw new Error(errores.join(' · '))
      return { exitos, errores }
    },
    onSuccess: ({ exitos, errores }) => {
      if (errores.length > 0) toast.error(`${exitos} OK · Errores: ${errores.join(' · ')}`, { duration: 8000 })
      else toast.success(`${exitos} ingreso${exitos !== 1 ? 's' : ''} registrado${exitos !== 1 ? 's' : ''}`)
      if (exitos > 0) logActividad({
        entidad: 'inventario_linea',
        entidad_nombre: `Ingreso masivo (${exitos} producto${exitos !== 1 ? 's' : ''})`,
        accion: 'crear',
        valor_nuevo: `Ingreso masivo — ${exitos} producto${exitos !== 1 ? 's' : ''}`,
        pagina: '/inventario',
      })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      setMasivoRows([])
      setMasivoInline(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getTipoBadge(tipo: string, motivo: string | null) {
    const isConteo = (motivo ?? '').startsWith('Conteo')
    if (tipo === 'ajuste_ingreso') return { label: isConteo ? 'Conteo' : 'Ajuste +', bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-400' }
    if (tipo === 'ajuste_rebaje') return { label: isConteo ? 'Conteo' : 'Ajuste -', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' }
    if (tipo === 'ingreso') return { label: 'Ingreso', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' }
    if (tipo === 'kitting') return { label: 'Kitting', bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-400' }
    if (tipo === 'des_kitting') return { label: 'Desarmado', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400' }
    if (tipo === 'ajuste') return { label: 'Ajuste', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' }
    return { label: 'Rebaje', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' }
  }

  // ── Computed values ────────────────────────────────────────────────────────
  const filteredMov = movimientos.filter(m => {
    const tipo = (m as any).tipo as string
    // Filtro por tipo según tab (sin early return para que movSearch también aplique)
    if (tab === 'agregar' && !(tipo === 'ingreso' || tipo === 'kitting')) return false
    if (tab === 'quitar' && !(tipo === 'rebaje' || tipo === 'des_kitting')) return false
    // Filtros adicionales solo en historial
    if (tab === 'historial') {
      if (filterHistFechaDesde && m.created_at < filterHistFechaDesde) return false
      if (filterHistFechaHasta && m.created_at > filterHistFechaHasta + 'T23:59:59') return false
      if (filterHistTipo && tipo !== filterHistTipo) return false
      if (filterHistCatId && (m as any).productos?.categoria_id !== filterHistCatId) return false
      if (filterHistMotivo && !(m as any).motivo?.toLowerCase().includes(filterHistMotivo.toLowerCase())) return false
    }
    // Búsqueda por producto/SKU — aplica a TODOS los tabs (agregar, quitar, historial)
    if (!movSearch) return true
    const s = movSearch.toLowerCase()
    return (m as any).productos?.nombre?.toLowerCase().includes(s) ||
      (m as any).productos?.sku?.toLowerCase().includes(s)
  })

  const getStockTotal = (producto: any) => {
    const lineas = lineasMap[producto.id] ?? []
    if (producto.tiene_series) {
      return lineas.reduce((acc: number, l: any) =>
        acc + (l.inventario_series ?? []).filter((s: any) => s.activo).length, 0)
    }
    return lineas.reduce((acc: number, l: any) => acc + (l.cantidad || 0), 0)
  }

  const getStockDisponible = (producto: any) => {
    const lineas = lineasMap[producto.id] ?? []
    const lineasDisp = lineas.filter((l: any) => l.estados_inventario?.es_disponible_venta !== false)
    if (producto.tiene_series) {
      return lineasDisp.reduce((acc: number, l: any) =>
        acc + (l.inventario_series ?? []).filter((s: any) => s.activo && !s.reservado).length, 0)
    }
    return lineasDisp.reduce((acc: number, l: any) =>
      acc + Math.max(0, (l.cantidad || 0) - (l.cantidad_reservada || 0)), 0)
  }

  const filteredInv = productos.filter(p => {
    // Búsqueda por texto: nombre, SKU, código de barras, ubicación o LPN
    if (invSearch) {
      const s = invSearch.toLowerCase()
      const lineas = lineasMap[(p as any).id] ?? []
      const matchProd = p.nombre.toLowerCase().includes(s)
        || ((p as any).sku ?? '').toLowerCase().includes(s)
        || ((p as any).codigo_barras ?? '') === invSearch
      const matchLpn = lineas.some((l: any) => (l.lpn ?? '').toLowerCase().includes(s))
      const matchUbic = lineas.some((l: any) => (l.ubicaciones?.nombre ?? '').toLowerCase().includes(s))
      if (!matchProd && !matchLpn && !matchUbic) return false
    }
    const stock = getStockTotal(p)
    if (filterAlerta && stock > (p as any).stock_minimo) return false
    // Filtro por categoría
    if (filterCat === '__sin__' && (p as any).categoria_id != null) return false
    if (filterCat && filterCat !== '__sin__' && (p as any).categoria_id !== filterCat) return false
    const lineas = lineasMap[(p as any).id] ?? []
    // Filtro por proveedor (en lineas del producto)
    if (filterProv) {
      if (filterProv === '__sin__') {
        if (!lineas.some((l: any) => l.proveedor_id == null)) return false
      } else {
        if (!lineas.some((l: any) => l.proveedor_id === filterProv)) return false
      }
    }
    // Filtro por ubicación (en lineas del producto)
    if (filterUbic) {
      if (filterUbic === '__sin__') {
        if (!lineas.some((l: any) => l.ubicacion_id == null)) return false
      } else {
        if (!lineas.some((l: any) => l.ubicacion_id === filterUbic)) return false
      }
    }
    // Filtro por estado (en lineas del producto)
    if (filterEstado) {
      if (filterEstado === '__sin__') {
        if (!lineas.some((l: any) => l.estado_id == null)) return false
      } else {
        if (!lineas.some((l: any) => l.estado_id === filterEstado)) return false
      }
    }
    return true
  })

  const stockCritico = productos.filter(p => getStockTotal(p) <= (p as any).stock_minimo).length

  const tieneSeries = selectedProduct && (selectedProduct as any).tiene_series
  const limiteAlcanzado = limits ? !limits.puede_crear_movimiento : false
  const limiteWarning = limits && limits.max_movimientos !== -1 && limits.pct_movimientos >= 80

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Modal acciones LPN */}
      {lpnAcciones && (
        <LpnAccionesModal
          linea={lpnAcciones.linea}
          producto={lpnAcciones.producto}
          onClose={() => setLpnAcciones(null)}
        />
      )}

      {/* Modal masivo */}
      {masivoModal && (
        <MasivoModal
          tipo={masivoModal}
          onClose={() => setMasivoModal(null)}
          onSuccess={() => {}}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Inventario</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            {tab === 'inventario' ? 'Líneas de stock y LPNs' :
             tab === 'agregar' ? 'Ingresá mercadería al stock' :
             tab === 'quitar' ? 'Rebajá o ajustá el stock' :
             tab === 'conteo' ? 'Verificá el stock real contra el esperado' :
             tab === 'historial' ? 'Registro de todos los movimientos' :
             tab === 'autorizaciones' ? 'Solicitudes de ajuste o eliminación pendientes de aprobación' :
             'Armado y desarmado de kits'}
          </p>
        </div>
        {tab === 'agregar' && !masivoInline && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModal('ingreso')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus size={16} /> Ingreso
            </button>
            <button onClick={() => { setMasivoInline(true); setMasivoRows([]) }} disabled={limiteAlcanzado}
              className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Recepción de múltiples SKUs">
              <Plus size={16} /> Masivo
            </button>
            <button onClick={() => navigate('/recepciones')}
              className="flex items-center gap-2 border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
              title="Módulo de recepción / ASN">
              <ShoppingBasket size={16} /> ASN
            </button>
          </div>
        )}
        {tab === 'quitar' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModal('rebaje')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              <Minus size={16} /> Rebaje
            </button>
            <button onClick={() => setMasivoModal('rebaje')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Rebaje de múltiples SKUs">
              <Minus size={16} /> Masivo
            </button>
          </div>
        )}
        {tab === 'conteo' && !showConteoForm && (
          <button onClick={() => setShowConteoForm(true)}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> Nuevo conteo
          </button>
        )}
        {tab === 'inventario' && (
          <button onClick={() => navigate('/inventario/importar')}
            className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all"
            title="Importar stock desde Excel">
            <Upload size={16} /> Importar
          </button>
        )}
      </div>

      {/* Tabs + vista toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' } as any}>
          {([
            { id: 'inventario' as const, label: 'Inventario' },
            { id: 'agregar' as const, label: 'Agregar stock' },
            { id: 'quitar' as const, label: 'Quitar stock' },
            { id: 'kits' as const, label: 'Kits' },
            { id: 'conteo' as const, label: 'Conteos' },
            { id: 'historial' as const, label: 'Historial' },
            ...(puedeVerAutorizaciones ? [{ id: 'autorizaciones' as const, label: 'Autorizaciones' }] : []),
          ]).map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
                ${tab === id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'inventario' && (
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-xl p-1 flex-shrink-0 mb-px">
            <button onClick={() => setInvVista('producto')} title="Por producto"
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${invVista === 'producto' ? 'bg-white dark:bg-gray-800 shadow-sm text-accent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <LayoutList size={15} />
            </button>
            <button onClick={() => setInvVista('ubicacion')} title="Por ubicación"
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${invVista === 'ubicacion' ? 'bg-white dark:bg-gray-800 shadow-sm text-accent' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Building size={15} />
            </button>
          </div>
        )}
      </div>

      {/* ═══════════ TABS: AGREGAR / QUITAR / HISTORIAL ═══════════════════ */}
      {(tab === 'agregar' || tab === 'quitar' || tab === 'historial') && (
        <>
          {/* Barra de uso de movimientos — solo en agregar/quitar */}
          {tab !== 'historial' && limits && (
            limits.max_movimientos === -1 ? (
              // Plan ilimitado: mostrar solo el contador sin barra de límite
              <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 border border-border-ds bg-surface text-sm">
                <div className="flex-1 min-w-0">
                  <span className="text-muted font-medium">
                    {limits.movimientos_mes.toLocaleString()} movimiento{limits.movimientos_mes !== 1 ? 's' : ''} este mes
                  </span>
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">· Sin límite en tu plan</span>
                </div>
              </div>
            ) : (
              <PlanProgressBar
                actual={limits.movimientos_mes}
                max={limits.max_movimientos}
                label="movimientos este mes"
                addonInfo={limits.addon_movimientos > 0 ? `(incluye ${limits.addon_movimientos} extra)` : undefined}
              />
            )
          )}

          {/* ── MASIVO INLINE VIEW (solo agregar) ─── */}
          {tab === 'agregar' && masivoInline ? (
            <div className="space-y-3">
              {/* Barra superior masivo */}
              <div className="flex items-center gap-3">
                <button onClick={() => { setMasivoInline(false); setMasivoRows([]); setMasivoSearch('') }}
                  className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <ChevronLeft size={16} /> Cancelar
                </button>
                <span className="text-sm font-semibold text-primary">Recepción masiva</span>
                {masivoRows.length > 0 && (
                  <span className="ml-auto text-xs text-gray-400">{masivoRows.length} SKU{masivoRows.length !== 1 ? 's' : ''}</span>
                )}
              </div>

              {/* Buscador + scanner */}
              <div className="relative flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={masivoSearchRef}
                    type="text"
                    value={masivoSearch}
                    onChange={e => setMasivoSearch(e.target.value)}
                    onFocus={() => setMasivoSearchFocused(true)}
                    onBlur={() => setTimeout(() => setMasivoSearchFocused(false), 150)}
                    placeholder="Escanear o buscar SKU / nombre..."
                    autoFocus
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800"
                  />
                  {/* Dropdown sugerencias */}
                  {(masivoSearchFocused || masivoSearch.length > 0) && masivoBusqueda.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 overflow-hidden">
                      {masivoBusqueda.map((p: any) => (
                        <button key={p.id} onMouseDown={() => addMasivoRow(p)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                            <p className="text-xs text-gray-400">{p.sku}{p.tiene_series ? ' · Serializado' : ''}{p.tiene_lote ? ' · Lote' : ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setMasivoScannerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 dark:text-gray-400 hover:text-accent hover:border-accent transition-colors"
                  title="Escanear código">
                  <Camera size={18} />
                </button>
              </div>

              {/* Tabla de filas */}
              {masivoRows.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-8">#</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Producto</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-28">Cantidad</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-36">Estado</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-36">Ubicación</th>
                          <th className="px-3 py-2.5 w-8" />
                          <th className="px-3 py-2.5 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {masivoRows.map((row, idx) => (
                          <Fragment key={row._id}>
                            <tr className="border-b border-gray-100 dark:border-gray-700">
                              <td className="px-3 py-2 text-xs text-gray-400 text-center">{idx + 1}</td>
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{row.nombre}</p>
                                <p className="text-xs text-gray-400">{row.sku}{row.unidad_medida ? ` · ${row.unidad_medida}` : ''}</p>
                              </td>
                              <td className="px-3 py-2">
                                {row.tiene_series ? (
                                  <span className="text-xs text-gray-400 block text-center">ver abajo</span>
                                ) : (
                                  <input
                                    type="number"
                                    ref={el => { masivoQtyRefs.current[idx] = el }}
                                    min="0.001" step="1"
                                    value={row.cantidad}
                                    onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, cantidad: e.target.value } : r))}
                                    onWheel={e => e.currentTarget.blur()}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); masivoSearchRef.current?.focus() } }}
                                    className="w-full text-center px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800"
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <select value={row.estado_id}
                                  onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, estado_id: e.target.value } : r))}
                                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                                  <option value="">Sin estado</option>
                                  {estados.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <select value={row.ubicacion_id}
                                  onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, ubicacion_id: e.target.value } : r))}
                                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                                  <option value="">Sin ubic.</option>
                                  {ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, showExtra: !r.showExtra } : r))}
                                  title="Lote / Vencimiento / LPN / Series"
                                  className={`p-1 rounded transition-colors ${row.showExtra ? 'text-accent' : 'text-gray-400 hover:text-gray-600'}`}>
                                  <ChevronDown size={14} className={`transition-transform ${row.showExtra ? 'rotate-180' : ''}`} />
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button onClick={() => setMasivoRows(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                                  <X size={14} />
                                </button>
                              </td>
                            </tr>
                            {row.showExtra && (
                              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
                                <td />
                                <td colSpan={6} className="px-3 py-2.5">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    {(row.tiene_lote || !row.tiene_series) && (
                                      <div>
                                        <label className="block text-gray-500 mb-1">Nro. lote{row.tiene_lote ? ' *' : ''}</label>
                                        <input type="text" value={row.nro_lote} placeholder="LOT-001"
                                          onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, nro_lote: e.target.value } : r))}
                                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
                                      </div>
                                    )}
                                    {(row.tiene_vencimiento || !row.tiene_series) && (
                                      <div>
                                        <label className="block text-gray-500 mb-1">Vencimiento{row.tiene_vencimiento ? ' *' : ''}</label>
                                        <input type="date" value={row.fecha_vencimiento}
                                          onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, fecha_vencimiento: e.target.value } : r))}
                                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
                                      </div>
                                    )}
                                    {!row.tiene_series && (
                                      <div>
                                        <label className="block text-gray-500 mb-1">LPN</label>
                                        <input type="text" value={row.lpn} placeholder="LPN-001"
                                          onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, lpn: e.target.value } : r))}
                                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-accent bg-white dark:bg-gray-800 font-mono" />
                                      </div>
                                    )}
                                    {row.tiene_series && (
                                      <div className="col-span-4">
                                        <label className="block text-gray-500 mb-1">Números de serie (uno por línea)</label>
                                        <textarea rows={3} value={row.series_txt} placeholder={"SN-001\nSN-002\nSN-003"}
                                          onChange={e => setMasivoRows(prev => prev.map((r, i) => i === idx ? { ...r, series_txt: e.target.value } : r))}
                                          className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-accent bg-white dark:bg-gray-800 font-mono text-xs resize-none" />
                                        <p className="text-gray-400 mt-0.5">{row.series_txt.split('\n').filter(s => s.trim()).length} series</p>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Botón procesar */}
              {masivoRows.length > 0 && (
                <button
                  onClick={() => procesarMasivoIngreso.mutate()}
                  disabled={procesarMasivoIngreso.isPending || (limits ? !limits.puede_crear_movimiento : false)}
                  className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {procesarMasivoIngreso.isPending ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Procesando...</>
                  ) : (
                    <><CheckCircle2 size={16} /> Procesar {masivoRows.length} ingreso{masivoRows.length !== 1 ? 's' : ''}</>
                  )}
                </button>
              )}

              {masivoScannerOpen && (
                <BarcodeScanner
                  title="Escanear producto"
                  onDetected={handleMasivoScan}
                  onClose={() => setMasivoScannerOpen(false)}
                />
              )}
            </div>
          ) : (
          /* ── VISTA NORMAL (historial de movimientos) ── */
          <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input type="text" value={movSearch} onChange={e => setMovSearch(e.target.value)}
              placeholder="Buscar por producto o SKU..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
          </div>

          {/* ── Filtros adicionales solo en tab Historial ── */}
          {tab === 'historial' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Desde</label>
                <input type="date" value={filterHistFechaDesde} onChange={e => setFilterHistFechaDesde(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Hasta</label>
                <input type="date" value={filterHistFechaHasta} onChange={e => setFilterHistFechaHasta(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Categoría</label>
                <select value={filterHistCatId} onChange={e => setFilterHistCatId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                  <option value="">Todas</option>
                  {(categoriasHistorial as any[]).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                <select value={filterHistTipo} onChange={e => setFilterHistTipo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                  <option value="">Todos</option>
                  <option value="ingreso">Ingreso</option>
                  <option value="rebaje">Rebaje</option>
                  <option value="ajuste_ingreso">Ajuste +</option>
                  <option value="ajuste_rebaje">Ajuste -</option>
                  <option value="kitting">Kitting</option>
                  <option value="des_kitting">Desarmado</option>
                  <option value="ajuste">Ajuste (genérico)</option>
                </select>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Motivo</label>
                <input type="text" value={filterHistMotivo} onChange={e => setFilterHistMotivo(e.target.value)}
                  placeholder="Buscar en el motivo..."
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
              </div>
              {(filterHistFechaDesde || filterHistFechaHasta || filterHistCatId || filterHistTipo || filterHistMotivo) && (
                <div className="col-span-2 sm:col-span-4 flex justify-end">
                  <button onClick={() => { setFilterHistFechaDesde(''); setFilterHistFechaHasta(''); setFilterHistCatId(''); setFilterHistTipo(''); setFilterHistMotivo('') }}
                    className="text-xs text-accent hover:underline">Limpiar filtros</button>
                </div>
              )}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {movLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredMov.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <p>No hay movimientos registrados</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 dark:bg-gray-700">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Fecha</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Producto</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Tipo</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Cantidad</th>
                      {tab === 'historial' && <>
                        <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Stock prev.</th>
                        <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Stock nuevo</th>
                      </>}
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Motivo</th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMov.map((m: any) => {
                      const badge = getTipoBadge(m.tipo, m.motivo)
                      return (
                      <tr key={m.id} onClick={() => setMovDetalle(m)}
                        className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800 dark:text-gray-100">{m.productos?.nombre}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">{m.productos?.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{m.cantidad}</td>
                        {tab === 'historial' && <>
                          <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500 hidden md:table-cell">{m.stock_antes}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell">{m.stock_despues}</td>
                        </>}
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                          <span>{m.motivo ?? '—'}</span>
                          {m.venta_id && (
                            <button
                              onClick={e => { e.stopPropagation(); navigate(`/ventas?id=${m.venta_id}`) }}
                              className="ml-2 inline-flex items-center gap-0.5 text-accent hover:underline font-medium"
                              title="Ver venta">
                              <ExternalLink size={11} />#{m.ventas?.numero}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-300"><ChevronRight size={14} /></td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Modal DETALLE MOVIMIENTO */}
          {movDetalle && (() => {
            const linea = movDetalle.inventario_lineas
            const seriesLinea = linea?.inventario_series ?? []
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
                onClick={() => setMovDetalle(null)}>
                <div className="bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                  onClick={e => e.stopPropagation()}>
                  <div className={`px-5 py-4 flex items-center justify-between flex-shrink-0
                    ${movDetalle.tipo === 'ingreso' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center
                        ${movDetalle.tipo === 'ingreso' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                        {movDetalle.tipo === 'ingreso' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-gray-100 capitalize">{movDetalle.tipo}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(movDetalle.created_at).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' })}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setMovDetalle(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-4 overflow-y-auto">
                    <div className="flex items-start gap-3">
                      <Package size={16} className="text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">Producto</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-100">{movDetalle.productos?.nombre}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{movDetalle.productos?.sku}
                          {movDetalle.productos?.unidad_medida && <span className="ml-2 text-gray-300">· {movDetalle.productos.unidad_medida}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 flex items-center justify-between">
                      <div className="text-center">
                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Stock anterior</p>
                        <p className="text-2xl font-bold text-gray-500 dark:text-gray-400">{movDetalle.stock_antes}</p>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-sm font-bold px-3 py-1 rounded-full
                          ${movDetalle.tipo === 'ingreso' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                          {movDetalle.tipo === 'ingreso' ? '+' : '−'}{movDetalle.cantidad}
                        </span>
                        {movDetalle.tipo === 'ingreso'
                          ? <TrendingUp size={16} className="text-green-500" />
                          : <TrendingDown size={16} className="text-blue-500" />}
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Stock nuevo</p>
                        <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{movDetalle.stock_despues}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Fecha y hora</p>
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-gray-400 dark:text-gray-500" />
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            {new Date(movDetalle.created_at).toLocaleString('es-AR', { dateStyle: 'full', timeStyle: 'short' })}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Registrado por</p>
                        <div className="flex items-center gap-1.5">
                          <User size={13} className="text-gray-400 dark:text-gray-500" />
                          <p className="text-sm text-gray-700 dark:text-gray-300">{movDetalle.users?.nombre_display ?? '—'}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Estado</p>
                        {movDetalle.estados_inventario ? (
                          <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: (movDetalle.estados_inventario.color ?? '#6b7280') + '20', color: movDetalle.estados_inventario.color ?? '#6b7280' }}>
                            {movDetalle.estados_inventario.nombre}
                          </span>
                        ) : <p className="text-sm text-gray-400 dark:text-gray-500">—</p>}
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Motivo</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{movDetalle.motivo ?? '—'}</p>
                      </div>
                      {movDetalle.venta_id && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Venta origen</p>
                          <button
                            onClick={() => { setMovDetalle(null); navigate(`/ventas?id=${movDetalle.venta_id}`) }}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                            <ExternalLink size={13} />
                            Venta #{movDetalle.ventas?.numero ?? '—'}
                          </button>
                        </div>
                      )}
                      {linea ? (
                        <>
                          {linea.ubicaciones?.nombre && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Posición / Ubicación</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300">{linea.ubicaciones.nombre}</p>
                            </div>
                          )}
                          {linea.proveedores?.nombre && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Proveedor</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300">{linea.proveedores.nombre}</p>
                            </div>
                          )}
                          {linea.lpn && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">LPN / Pallet</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300">{linea.lpn}</p>
                            </div>
                          )}
                          {linea.nro_lote && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Nro. de lote</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300">{linea.nro_lote}</p>
                            </div>
                          )}
                          {linea.fecha_vencimiento && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Vencimiento</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300">
                                {new Date(linea.fecha_vencimiento).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
                              </p>
                            </div>
                          )}
                          {linea.precio_costo_snapshot != null && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Precio de costo</p>
                              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                ${linea.precio_costo_snapshot.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="col-span-2">
                          <p className="text-xs text-amber-500 italic">
                            {movDetalle.linea_id
                              ? 'La línea de inventario asociada ya no está disponible'
                              : 'Sin línea asociada — movimiento registrado antes del sistema de trazabilidad'}
                          </p>
                        </div>
                      )}
                    </div>
                    {seriesLinea.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-2">
                          Series ({seriesLinea.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {seriesLinea.map((s: any) => (
                            <span key={s.nro_serie}
                              className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 px-2 py-1 rounded-lg border border-purple-100">
                              {s.nro_serie}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-300 border-t border-gray-100 pt-3">ID: {movDetalle.id}</p>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Modal INGRESO */}
          {modal === 'ingreso' && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                    <ArrowDown size={20} className="text-green-600 dark:text-green-400" /> Ingreso de stock
                  </h2>
                  <button onClick={closeModal} className="text-gray-400 dark:text-gray-500 hover:text-gray-600"><X size={20} /></button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Producto</label>
                  {selectedProduct ? (
                    <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-accent/30 rounded-xl px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800 dark:text-gray-100">{selectedProduct.nombre}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          SKU: {selectedProduct.sku} | {effSucursalIngreso
                            ? <>Stock en sucursal: <span className="font-semibold text-primary">{stockEnSucursal ?? '…'}</span></>
                            : <>Stock total: {(selectedProduct as any).stock_actual}</>}
                        </p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(selectedProduct as any).tiene_series && <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1.5 py-0.5 rounded">Nº serie</span>}
                          {(selectedProduct as any).tiene_lote && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Lote</span>}
                          {(selectedProduct as any).tiene_vencimiento && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">Vencimiento</span>}
                        </div>
                      </div>
                      <button onClick={() => setSelectedProduct(null)} className="text-gray-400 dark:text-gray-500 text-xs">Cambiar</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input type="text" value={form.productoSearch}
                        onChange={e => setForm(p => ({ ...p, productoSearch: e.target.value }))}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                        placeholder="Buscar por nombre o SKU..."
                        className="w-full pl-8 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                      <button type="button" onClick={() => setMovScannerOpen(true)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-accent transition-colors"
                        title="Escanear código de barras">
                        <Camera size={16} />
                      </button>
                      {productosBusqueda.length > 0 && searchFocused && (
                        <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                          {productosBusqueda.map(p => (
                            <button key={p.id} onClick={() => {
                              setSelectedProduct(p)
                              setForm(f => ({ ...f, productoSearch: '', ubicacionId: (p as any).ubicacion_id ?? f.ubicacionId }))
                            }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm border-b border-gray-50 last:border-0">
                              <span className="font-medium">{p.nombre}</span>
                              <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">{p.sku}</span>
                              {(p as any).tiene_series && <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1 rounded">series</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedProduct && (
                  <>
                    {/* Selector de sucursal — solo para Dueño/SUPER en vista global "todas" */}
                    {!sucursalId && puedeVerTodas && sucursales.length > 0 && (
                      <div className="mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3">
                        <label className="block text-sm font-medium text-amber-800 dark:text-amber-300 mb-1.5">
                          Sucursal destino del ingreso *
                        </label>
                        <select value={ingresoSucursalId ?? ''}
                          onChange={e => setIngresoSucursalId(e.target.value || null)}
                          className="w-full px-3 py-2 border border-amber-300 dark:border-amber-600 rounded-lg text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800">
                          <option value="">Sin sucursal asignada</option>
                          {(sucursales as any[]).map((s: any) => (
                            <option key={s.id} value={s.id}>{s.nombre}</option>
                          ))}
                        </select>
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Estás en vista global. Elegí la sucursal donde va este stock.</p>
                      </div>
                    )}

                    <div className="mb-3">
                      <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        LPN
                        <InfoTip text="LPN (License Plate Number) es el identificador único de cada lote físico de mercadería. Se genera automáticamente si lo dejás vacío." />
                        <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal text-xs">(opcional — se genera automático)</span>
                      </label>
                      <input type="text" value={form.lpn} onChange={e => setForm(p => ({ ...p, lpn: e.target.value }))}
                        placeholder="Ej: LPN-20260101-A1"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                    </div>

                    {estructurasIngreso.length > 0 && (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estructura de embalaje</label>
                        <select value={ingresoEstructuraId} onChange={e => setIngresoEstructuraId(e.target.value)}
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent dark:bg-gray-700">
                          <option value="">Sin estructura</option>
                          {estructurasIngreso.map(e => (
                            <option key={e.id} value={e.id}>{e.nombre}{e.is_default ? ' (default)' : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {tieneSeries ? (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Números de serie</label>
                        <div className="space-y-2">
                          {series.map((s, i) => (
                            <div key={i} className="flex gap-2">
                              <div className="relative flex-1">
                                <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                                <input type="text" value={s}
                                  onChange={e => { const ns = [...series]; ns[i] = e.target.value; setSeries(ns) }}
                                  placeholder={`Serie ${i + 1}`}
                                  className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-accent" />
                              </div>
                              {series.length > 1 && (
                                <button onClick={() => setSeries(series.filter((_, j) => j !== i))}
                                  className="text-red-400 hover:text-red-600 px-2"><X size={16} /></button>
                              )}
                            </div>
                          ))}
                          <button onClick={() => setSeries([...series, ''])}
                            className="flex items-center gap-1 text-sm text-accent hover:underline">
                            <Plus size={14} /> Agregar serie
                          </button>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const uBase = (selectedProduct as any)?.unidad_medida ?? null
                        const alts = uBase ? unidadesCompatibles(uBase) : []
                        const unitActiva = ingresoUnitAlt ?? uBase
                        const cantN = parseFloat(form.cantidad)
                        const hint = ingresoUnitAlt && uBase && form.cantidad && !isNaN(cantN)
                          ? convertirUnidad(cantN, ingresoUnitAlt, uBase)
                          : null
                        return (
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Cantidad
                                {unitActiva && <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">({unitActiva})</span>}
                              </label>
                              {alts.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-gray-400 dark:text-gray-500">Ingresar en:</span>
                                  {[uBase!, ...alts].map(u => (
                                    <button key={u} type="button"
                                      onClick={() => setIngresoUnitAlt(u === uBase ? null : u)}
                                      className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                                        (ingresoUnitAlt ?? uBase) === u
                                          ? 'bg-accent text-white border-accent'
                                          : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent'
                                      }`}>{u}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="0.001" step="any"
                              value={form.cantidad}
                              onChange={e => setForm(p => ({ ...p, cantidad: e.target.value }))}
                              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" placeholder="0" />
                            {hint !== null && (
                              <p className="mt-1 text-xs text-accent">= {hint} {uBase}</p>
                            )}
                          </div>
                        )
                      })()
                    )}

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {estados.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado</label>
                          <select value={form.estadoId} onChange={e => setForm(p => ({ ...p, estadoId: e.target.value }))}
                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                            <option value="">Sin estado</option>
                            {(estados as any[]).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                          </select>
                        </div>
                      )}
                      {ubicaciones.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Ubicación
                            {selectedProduct && (selectedProduct as any).ubicacion_id && form.ubicacionId === (selectedProduct as any).ubicacion_id && (
                              <span className="ml-2 text-xs text-blue-500 font-normal">← ubicación del producto</span>
                            )}
                          </label>
                          {selectedProduct && (selectedProduct as any).ubicacion_id && form.ubicacionId !== (selectedProduct as any).ubicacion_id && form.ubicacionId !== '' && (
                            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg px-2.5 py-1.5">
                              <span>⚠️</span>
                              <span>Cambiaste la ubicación preseleccionada del producto</span>
                            </div>
                          )}
                          <select value={form.ubicacionId} onChange={e => setForm(p => ({ ...p, ubicacionId: e.target.value }))}
                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                            <option value="">Sin ubicación</option>
                            {(ubicaciones as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {proveedores.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Proveedor</label>
                          <select value={form.proveedorId} onChange={e => setForm(p => ({ ...p, proveedorId: e.target.value }))}
                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                            <option value="">Sin proveedor</option>
                            {(proveedores as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                        </div>
                      )}
                      {(selectedProduct as any).tiene_lote && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Nro. de lote <span className="text-red-500">*</span>
                          </label>
                          <input type="text" value={form.nroLote} onChange={e => setForm(p => ({ ...p, nroLote: e.target.value }))}
                            placeholder="Lote-001" required
                            className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-accent
                              ${!form.nroLote.trim() ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-700'}`} />
                        </div>
                      )}
                    </div>

                    {(selectedProduct as any).tiene_vencimiento && (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Fecha de vencimiento <span className="text-red-500">*</span>
                        </label>
                        <input type="date" value={form.fechaVencimiento} onChange={e => setForm(p => ({ ...p, fechaVencimiento: e.target.value }))}
                          required
                          className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-accent
                            ${!form.fechaVencimiento ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-700'}`} />
                      </div>
                    )}

                    <div className="mb-5">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
                      {motivos.filter((m: any) => m.tipo === 'ingreso' || m.tipo === 'ambos').length > 0 ? (
                        <div className="space-y-2">
                          <select value={ingresoMotivoSelect}
                            onChange={e => {
                              const val = e.target.value
                              setIngresoMotivoSelect(val)
                              setForm(p => ({ ...p, motivo: val === '__otro__' ? '' : val }))
                            }}
                            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                            <option value="">Seleccioná un motivo...</option>
                            {(motivos as any[]).filter((m: any) => m.tipo === 'ingreso' || m.tipo === 'ambos')
                              .map((m: any) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                            <option value="__otro__">Otro (escribir)</option>
                          </select>
                          {ingresoMotivoSelect === '__otro__' && (
                            <input type="text" value={form.motivo}
                              onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))}
                              placeholder="Escribí el motivo..."
                              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                          )}
                        </div>
                      ) : (
                        <input type="text" value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))}
                          placeholder="Ej: Compra a proveedor"
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                      )}
                    </div>
                  </>
                )}

                <div className="flex gap-3">
                  <button onClick={closeModal} className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl">Cancelar</button>
                  <button onClick={() => ingresoMutation.mutate()}
                    disabled={!selectedProduct || ingresoMutation.isPending}
                    className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50">
                    {ingresoMutation.isPending ? 'Guardando...' : 'Confirmar ingreso'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal REBAJE */}
          {modal === 'rebaje' && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                    <ArrowUp size={20} /> Rebaje de stock
                  </h2>
                  <button onClick={closeModal} className="text-gray-400 dark:text-gray-500 hover:text-gray-600"><X size={20} /></button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Producto</label>
                  {selectedProduct ? (
                    <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-accent/30 rounded-xl px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-800 dark:text-gray-100">{selectedProduct.nombre}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {sucursalId
                            ? <>Stock en sucursal: <span className="font-semibold text-primary">{stockEnSucursal ?? '…'}</span></>
                            : <>Stock total: {(selectedProduct as any).stock_actual}</>}
                        </p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(selectedProduct as any).tiene_series && <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1.5 py-0.5 rounded">Nº serie</span>}
                          {(selectedProduct as any).tiene_lote && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">Lote</span>}
                          {(selectedProduct as any).tiene_vencimiento && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">Vencimiento</span>}
                        </div>
                      </div>
                      <button onClick={() => { setSelectedProduct(null); setRebajeLinea(null) }} className="text-gray-400 dark:text-gray-500 text-xs">Cambiar</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input type="text" value={form.productoSearch}
                        onChange={e => setForm(p => ({ ...p, productoSearch: e.target.value }))}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                        placeholder="Buscar por nombre o SKU..."
                        className="w-full pl-8 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                      <button type="button" onClick={() => setMovScannerOpen(true)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-accent transition-colors"
                        title="Escanear código de barras">
                        <Camera size={16} />
                      </button>
                      {productosBusqueda.length > 0 && searchFocused && (
                        <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                          {productosBusqueda.map(p => (
                            <button key={p.id} onClick={() => { setSelectedProduct(p); setForm(f => ({ ...f, productoSearch: '' })) }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm border-b border-gray-50 last:border-0">
                              <span className="font-medium">{p.nombre}</span>
                              <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">{p.sku}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedProduct && (
                  <>
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                          Seleccioná línea de inventario
                          <InfoTip text="Cada ingreso de stock genera una línea independiente con su propio LPN. Podés rebajar de una línea específica para tener trazabilidad exacta." />
                        </label>
                      </div>

                      {grupos.length > 0 && (
                        <div className="mb-2 flex items-center gap-2 flex-wrap">
                          <Layers size={13} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                          <span className="text-xs text-gray-500 dark:text-gray-400">Filtrar por grupo:</span>
                          <button onClick={() => setRebajeGrupoId(null)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all
                              ${rebajeGrupoId === null && estadosDefault.length === 0
                                ? 'bg-primary text-white border-primary'
                                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                            Todos
                          </button>
                          {grupos.map(g => (
                            <button key={g.id} onClick={() => setRebajeGrupoId(rebajeGrupoId === g.id ? null : g.id)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                                ${rebajeGrupoId === g.id || (rebajeGrupoId === null && g.es_default)
                                  ? 'bg-primary text-white border-primary'
                                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                              {g.nombre}
                              {g.es_default && rebajeGrupoId === null && <span className="text-yellow-300">★</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                        <input type="text" value={rebajeSearch} onChange={e => setRebajeSearch(e.target.value)}
                          placeholder="Buscar por ubicación, estado o lote..."
                          className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs focus:outline-none focus:border-accent" />
                      </div>

                      {lineasProducto.length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">No hay líneas con stock disponible</p>
                      ) : (
                        <div className="space-y-2">
                          {lineasProducto
                            .filter((l: any) => {
                              if ((selectedProduct as any).tiene_series) return (l.inventario_series ?? []).filter((s: any) => s.activo).length > 0
                              return l.cantidad > 0
                            })
                            .filter((l: any) => {
                              if (!rebajeSearch) return true
                              const s = rebajeSearch.toLowerCase()
                              return (l.ubicaciones?.nombre ?? '').toLowerCase().includes(s) ||
                                (l.estados_inventario?.nombre ?? '').toLowerCase().includes(s) ||
                                (l.nro_lote ?? '').toLowerCase().includes(s) ||
                                (l.lpn ?? '').toLowerCase().includes(s)
                            })
                            .filter((l: any) => {
                              const grupoActivo = rebajeGrupoId ? grupos.find(g => g.id === rebajeGrupoId) : grupoDefault
                              if (!grupoActivo || grupoActivo.estado_ids.length === 0) return true
                              if (!l.estado_id) return false
                              return grupoActivo.estado_ids.includes(l.estado_id)
                            })
                            .map((l: any) => (
                              <button key={l.id} onClick={() => { setRebajeLinea(l); setRebajeSeries([]) }}
                                className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all text-sm
                                  ${rebajeLinea?.id === l.id ? 'border-accent bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {l.estados_inventario && (
                                      <span className="font-semibold text-sm" style={{ color: l.estados_inventario.color }}>
                                        ● {l.estados_inventario.nombre}
                                      </span>
                                    )}
                                    {l.ubicaciones && (
                                      <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">📍 {l.ubicaciones.nombre}</span>
                                    )}
                                    {!l.estados_inventario && !l.ubicaciones && (
                                      <span className="text-sm text-gray-500 dark:text-gray-400">Sin estado/ubicación</span>
                                    )}
                                  </div>
                                  <span className="font-bold text-gray-800 dark:text-gray-100">
                                    {(selectedProduct as any).tiene_series
                                      ? `${(l.inventario_series ?? []).filter((s: any) => s.activo).length} u.`
                                      : `${l.cantidad} u.`}
                                  </span>
                                </div>
                                <div className="flex gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                                  <span>{l.lpn}</span>
                                  {(l.ubicaciones?.prioridad ?? 0) > 0 && (
                                    <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-500 px-1 rounded">P{l.ubicaciones.prioridad}</span>
                                  )}
                                  {l.nro_lote && <span>🏷 {l.nro_lote}</span>}
                                  {l.fecha_vencimiento && <span>📅 {new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}</span>}
                                  {(l.cantidad_reservada ?? 0) > 0 && (
                                    <span className="text-orange-400">{l.cantidad_reservada} reservada(s)</span>
                                  )}
                                </div>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>

                    {rebajeLinea && (
                      <>
                        {tieneSeries ? (
                          <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Seleccioná las series a rebajar</label>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {(rebajeLinea.inventario_series ?? []).filter((s: any) => s.activo).map((s: any) => (
                                <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg cursor-pointer">
                                  <input type="checkbox" checked={rebajeSeries.includes(s.id)}
                                    onChange={e => setRebajeSeries(e.target.checked
                                      ? [...rebajeSeries, s.id]
                                      : rebajeSeries.filter(id => id !== s.id))} />
                                  <span className="text-sm">{s.nro_serie}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const uBase = (selectedProduct as any)?.unidad_medida ?? null
                            const alts = uBase ? unidadesCompatibles(uBase) : []
                            const unitActiva = rebajeUnitAlt ?? uBase
                            const disponible = rebajeLinea.cantidad - (rebajeLinea.cantidad_reservada ?? 0)
                            const cantN = parseFloat(rebajeCantidad)
                            const hint = rebajeUnitAlt && uBase && rebajeCantidad && !isNaN(cantN)
                              ? convertirUnidad(cantN, rebajeUnitAlt, uBase)
                              : null
                            return (
                              <div className="mb-4">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Cantidad a rebajar
                                    {unitActiva && <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">({unitActiva})</span>}
                                    <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">— disponible: {disponible}</span>
                                  </label>
                                  {alts.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-400 dark:text-gray-500">Ingresar en:</span>
                                      {[uBase!, ...alts].map(u => (
                                        <button key={u} type="button"
                                          onClick={() => setRebajeUnitAlt(u === uBase ? null : u)}
                                          className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                                            (rebajeUnitAlt ?? uBase) === u
                                              ? 'bg-accent text-white border-accent'
                                              : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent'
                                          }`}>{u}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <input type="number" onWheel={e => e.currentTarget.blur()} min="0.001" step="any"
                                  value={rebajeCantidad} onChange={e => setRebajeCantidad(e.target.value)}
                                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" placeholder="0" />
                                {hint !== null && (
                                  <p className="mt-1 text-xs text-accent">= {hint} {uBase}</p>
                                )}
                              </div>
                            )
                          })()
                        )}

                        <div className="mb-5">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
                          {motivos.filter((m: any) => (m.tipo === 'rebaje' || m.tipo === 'ambos') && !m.es_sistema).length > 0 ? (
                            <div className="space-y-2">
                              <select value={rebajeMotivoSelect}
                                onChange={e => {
                                  const val = e.target.value
                                  setRebajeMotivoSelect(val)
                                  setRebajeMotivo(val === '__otro__' ? '' : val)
                                }}
                                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                                <option value="">Seleccioná un motivo...</option>
                                {(motivos as any[]).filter((m: any) => (m.tipo === 'rebaje' || m.tipo === 'ambos') && !m.es_sistema)
                                  .map((m: any) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                                <option value="__otro__">Otro (escribir)</option>
                              </select>
                              {rebajeMotivoSelect === '__otro__' && (
                                <input type="text" value={rebajeMotivo} onChange={e => setRebajeMotivo(e.target.value)}
                                  placeholder="Escribí el motivo..."
                                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                              )}
                            </div>
                          ) : (
                            <input type="text" value={rebajeMotivo} onChange={e => setRebajeMotivo(e.target.value)}
                              placeholder="Ej: Venta, pérdida, consumo..."
                              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" />
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="flex gap-3">
                  <button onClick={closeModal} className="flex-1 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold py-2.5 rounded-xl">Cancelar</button>
                  <button onClick={() => rebajeMutation.mutate()}
                    disabled={!selectedProduct || !rebajeLinea || rebajeMutation.isPending}
                    className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50">
                    {rebajeMutation.isPending ? 'Guardando...' : 'Confirmar rebaje'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {movScannerOpen && (
            <BarcodeScanner
              title="Escanear producto"
              onDetected={handleBarcodeScan}
              onClose={() => setMovScannerOpen(false)}
            />
          )}
          </>
          )} {/* end masivo ternary */}
        </>
      )}

      {/* ════════════════════════ TAB: INVENTARIO (LPNs) ════════════════════ */}
      {tab === 'inventario' && (
        <>
          {stockCritico > 0 && (
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
              onClick={() => setFilterAlerta(!filterAlerta)}>
              <AlertTriangle size={18} className="text-red-500" />
              <p className="text-red-700 dark:text-red-400 text-sm font-medium">
                {stockCritico} producto{stockCritico !== 1 ? 's' : ''} con stock crítico
                {filterAlerta ? ' — click para ver todos' : ' — click para filtrar'}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input type="text" value={invSearch} onChange={e => setInvSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU, código, ubicación o LPN..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <button onClick={() => setInvScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>

          {/* Filtros avanzados */}
          <div className="flex flex-wrap gap-2">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <option value="">Todas las categorías</option>
              <option value="__sin__">Sin categoría</option>
              {[...new Map((productos as any[]).filter(p => p.categoria_id).map(p => [p.categoria_id, (p as any).categorias?.nombre ?? p.categoria_id])).entries()].map(([id, nombre]) => (
                <option key={id} value={id}>{nombre}</option>
              ))}
            </select>
            <select value={filterUbic} onChange={e => setFilterUbic(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <option value="">Todas las ubicaciones</option>
              <option value="__sin__">Sin ubicación</option>
              {(ubicaciones as any[]).map((u: any) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <option value="">Todos los estados</option>
              <option value="__sin__">Sin estado</option>
              {(estados as any[]).map((e: any) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
            <select value={filterProv} onChange={e => setFilterProv(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-accent bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              <option value="">Todos los proveedores</option>
              <option value="__sin__">Sin proveedor</option>
              {(proveedores as any[]).map((pr: any) => (
                <option key={pr.id} value={pr.id}>{pr.nombre}</option>
              ))}
            </select>
            {(filterCat || filterUbic || filterEstado || filterProv) && (
              <button onClick={() => { setFilterCat(''); setFilterUbic(''); setFilterEstado(''); setFilterProv('') }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg">
                × Limpiar filtros
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {(invLoading || lineasLoading) ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : invVista === 'ubicacion' ? (() => {
              const search = invSearch.toLowerCase()
              const ubicKeys = Object.keys(ubicacionLineasMap)
              .filter(key => {
                const lineas = ubicacionLineasMap[key]
                const ubicNombre = key === '__sin_ubicacion__' ? 'Sin ubicación' : (lineas[0]?.ubicaciones?.nombre ?? '')
                if (!search) return true
                if (ubicNombre.toLowerCase().includes(search)) return true
                return lineas.some((l: any) => {
                  const prod = l.productos as any
                  return prod?.nombre?.toLowerCase().includes(search)
                    || prod?.sku?.toLowerCase().includes(search)
                    || (l.lpn ?? '').toLowerCase().includes(search)
                    || ((l as any).codigo_barras ?? '') === invSearch
                })
              })
              .sort((a, b) => {
                if (a === '__sin_ubicacion__') return -1
                if (b === '__sin_ubicacion__') return 1
                const nA = (ubicacionLineasMap[a][0]?.ubicaciones?.nombre ?? '').toLowerCase()
                const nB = (ubicacionLineasMap[b][0]?.ubicaciones?.nombre ?? '').toLowerCase()
                return nA.localeCompare(nB, 'es')
              })
              if (ubicKeys.length === 0) return (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                  <Building size={40} className="mb-3 opacity-50" />
                  <p className="font-medium">{search ? 'No se encontraron ubicaciones' : 'Sin datos de inventario'}</p>
                </div>
              )
              return (
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {ubicKeys.map(key => {
                    const lineas = ubicacionLineasMap[key]
                    const isExpUbic = expandedId === key
                    const ubicNombre = key === '__sin_ubicacion__' ? 'Sin ubicación' : (lineas[0]?.ubicaciones?.nombre ?? key)
                    const totalCantidad = lineas.reduce((s: number, l: any) => s + (l.cantidad ?? 0), 0)
                    const totalDisponible = lineas.reduce((s: number, l: any) => s + ((l.cantidad ?? 0) - (l.cantidad_reservada ?? 0)), 0)
                    return (
                      <div key={key}>
                        <div className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${isExpUbic ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          onClick={() => setExpandedId(isExpUbic ? null : key)}>
                          <div className="w-5 flex-shrink-0 text-gray-400 dark:text-gray-500">
                            {isExpUbic ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Building size={15} className={key === '__sin_ubicacion__' ? 'text-gray-400' : 'text-blue-500'} />
                            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{ubicNombre}</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">({lineas.length} línea{lineas.length !== 1 ? 's' : ''})</span>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{totalCantidad} u.</p>
                            {totalDisponible !== totalCantidad && (
                              <p className="text-xs text-amber-500">{totalDisponible} disp.</p>
                            )}
                          </div>
                        </div>
                        {isExpUbic && (
                          <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/50">
                            {lineas.map((l: any) => {
                              const prod = l.productos as any
                              const disponible = (l.cantidad ?? 0) - (l.cantidad_reservada ?? 0)
                              return (
                                <div key={l.id} className="px-6 py-3 flex items-start gap-3 bg-gray-50/50 dark:bg-gray-800/50">
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm text-gray-900 dark:text-white">{prod?.nombre ?? l.producto_id}</span>
                                      <span className="text-xs text-gray-400 dark:text-gray-500">{prod?.sku}</span>
                                      {l.lpn && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{l.lpn}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap text-xs">
                                      {l.estados_inventario && (
                                        <span className="px-1.5 py-0.5 rounded text-white text-xs font-medium" style={{ backgroundColor: l.estados_inventario.color ?? '#6b7280' }}>{l.estados_inventario.nombre}</span>
                                      )}
                                      {l.nro_lote && <span className="text-gray-500 dark:text-gray-400">Lote: {l.nro_lote}</span>}
                                      {l.fecha_vencimiento && <span className="text-gray-500 dark:text-gray-400">Vto: {new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}</span>}
                                      {(l.cantidad_reservada ?? 0) > 0 && (
                                        <span className="text-amber-500">{disponible} disp. ({l.cantidad_reservada} reserv.)</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{l.cantidad} {prod?.unidad_medida}</p>
                                  </div>
                                  <button
                                    onClick={e => { e.stopPropagation(); setLpnAcciones({ linea: l, producto: prod }) }}
                                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors flex-shrink-0"
                                    title="Acciones sobre este LPN">
                                    <Settings2 size={15} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })() : filteredInv.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="font-medium">{invSearch ? 'No se encontraron productos' : 'No hay productos aún'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {filteredInv.map(p => {
                  const lineas = lineasMap[p.id] ?? []
                  const stockTotal = getStockTotal(p)
                  const stockDisp = getStockDisponible(p)
                  const critico = stockDisp <= (p as any).stock_minimo
                  const expanded = expandedId === p.id
                  const tieneSerieProd = (p as any).tiene_series

                  return (
                    <div key={p.id}>
                      <div
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${expanded ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                      >
                        <div className="w-5 flex-shrink-0 text-gray-400 dark:text-gray-500">
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>

                        {(p as any).imagen_url ? (
                          <img src={(p as any).imagen_url} alt={p.nombre} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package size={16} className="text-gray-400 dark:text-gray-500" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{(p as any).sku}</p>
                        </div>

                        <div className="hidden md:block text-xs text-gray-400 dark:text-gray-500">
                          {(p as any).categorias?.nombre ?? '—'}
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                            ${critico ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                            {critico && <AlertTriangle size={11} />}
                            {stockDisp} {(p as any).unidad_medida}
                          </span>
                          {stockTotal !== stockDisp && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded mt-0.5">
                              {stockTotal} total
                            </p>
                          )}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{lineas.length} línea{lineas.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>

                      {/* Líneas expandidas */}
                      {expanded && (
                        <div className="bg-gray-50 dark:bg-gray-700 border-t border-gray-100 dark:border-gray-600 px-4 py-3">
                          {lineas.length === 0 ? (
                            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">Sin líneas de inventario. Registrá un ingreso para este producto.</p>
                          ) : (
                            <div className="overflow-x-auto -mx-4 px-4">
                            <div className="space-y-2 min-w-[680px]">
                              <div className="grid grid-cols-8 gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 mb-1">
                                <span className="col-span-1 flex items-center">
                                  <input type="checkbox" className="rounded accent-accent"
                                    title="Seleccionar todos"
                                    checked={lineas.length > 0 && lineas.every((l: any) => selectedLineas.includes(l.id))}
                                    onChange={e => {
                                      if (e.target.checked) {
                                        const otroProducto = selectedLineasInfo.some(x => x.producto_id !== p.id)
                                        if (otroProducto) { toast.error('Ya hay LPNs de otro producto seleccionados'); return }
                                        setSelectedLineas(prev => [...new Set([...prev, ...lineas.map((l: any) => l.id)])])
                                        setSelectedLineasInfo(prev => {
                                          const existing = new Set(prev.map(x => x.id))
                                          return [...prev, ...lineas.filter((l: any) => !existing.has(l.id)).map((l: any) => ({ id: l.id, lpn: l.lpn, cantidad: l.cantidad, producto_id: l.producto_id, nro_lote: l.nro_lote, fecha_vencimiento: l.fecha_vencimiento }))]
                                        })
                                      } else {
                                        const ids = new Set(lineas.map((l: any) => l.id))
                                        setSelectedLineas(prev => prev.filter(id => !ids.has(id)))
                                        setSelectedLineasInfo(prev => prev.filter(x => !ids.has(x.id)))
                                      }
                                    }}
                                  />
                                </span>
                                <span className="col-span-1">LPN</span>
                                <span className="col-span-1 text-right">Cantidad</span>
                                <span className="col-span-1">Estado</span>
                                <span className="col-span-1">Ubicación</span>
                                <span className="col-span-1">Lote / Venc.</span>
                                <span className="col-span-1">Series</span>
                                <span className="col-span-1 text-center">Acciones</span>
                              </div>
                              {lineas.map((l: any) => (
                                <div key={l.id} className={`bg-white dark:bg-gray-800 rounded-xl border px-3 py-2.5 grid grid-cols-8 gap-2 items-center text-sm transition-colors
                                  ${selectedLineas.includes(l.id) ? 'border-accent/50 bg-accent/5 dark:bg-accent/10' : 'border-gray-100 dark:border-gray-700'}`}>
                                  <div className="col-span-1 flex items-center">
                                    <input type="checkbox" className="rounded accent-accent"
                                      checked={selectedLineas.includes(l.id)}
                                      onChange={e => {
                                        if (e.target.checked) {
                                          setSelectedLineas(prev => [...prev, l.id])
                                          setSelectedLineasInfo(prev => [...prev, { id: l.id, lpn: l.lpn, cantidad: l.cantidad, producto_id: l.producto_id, nro_lote: l.nro_lote, fecha_vencimiento: l.fecha_vencimiento }])
                                        } else {
                                          setSelectedLineas(prev => prev.filter(id => id !== l.id))
                                          setSelectedLineasInfo(prev => prev.filter(x => x.id !== l.id))
                                        }
                                      }}
                                    />
                                  </div>
                                  <div className="col-span-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs text-primary font-semibold">{l.lpn}</span>
                                      {(l.ubicaciones?.prioridad ?? 0) > 0 && (
                                        <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-500 px-1 rounded" title="Prioridad de la ubicación">P{l.ubicaciones.prioridad}</span>
                                      )}
                                    </div>
                                    {l.parent_lpn_id && (
                                      <p className="text-xs text-purple-500 dark:text-purple-400">↳ {l.parent_lpn_id}</p>
                                    )}
                                    {l.proveedor_id && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{l.proveedores?.nombre}</p>}
                                  </div>

                                  <div className="col-span-1 text-right">
                                    {tieneSerieProd ? (
                                      <div>
                                        <span className="font-semibold text-gray-800 dark:text-gray-100">
                                          {(l.inventario_series ?? []).filter((s: any) => s.activo).length} u.
                                        </span>
                                        {(l.inventario_series ?? []).filter((s: any) => s.activo && s.reservado).length > 0 && (
                                          <p className="text-xs text-orange-500 font-medium">
                                            {(l.inventario_series ?? []).filter((s: any) => s.activo && s.reservado).length} reservada(s)
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <div>
                                        <span className="font-semibold text-gray-800 dark:text-gray-100">{l.cantidad} {(p as any).unidad_medida}</span>
                                        {(l.cantidad_reservada ?? 0) > 0 && (
                                          <>
                                            <p className="text-xs text-orange-500 font-medium">{l.cantidad_reservada} reservada(s)</p>
                                            <p className="text-xs text-green-600 dark:text-green-400">{l.cantidad - l.cantidad_reservada} disponible(s)</p>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="col-span-1">
                                    {l.estados_inventario ? (
                                      <span className="inline-block text-xs px-2 py-0.5 rounded-lg border"
                                        style={{ color: l.estados_inventario.color ?? '#6b7280', borderColor: l.estados_inventario.color ?? '#d1d5db', fontWeight: 500 }}>
                                        {l.estados_inventario.nombre}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-300">—</span>
                                    )}
                                  </div>

                                  <div className="col-span-1">
                                    {l.ubicaciones?.nombre ? (
                                      <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                                        <MapPin size={11} /> {l.ubicaciones.nombre}
                                      </span>
                                    ) : <span className="text-xs text-gray-300">—</span>}
                                  </div>

                                  <div className="col-span-1">
                                    {l.nro_lote && (
                                      <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                                        <Tag size={11} /> {l.nro_lote}
                                      </span>
                                    )}
                                    {l.fecha_vencimiento && (
                                      <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(l.fecha_vencimiento).toLocaleDateString('es-AR')}</p>
                                    )}
                                    {!l.nro_lote && !l.fecha_vencimiento && <span className="text-xs text-gray-300">—</span>}
                                  </div>

                                  <div className="col-span-1">
                                    {tieneSerieProd ? (() => {
                                      const seriesActivas = (l.inventario_series ?? []).filter((s: any) => s.activo)
                                      const visible = seriesActivas.slice(0, 5)
                                      const resto = seriesActivas.length - 5
                                      return (
                                        <div className="space-y-0.5">
                                          {visible.map((s: any) => (
                                            <span key={s.id} title={s.reservado ? 'Reservada' : undefined}
                                              className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded
                                                ${s.reservado
                                                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400 line-through opacity-70'
                                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                                              <Hash size={9} />{s.nro_serie}
                                            </span>
                                          ))}
                                          {resto > 0 && (
                                            <button
                                              onClick={e => { e.stopPropagation(); setSeriesModal({ lpn: l.lpn, series: seriesActivas }) }}
                                              className="text-xs text-accent hover:underline font-medium">
                                              +{resto} más
                                            </button>
                                          )}
                                        </div>
                                      )
                                    })() : <span className="text-xs text-gray-300">—</span>}
                                  </div>

                                  <div className="col-span-1 flex justify-center">
                                    <button
                                      onClick={e => { e.stopPropagation(); setLpnAcciones({ linea: l, producto: p }) }}
                                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
                                      title={(l.cantidad_reservada ?? 0) > 0 ? `${l.cantidad_reservada} reservada(s) — solo movimiento parcial disponible` : 'Acciones sobre este LPN'}>
                                      <Settings2 size={15} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {invScannerOpen && (
            <BarcodeScanner
              title="Buscar producto"
              onDetected={code => { setInvSearch(code); setInvScannerOpen(false) }}
              onClose={() => setInvScannerOpen(false)}
            />
          )}

          {/* Barra flotante — LPNs seleccionados */}
          {selectedLineas.length >= 1 && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 border border-accent/40 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap max-w-[90vw]">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100 flex-shrink-0">
                <span className="font-bold text-accent">{selectedLineas.length}</span> LPN{selectedLineas.length !== 1 ? 's' : ''} seleccionado{selectedLineas.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => { setSelectedLineas([]); setSelectedLineasInfo([]) }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded transition-colors flex-shrink-0">
                Limpiar
              </button>
              <div className="h-4 w-px bg-gray-200 dark:bg-gray-600 flex-shrink-0" />
              <button
                onClick={() => { setBulkEstadoId(''); setShowBulkEstado(true) }}
                className="text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex-shrink-0">
                Cambiar estado
              </button>
              <button
                onClick={() => { setBulkUbicacionId(''); setShowBulkUbicacion(true) }}
                className="text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex-shrink-0">
                Cambiar ubicación
              </button>
              <button
                onClick={() => { setShowBulkEditar(true); setBulkEditForm({ sucursal_id: '', nro_lote: '', fecha_vencimiento: '', proveedor_id: '' }); setBulkEditCampos({ sucursal: false, lote: false, vencimiento: false, proveedor: false }) }}
                className="text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors flex-shrink-0">
                Editar atributos
              </button>
              {selectedLineas.length >= 2 && selectedLineasInfo.every(l => l.producto_id === selectedLineasInfo[0]?.producto_id) && (
                <button
                  onClick={() => { setCombinarDestinoId(''); setCombinarMode('fusionar'); setShowCombinarModal(true) }}
                  className="bg-accent text-white text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 hover:bg-accent/90 transition-colors flex-shrink-0">
                  <Combine size={14} /> Combinar
                </button>
              )}
            </div>
          )}

          {/* Modal bulk — cambiar estado */}
          {showBulkEstado && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
                <h3 className="font-semibold text-primary">Cambiar estado — {selectedLineas.length} LPN{selectedLineas.length !== 1 ? 's' : ''}</h3>
                <select value={bulkEstadoId} onChange={e => setBulkEstadoId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                  <option value="">Seleccioná un estado</option>
                  {(estados as any[]).map((e: any) => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={() => setShowBulkEstado(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm font-medium">
                    Cancelar
                  </button>
                  <button onClick={() => bulkCambiarEstado.mutate(bulkEstadoId)}
                    disabled={!bulkEstadoId || bulkCambiarEstado.isPending}
                    className="flex-1 bg-accent text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {bulkCambiarEstado.isPending ? 'Actualizando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal bulk — cambiar ubicación */}
          {showBulkUbicacion && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
                <h3 className="font-semibold text-primary">Cambiar ubicación — {selectedLineas.length} LPN{selectedLineas.length !== 1 ? 's' : ''}</h3>
                <select value={bulkUbicacionId} onChange={e => setBulkUbicacionId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent">
                  <option value="">Seleccioná una ubicación</option>
                  {(ubicaciones as any[]).map((u: any) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={() => setShowBulkUbicacion(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm font-medium">
                    Cancelar
                  </button>
                  <button onClick={() => bulkCambiarUbicacion.mutate(bulkUbicacionId)}
                    disabled={!bulkUbicacionId || bulkCambiarUbicacion.isPending}
                    className="flex-1 bg-accent text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {bulkCambiarUbicacion.isPending ? 'Actualizando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal bulk — editar atributos (sucursal, lote, vencimiento, proveedor) */}
          {showBulkEditar && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <div>
                    <h3 className="font-semibold text-primary">Editar atributos — {selectedLineas.length} LPN{selectedLineas.length !== 1 ? 's' : ''}</h3>
                    <p className="text-xs text-muted mt-0.5">Tildá los campos que querés cambiar</p>
                  </div>
                  <button onClick={() => setShowBulkEditar(false)} className="text-muted hover:text-primary"><X size={18} /></button>
                </div>
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {user?.rol === 'DEPOSITO' && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-400">
                      Como DEPOSITO, el cambio quedará pendiente de aprobación por el Dueño o Supervisor.
                    </div>
                  )}

                  {/* Sucursal */}
                  {sucursales.length > 1 && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={bulkEditCampos.sucursal}
                        onChange={e => setBulkEditCampos(p => ({ ...p, sucursal: e.target.checked }))}
                        className="mt-2.5 accent-violet-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-primary mb-1">Sucursal</p>
                        <select
                          disabled={!bulkEditCampos.sucursal}
                          value={bulkEditForm.sucursal_id}
                          onChange={e => setBulkEditForm(p => ({ ...p, sucursal_id: e.target.value }))}
                          className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary disabled:opacity-40">
                          <option value="">Sin sucursal</option>
                          {(sucursales as any[]).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                      </div>
                    </label>
                  )}

                  {/* Proveedor */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bulkEditCampos.proveedor}
                      onChange={e => setBulkEditCampos(p => ({ ...p, proveedor: e.target.checked }))}
                      className="mt-2.5 accent-violet-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-primary mb-1">Proveedor</p>
                      <select
                        disabled={!bulkEditCampos.proveedor}
                        value={bulkEditForm.proveedor_id}
                        onChange={e => setBulkEditForm(p => ({ ...p, proveedor_id: e.target.value }))}
                        className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary disabled:opacity-40">
                        <option value="">Sin proveedor</option>
                        {(proveedores as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </div>
                  </label>

                  {/* Nro. Lote */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bulkEditCampos.lote}
                      onChange={e => setBulkEditCampos(p => ({ ...p, lote: e.target.checked }))}
                      className="mt-2.5 accent-violet-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-primary mb-1">Nro. de lote</p>
                      <input type="text"
                        disabled={!bulkEditCampos.lote}
                        value={bulkEditForm.nro_lote}
                        onChange={e => setBulkEditForm(p => ({ ...p, nro_lote: e.target.value }))}
                        placeholder="Ej: LOTE-2024-01 (vacío = borrar)"
                        className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary disabled:opacity-40" />
                    </div>
                  </label>

                  {/* Fecha vencimiento */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={bulkEditCampos.vencimiento}
                      onChange={e => setBulkEditCampos(p => ({ ...p, vencimiento: e.target.checked }))}
                      className="mt-2.5 accent-violet-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-primary mb-1">Fecha de vencimiento</p>
                      <input type="date"
                        disabled={!bulkEditCampos.vencimiento}
                        value={bulkEditForm.fecha_vencimiento}
                        onChange={e => setBulkEditForm(p => ({ ...p, fecha_vencimiento: e.target.value }))}
                        className="w-full border border-border-ds rounded-lg px-3 py-2 text-sm bg-page text-primary disabled:opacity-40" />
                    </div>
                  </label>

                  {/* Preview de qué se va a cambiar */}
                  {Object.values(bulkEditCampos).some(Boolean) && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-xs text-muted space-y-0.5">
                      <p className="font-medium text-primary mb-1">Cambios a aplicar en {selectedLineas.length} LPN(s):</p>
                      {bulkEditCampos.sucursal && <p>· Sucursal → {(sucursales as any[]).find(s => s.id === bulkEditForm.sucursal_id)?.nombre ?? 'Sin sucursal'}</p>}
                      {bulkEditCampos.proveedor && <p>· Proveedor → {(proveedores as any[]).find(p => p.id === bulkEditForm.proveedor_id)?.nombre ?? 'Sin proveedor'}</p>}
                      {bulkEditCampos.lote && <p>· Lote → {bulkEditForm.nro_lote.trim() || '(borrar)'}</p>}
                      {bulkEditCampos.vencimiento && <p>· Vencimiento → {bulkEditForm.fecha_vencimiento || '(borrar)'}</p>}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 p-5 border-t border-border-ds">
                  <button onClick={() => setShowBulkEditar(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 py-2.5 rounded-xl text-sm font-medium">
                    Cancelar
                  </button>
                  <button
                    onClick={() => bulkEditarAtributos.mutate()}
                    disabled={!Object.values(bulkEditCampos).some(Boolean) || bulkEditarAtributos.isPending}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {bulkEditarAtributos.isPending ? 'Procesando...'
                      : user?.rol === 'DEPOSITO' ? 'Solicitar aprobación'
                      : 'Aplicar cambios'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Combinar LPNs */}
          {showCombinarModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
              onClick={() => setShowCombinarModal(false)}>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
                  <div>
                    <p className="font-bold text-primary">Combinar LPNs</p>
                    <p className="text-xs text-gray-400 mt-0.5">{selectedLineas.length} LPNs seleccionados</p>
                  </div>
                  <button onClick={() => setShowCombinarModal(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                    <X size={17} className="text-gray-500" />
                  </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1 space-y-4">
                  {/* Lista de LPNs seleccionados */}
                  <div className="space-y-1.5">
                    {selectedLineasInfo.map(l => (
                      <div key={l.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-primary">{l.lpn}</span>
                        <div className="text-right">
                          <span className="text-gray-600 dark:text-gray-400">{l.cantidad} u.</span>
                          {l.nro_lote && <p className="text-xs text-gray-400">Lote: {l.nro_lote}</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Toggle modo */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Modo</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setCombinarMode('fusionar')}
                        className={`p-3 rounded-xl border text-sm font-medium text-left transition-colors
                          ${combinarMode === 'fusionar' ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                        <Combine size={16} className="mb-1.5" />
                        <p>Fusionar</p>
                        <p className="text-xs font-normal mt-0.5 text-gray-400">Todo el stock pasa a un LPN</p>
                      </button>
                      <button onClick={() => setCombinarMode('madre')}
                        className={`p-3 rounded-xl border text-sm font-medium text-left transition-colors
                          ${combinarMode === 'madre' ? 'border-accent bg-accent/10 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                        <Layers size={16} className="mb-1.5" />
                        <p>LPN Madre</p>
                        <p className="text-xs font-normal mt-0.5 text-gray-400">Agrupa bajo un pallet padre</p>
                      </button>
                    </div>
                  </div>

                  {/* Fusionar: elegir destino */}
                  {combinarMode === 'fusionar' && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">LPN destino (recibe todo el stock)</p>
                      {new Set(selectedLineasInfo.map(l => l.producto_id)).size > 1 ? (
                        <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                          Solo podés fusionar LPNs del mismo producto.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {selectedLineasInfo.map(l => (
                            <label key={l.id}
                              className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-colors
                                ${combinarDestinoId === l.id ? 'border-accent bg-accent/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                              <input type="radio" name="destino" value={l.id}
                                checked={combinarDestinoId === l.id}
                                onChange={() => setCombinarDestinoId(l.id)}
                                className="accent-accent" />
                              <span className="flex-1 text-sm font-medium text-primary">{l.lpn}</span>
                              <span className="text-sm text-gray-600 dark:text-gray-400">{l.cantidad} u.</span>
                            </label>
                          ))}
                          {combinarDestinoId && (
                            <p className="text-xs text-gray-500 mt-2 px-1">
                              Stock final en <span className="font-semibold">{selectedLineasInfo.find(l => l.id === combinarDestinoId)?.lpn}</span>:&nbsp;
                              <span className="font-bold text-green-600 dark:text-green-400">
                                {selectedLineasInfo.reduce((s, l) => s + l.cantidad, 0)} u.
                              </span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* LPN Madre: input código padre */}
                  {combinarMode === 'madre' && (
                    <div>
                      <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-2">Código LPN Madre</label>
                      <input type="text" value={combinarParentLpn} onChange={e => setCombinarParentLpn(e.target.value)}
                        placeholder="Ej: PLT-001"
                        className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900 text-primary focus:outline-none focus:border-accent" />
                      <p className="text-xs text-gray-400 mt-1.5">
                        Los LPNs seleccionados quedan asociados a este pallet/contenedor. No mueve stock.
                      </p>
                    </div>
                  )}
                </div>

                <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3 flex-shrink-0">
                  <button onClick={() => setShowCombinarModal(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    Cancelar
                  </button>
                  <button
                    disabled={
                      (combinarMode === 'fusionar' && (!combinarDestinoId || new Set(selectedLineasInfo.map(l => l.producto_id)).size > 1)) ||
                      (combinarMode === 'madre' && !combinarParentLpn.trim()) ||
                      fusionarLineas.isPending || asignarMadre.isPending
                    }
                    onClick={() => combinarMode === 'fusionar' ? fusionarLineas.mutate() : asignarMadre.mutate()}
                    className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent/90 transition-colors">
                    {fusionarLineas.isPending || asignarMadre.isPending ? (
                      <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    ) : (
                      <><Combine size={15} /> {combinarMode === 'fusionar' ? 'Fusionar' : 'Asignar Madre'}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal todas las series de un LPN */}
          {seriesModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
              onClick={() => setSeriesModal(null)}>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm max-h-[80vh] flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
                  <div>
                    <p className="font-bold text-primary text-sm">{seriesModal.lpn}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{seriesModal.series.length} series</p>
                  </div>
                  <button onClick={() => setSeriesModal(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                    <X size={17} className="text-gray-500" />
                  </button>
                </div>
                <div className="overflow-y-auto p-4 flex flex-wrap gap-1.5">
                  {seriesModal.series.map((s: any) => (
                    <span key={s.id} title={s.reservado ? 'Reservada' : undefined}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded
                        ${s.reservado
                          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 line-through opacity-70'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                      <Hash size={9} />{s.nro_serie}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════ TAB: KITS ════════════════════════ */}
      {tab === 'kits' && (
        <>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex gap-3 items-start">
            <Combine size={18} className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-semibold">Kitting</p>
              <p className="mt-0.5 text-blue-700 dark:text-blue-400">Un KIT es un producto armado a partir de otros SKUs. Al ejecutar el kitting, se rebajan los componentes y se ingresa el KIT terminado al stock.</p>
            </div>
          </div>

          {/* Armados en progreso */}
          {kitsEnArmado.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <Clock size={14} /> En Armado ({kitsEnArmado.length})
              </h3>
              {kitsEnArmado.map((log: any) => (
                <div key={log.id} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 truncate">
                      {log.kit?.nombre ?? log.kit_producto_id}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      {log.cantidad_kits} {log.kit?.sku ?? ''} · {new Date(log.created_at).toLocaleDateString('es-AR')}
                    </p>
                    {log.notas && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{log.notas}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => confirmarArmado.mutate(log.id)}
                      disabled={confirmarArmado.isPending}
                      title="Confirmar armado — rebaja componentes e ingresa KIT"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-all">
                      <Check size={12} /> Confirmar
                    </button>
                    <button
                      onClick={() => cancelarArmado.mutate(log.id)}
                      disabled={cancelarArmado.isPending}
                      title="Cancelar armado — libera componentes reservados"
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-xs font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-all">
                      <X size={12} /> Cancelar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Buscador + botón nuevo KIT */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={kitSearch} onChange={e => setKitSearch(e.target.value)}
                placeholder="Buscar KIT por nombre o SKU..."
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30" />
            </div>
          </div>

          {/* Lista de KITs */}
          {kitsProductos.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400">
              <Combine size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay KITs configurados</p>
              <p className="text-sm mt-1">Marcá un producto como KIT desde <Link to="/productos" className="text-accent hover:underline">Productos</Link> y configurá su receta aquí.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {kitsProductos.map((kit: any) => {
                const recetas: KitReceta[] = recetasMap[kit.id] ?? []
                const isExpanded = kitExpandedId === kit.id
                // Stock mínimo disponible según recetas (cuántos kits se pueden armar)
                const maxKits = recetas.length === 0 ? 0 : Math.floor(
                  Math.min(...recetas.map(r => kStock(r.comp_producto_id, (r.componente as any)?.stock_actual ?? 0) / r.cantidad))
                )
                return (
                  <div key={kit.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {/* Header del KIT */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button onClick={() => setKitExpandedId(isExpanded ? null : kit.id)}
                        className="flex-1 flex items-center gap-3 text-left">
                        <div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Combine size={16} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{kit.nombre}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{kit.sku} · Stock: {kStock(kit.id, kit.stock_actual)} {kit.unidad_medida}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          {recetas.length > 0 && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${maxKits > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                              {maxKits > 0 ? `Puede armar: ${maxKits}` : 'Sin stock de componentes'}
                            </span>
                          )}
                          {recetas.length === 0 && (
                            <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">Sin receta</span>
                          )}
                          {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                        </div>
                      </button>
                      {/* Botón ejecutar kitting */}
                      <button
                        onClick={() => { setKittingKitId(kit.id); setShowKittingModal(true) }}
                        disabled={recetas.length === 0}
                        title={recetas.length === 0 ? 'Configurá la receta primero' : 'Ejecutar kitting'}
                        className="flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-white px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                        <Play size={13} /> Armar
                      </button>
                      {/* Botón desarmado inverso */}
                      <button
                        onClick={() => { setDesarmarKitId(kit.id); setShowDesarmarModal(true) }}
                        disabled={recetas.length === 0 || kStock(kit.id, kit.stock_actual) <= 0}
                        title={recetas.length === 0 ? 'Sin receta' : kStock(kit.id, kit.stock_actual) <= 0 ? 'Sin stock del KIT para desarmar' : 'Desarmar KIT → devuelve componentes al stock'}
                        className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                        <RotateCcw size={13} /> Desarmar
                      </button>
                      {/* Botón clonar receta */}
                      <button
                        onClick={() => { setClonarOrigenId(kit.id); setClonarDestinoId('') }}
                        disabled={recetas.length === 0}
                        title={recetas.length === 0 ? 'Sin receta para clonar' : 'Clonar receta a otro KIT'}
                        className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                        <Copy size={13} /> Clonar
                      </button>
                    </div>

                    {/* Receta expandida */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Componentes de la receta</p>

                        {recetas.length === 0 ? (
                          <p className="text-sm text-gray-400 italic">Sin componentes. Agregá los ingredientes del KIT.</p>
                        ) : (
                          <div className="space-y-2">
                            {recetas.map(r => {
                              const comp = r.componente as any
                              const stockOk = kStock(r.comp_producto_id, comp?.stock_actual ?? 0) >= r.cantidad
                              return (
                                <div key={r.id} className="flex items-center gap-3 text-sm">
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium text-gray-800 dark:text-gray-200">{comp?.nombre ?? r.comp_producto_id}</span>
                                    <span className="text-gray-400 ml-1 text-xs">{comp?.sku}</span>
                                  </div>
                                  <span className="text-gray-600 dark:text-gray-400 text-xs">× {r.cantidad} {comp?.unidad_medida}</span>
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${stockOk ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                                    Stock: {kStock(r.comp_producto_id, comp?.stock_actual ?? 0)}
                                  </span>
                                  <button onClick={() => eliminarReceta.mutate(r.id)} title="Quitar componente"
                                    className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Form agregar componente */}
                        {showRecetaForm === kit.id ? (
                          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-2">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Agregar componente</p>
                            <div className="flex gap-2">
                              <div className="flex-1 relative">
                                <input value={recetaCompSearch} onChange={e => setRecetaCompSearch(e.target.value)}
                                  placeholder="Buscar producto..."
                                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                                {compsBusqueda.length > 0 && (
                                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                                    {compsBusqueda.map((p: any) => (
                                      <button key={p.id} onClick={() => { setRecetaCompSearch(p.nombre); agregarReceta.mutate({ kitId: kit.id, compId: p.id }) }}
                                        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
                                        <span className="font-medium text-gray-800 dark:text-gray-200">{p.nombre}</span>
                                        <span className="text-gray-400 ml-1 text-xs">{p.sku}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <input value={recetaCantidad} onChange={e => setRecetaCantidad(e.target.value)}
                                type="number" min="0.001" step="0.001" placeholder="Cant."
                                onWheel={e => e.currentTarget.blur()}
                                className="w-20 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                              <button onClick={() => setShowRecetaForm(null)}
                                className="text-gray-400 hover:text-gray-600 px-2">
                                <X size={16} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setShowRecetaForm(kit.id); setRecetaCompSearch(''); setRecetaCantidad('1') }}
                            className="flex items-center gap-1.5 text-accent hover:text-accent/80 text-sm font-medium transition-colors">
                            <Plus size={14} /> Agregar componente
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Modal ejecutar kitting */}
          {showKittingModal && kittingKitId && (() => {
            const kit = kitsProductos.find((k: any) => k.id === kittingKitId)
            const recetas: KitReceta[] = recetasMap[kittingKitId] ?? []
            const cantNum = parseFloat(kittingCantidad) || 0
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
                  <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white">Iniciar Armado</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{kit?.nombre}</p>
                    </div>
                    <button onClick={() => setShowKittingModal(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Cantidad de KITs a armar *</label>
                      <input value={kittingCantidad} onChange={e => setKittingCantidad(e.target.value)}
                        type="number" min="1" step="1"
                        onWheel={e => e.currentTarget.blur()}
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </div>

                    {/* Preview consumo */}
                    {cantNum > 0 && recetas.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Se van a consumir</p>
                        {recetas.map(r => {
                          const comp = r.componente as any
                          const requerido = r.cantidad * cantNum
                          const ok = kStock(r.comp_producto_id, comp?.stock_actual ?? 0) >= requerido
                          return (
                            <div key={r.id} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700 dark:text-gray-300">{comp?.nombre ?? r.comp_producto_id}</span>
                              <span className={`font-medium ${ok ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                                {requerido} {comp?.unidad_medida}
                                {!ok && <span className="ml-1 text-xs">(falta {requerido - kStock(r.comp_producto_id, comp?.stock_actual ?? 0)})</span>}
                              </span>
                            </div>
                          )
                        })}
                        <div className="border-t border-gray-200 dark:border-gray-600 pt-1.5 flex items-center justify-between text-sm font-semibold">
                          <span className="text-gray-700 dark:text-gray-300">KITs producidos</span>
                          <span className="text-accent">+{cantNum} {kit?.unidad_medida}</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Ubicación destino (opcional)</label>
                      <select value={kittingUbicacionId} onChange={e => setKittingUbicacionId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30">
                        <option value="">Sin ubicación</option>
                        {ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas (opcional)</label>
                      <input value={kittingNotas} onChange={e => setKittingNotas(e.target.value)}
                        placeholder="Observaciones del armado..."
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowKittingModal(false)}
                        className="flex-1 px-4 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                        Cancelar
                      </button>
                      <button onClick={() => iniciarArmado.mutate()}
                        disabled={iniciarArmado.isPending || !kittingCantidad || parseFloat(kittingCantidad) <= 0}
                        className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm py-2.5">
                        {iniciarArmado.isPending ? 'Reservando...' : <><Play size={15} /> Iniciar armado</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Modal desarmar KIT */}
          {/* Modal clonar receta KIT */}
          {clonarOrigenId && (() => {
            const origen = kitsProductos.find((k: any) => k.id === clonarOrigenId)
            const destinos = kitsProductos.filter((k: any) => k.id !== clonarOrigenId)
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm">
                  <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Copy size={16} className="text-accent" /> Clonar receta
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Desde: {origen?.nombre}</p>
                    </div>
                    <button onClick={() => setClonarOrigenId(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">KIT destino *</label>
                      <select value={clonarDestinoId} onChange={e => setClonarDestinoId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/30">
                        <option value="">Seleccioná un KIT...</option>
                        {destinos.map((k: any) => (
                          <option key={k.id} value={k.id}>{k.nombre} ({k.sku})</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Los componentes existentes del destino serán reemplazados por los del origen.</p>
                    </div>
                    <div className="flex gap-3 pt-1">
                      <button onClick={() => setClonarOrigenId(null)}
                        className="flex-1 px-4 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                        Cancelar
                      </button>
                      <button onClick={() => clonarKitRecetas.mutate({ origenId: clonarOrigenId, destinoId: clonarDestinoId })}
                        disabled={!clonarDestinoId || clonarKitRecetas.isPending}
                        className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm py-2.5">
                        {clonarKitRecetas.isPending ? 'Clonando...' : <><Copy size={14} /> Clonar</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* ═══════════ TAB: CONTEO ═══════════════════════════════════════════ */}
      {tab === 'conteo' && (
        <div className="space-y-4">
          {showConteoForm ? (
            <div className="space-y-4">
              {/* Encabezado */}
              <div className="flex items-center gap-3">
                <button onClick={resetConteoForm}
                  className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <ChevronLeft size={16} /> Cancelar
                </button>
                <span className="text-sm font-semibold text-primary">
                  {continuandoConteoId ? 'Continuar borrador' : 'Nuevo conteo'}
                </span>
                {continuandoConteoId && (
                  <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full font-medium">
                    Borrador
                  </span>
                )}
              </div>

              {/* Toggle tipo — deshabilitado si se continúa un borrador */}
              <div className="flex gap-2">
                {(['ubicacion', 'producto'] as const).map(t => (
                  <button key={t} onClick={() => { setConteoTipo(t); setConteoRefId(''); setConteoRows([]) }}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border-2
                      ${conteoTipo === t ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                    {t === 'ubicacion' ? '📍 Por ubicación' : '📦 Por producto'}
                  </button>
                ))}
              </div>

              {/* Selector + botón cargar */}
              <div className="flex gap-2">
                <select value={conteoRefId}
                  onChange={e => { setConteoRefId(e.target.value); setConteoRows([]) }}
                  className="flex-1 px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-800 focus:outline-none focus:border-accent">
                  {conteoTipo === 'ubicacion' ? (
                    <>
                      <option value="">Seleccioná una ubicación</option>
                      <option value="__sin__">Sin ubicación</option>
                      {(ubicaciones as any[]).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </>
                  ) : (
                    <>
                      <option value="">Seleccioná un producto</option>
                      {(productosParaConteo as any[]).map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.sku}</option>)}
                    </>
                  )}
                </select>
                <button onClick={cargarLineasParaConteo} disabled={!conteoRefId || conteoLoading}
                  className="px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {conteoLoading ? 'Cargando...' : 'Cargar stock'}
                </button>
              </div>

              {/* Tabla de conteo */}
              {conteoRows.length > 0 && (
                <>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                            <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Producto</th>
                            <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-28">LPN</th>
                            <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-24">Esperado</th>
                            <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-28">Contado</th>
                            <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 w-24">Diferencia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conteoRows.map((row, idx) => {
                            const contada = parseFloat(row.cantidad_contada) || 0
                            const diff = contada - row.cantidad_esperada
                            const sinDiff = Math.abs(diff) < 0.001
                            return (
                              <tr key={row.linea_id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <td className="px-3 py-2.5">
                                  <p className="font-medium text-gray-800 dark:text-gray-100 text-sm">{row.nombre}</p>
                                  <p className="text-xs text-gray-400">{row.sku}{row.unidad_medida ? ` · ${row.unidad_medida}` : ''}</p>
                                </td>
                                <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 font-mono">{row.lpn || '—'}</td>
                                <td className="px-3 py-2.5 text-right text-sm text-gray-600 dark:text-gray-300">{row.cantidad_esperada}</td>
                                <td className="px-3 py-2.5">
                                  <input type="number" min="0" step="0.001"
                                    onWheel={e => e.currentTarget.blur()}
                                    value={row.cantidad_contada}
                                    onChange={e => {
                                      const updated = [...conteoRows]
                                      updated[idx] = { ...row, cantidad_contada: e.target.value }
                                      setConteoRows(updated)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-center focus:outline-none focus:border-accent bg-white dark:bg-gray-700" />
                                </td>
                                <td className={`px-3 py-2.5 text-right text-sm font-semibold
                                  ${sinDiff ? 'text-gray-300 dark:text-gray-600' : diff > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                  {sinDiff ? <Check size={14} className="inline" /> : `${diff > 0 ? '+' : ''}${diff % 1 === 0 ? diff : diff.toFixed(3)}`}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <td colSpan={2} className="px-3 py-2 text-xs text-gray-500">{conteoRows.length} línea{conteoRows.length !== 1 ? 's' : ''}</td>
                            <td className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {conteoRows.reduce((s, r) => s + r.cantidad_esperada, 0)}
                            </td>
                            <td className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {conteoRows.reduce((s, r) => s + (parseFloat(r.cantidad_contada) || 0), 0).toFixed(3).replace(/\.?0+$/, '')}
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold">
                              {(() => {
                                const totalDiff = conteoRows.reduce((s, r) => s + ((parseFloat(r.cantidad_contada) || 0) - r.cantidad_esperada), 0)
                                return <span className={totalDiff === 0 ? 'text-gray-400' : totalDiff > 0 ? 'text-green-600' : 'text-red-500'}>
                                  {totalDiff === 0 ? '✓' : `${totalDiff > 0 ? '+' : ''}${totalDiff % 1 === 0 ? totalDiff : totalDiff.toFixed(3)}`}
                                </span>
                              })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div>
                    <textarea value={conteoNotas} onChange={e => setConteoNotas(e.target.value)}
                      placeholder="Notas del conteo (opcional)..."
                      rows={2}
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800 resize-none" />
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => guardarConteoBorrador.mutate()}
                      disabled={guardarConteoBorrador.isPending}
                      className="flex-1 py-2.5 border-2 border-accent text-accent rounded-xl text-sm font-semibold hover:bg-accent/5 transition-all disabled:opacity-50">
                      {guardarConteoBorrador.isPending ? 'Guardando...' : 'Guardar borrador'}
                    </button>
                    <button onClick={() => finalizarConteoYAplicar.mutate()}
                      disabled={finalizarConteoYAplicar.isPending}
                      className="flex-1 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">
                      {finalizarConteoYAplicar.isPending ? 'Aplicando...' : 'Finalizar y aplicar ajustes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ── HISTORIAL DE CONTEOS ── */
            <div className="space-y-3">
              {conteoHistorial.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <ClipboardList size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No hay conteos registrados</p>
                  <p className="text-xs mt-1">Hacé clic en "Nuevo conteo" para empezar</p>
                </div>
              ) : (
                conteoHistorial.map(c => {
                  const items = c.inventario_conteo_items ?? []
                  const conDiff = items.filter(i => Math.abs(i.cantidad_contada - i.cantidad_esperada) >= 0.001)
                  const isExpanded = conteoExpandedId === c.id
                  return (
                    <div key={c.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button onClick={() => setConteoExpandedId(isExpanded ? null : c.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left">
                        <ClipboardList size={16} className="text-accent flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800 dark:text-gray-100 text-sm">
                              {c.tipo === 'ubicacion'
                                ? `Por ubicación: ${(c as any).ubicaciones?.nombre ?? 'Sin ubicación'}`
                                : `Por producto: ${(c as any).productos?.nombre ?? '—'}`}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                              ${c.estado === 'finalizado' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'}`}>
                              {c.estado === 'finalizado' ? 'Finalizado' : 'Borrador'}
                            </span>
                            {c.ajuste_aplicado && (
                              <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                                Ajustado
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {new Date(c.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                            {(c as any).users?.nombre_display && <span className="ml-1">· {(c as any).users.nombre_display}</span>}
                            {' · '}{items.length} línea{items.length !== 1 ? 's' : ''}
                            {conDiff.length > 0 && <span className="text-red-500 ml-1">· {conDiff.length} con diferencia</span>}
                          </p>
                        </div>
                        {/* ISS-100: acciones para borradores */}
                        {c.estado === 'borrador' && (
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                            <button
                              onClick={e => { e.stopPropagation(); continuarConteo(c) }}
                              className="text-xs px-2 py-1 bg-accent text-white rounded-lg font-medium hover:bg-accent/90 transition-colors">
                              Continuar
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar este borrador?')) eliminarConteo.mutate(c.id) }}
                              disabled={eliminarConteo.isPending}
                              className="text-xs px-2 py-1 border border-red-200 dark:border-red-700 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50">
                              Eliminar
                            </button>
                          </div>
                        )}
                        <ChevronRight size={16} className={`text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>

                      {isExpanded && items.length > 0 && (
                        <div className="border-t border-gray-100 dark:border-gray-700">
                          {c.notas && (
                            <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 italic">{c.notas}</p>
                          )}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs min-w-[480px]">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/50">
                                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Producto</th>
                                  <th className="text-left px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">LPN</th>
                                  <th className="text-right px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Esperado</th>
                                  <th className="text-right px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Contado</th>
                                  <th className="text-right px-3 py-2 text-gray-500 dark:text-gray-400 font-medium">Diferencia</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map(item => {
                                  const diff = item.cantidad_contada - item.cantidad_esperada
                                  const sinDiff = Math.abs(diff) < 0.001
                                  return (
                                    <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                                        {(item as any).productos?.nombre ?? '—'}
                                        <span className="text-gray-400 ml-1">{(item as any).productos?.sku}</span>
                                      </td>
                                      <td className="px-3 py-2 text-gray-400 font-mono">{item.lpn || '—'}</td>
                                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{item.cantidad_esperada}</td>
                                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{item.cantidad_contada}</td>
                                      <td className={`px-3 py-2 text-right font-semibold
                                        ${sinDiff ? 'text-gray-300 dark:text-gray-600' : diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        {sinDiff ? '✓' : `${diff > 0 ? '+' : ''}${diff % 1 === 0 ? diff : diff.toFixed(3)}`}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ TAB: AUTORIZACIONES ═══════════════════════════════════ */}
      {tab === 'autorizaciones' && puedeVerAutorizaciones && (
        <div className="space-y-4">
          {/* Estado selector */}
          <div className="flex gap-2">
            {(['pendiente', 'aprobada', 'rechazada'] as const).map(e => (
              <button key={e} onClick={() => setAutEstado(e)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize
                  ${autEstado === e ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {e === 'pendiente' ? 'Pendientes' : e === 'aprobada' ? 'Aprobadas' : 'Rechazadas'}
              </button>
            ))}
          </div>

          {autLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : autorizaciones.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500">
              <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
              <p>No hay solicitudes {autEstado === 'pendiente' ? 'pendientes' : autEstado === 'aprobada' ? 'aprobadas' : 'rechazadas'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(autorizaciones as any[]).map(aut => {
                const linea = aut.inventario_lineas
                const prod = linea?.productos
                const tipoLabel = aut.tipo === 'ajuste_cantidad' ? 'Ajuste de cantidad'
                  : aut.tipo === 'eliminar_serie' ? 'Eliminar serie'
                  : 'Eliminar LPN'
                const tipoColor = aut.tipo === 'ajuste_cantidad'
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                return (
                  <div key={aut.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipoColor}`}>{tipoLabel}</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                            {prod?.nombre ?? '—'}
                          </span>
                          <span className="text-xs text-gray-400">{prod?.sku}</span>
                        </div>
                        <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                          <p>LPN: <span className="font-mono font-medium">{linea?.lpn ?? '—'}</span></p>
                          {aut.tipo === 'ajuste_cantidad' && (
                            <p>
                              Cantidad: <span className="line-through">{aut.datos_cambio.cantidad_anterior}</span>
                              {' → '}
                              <span className="font-semibold text-orange-600">{aut.datos_cambio.cantidad_nueva}</span>
                              {' '}{prod?.unidad_medida}
                            </p>
                          )}
                          {aut.tipo === 'eliminar_serie' && (
                            <p>Serie: <span className="font-mono">{aut.datos_cambio.nro_serie}</span></p>
                          )}
                          {aut.tipo === 'eliminar_lpn' && (
                            <p>{aut.datos_cambio.cantidad} unidades a eliminar</p>
                          )}
                          <p>Solicitado por: {aut.users?.nombre_display ?? '—'} · {new Date(aut.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                          {aut.notas && <p>Notas: {aut.notas}</p>}
                          {aut.motivo_rechazo && <p className="text-red-500">Motivo rechazo: {aut.motivo_rechazo}</p>}
                        </div>
                      </div>

                      {autEstado === 'pendiente' && (
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <button onClick={() => { if (confirm(`¿Aprobar y ejecutar: ${tipoLabel} en ${linea?.lpn}?`)) aprobarAutorizacion.mutate(aut) }}
                            disabled={aprobarAutorizacion.isPending}
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
                            <CheckCircle2 size={13} /> Aprobar
                          </button>
                          {autRechazoId === aut.id ? (
                            <div className="space-y-1.5">
                              <input type="text" value={autMotivoRechazo} onChange={e => setAutMotivoRechazo(e.target.value)}
                                placeholder="Motivo de rechazo..."
                                className="w-44 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
                              <div className="flex gap-1">
                                <button onClick={() => rechazarAutorizacion.mutate({ id: aut.id, motivo: autMotivoRechazo })}
                                  disabled={rechazarAutorizacion.isPending || !autMotivoRechazo.trim()}
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
                )
              })}
            </div>
          )}
        </div>
      )}

          {showDesarmarModal && desarmarKitId && (() => {
            const kit = kitsProductos.find((k: any) => k.id === desarmarKitId)
            const recetas: KitReceta[] = recetasMap[desarmarKitId] ?? []
            const cantNum = parseFloat(desarmarCantidad) || 0
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
                  <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <RotateCcw size={16} className="text-orange-500" /> Desarmar KIT
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{kit?.nombre} · Stock: {kit ? kStock(kit.id, kit.stock_actual) : 0} {kit?.unidad_medida}</p>
                    </div>
                    <button onClick={() => setShowDesarmarModal(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Cantidad de KITs a desarmar *</label>
                      <input value={desarmarCantidad} onChange={e => setDesarmarCantidad(e.target.value)}
                        type="number" min="1" step="1" max={kit ? kStock(kit.id, kit.stock_actual) : 0}
                        onWheel={e => e.currentTarget.blur()}
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-400/30" />
                    </div>

                    {/* Preview componentes que se van a ingresar */}
                    {cantNum > 0 && recetas.length > 0 && (
                      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">Se van a ingresar al stock</p>
                        {recetas.map(r => {
                          const comp = r.componente as any
                          const ingresa = r.cantidad * cantNum
                          return (
                            <div key={r.id} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700 dark:text-gray-300">{comp?.nombre ?? r.comp_producto_id}</span>
                              <span className="font-semibold text-orange-700 dark:text-orange-400">+{ingresa} {comp?.unidad_medida}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas (opcional)</label>
                      <input value={desarmarNotas} onChange={e => setDesarmarNotas(e.target.value)}
                        placeholder="Motivo del desarmado..."
                        className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-400/30" />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowDesarmarModal(false)}
                        className="flex-1 px-4 py-2.5 border-2 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm">
                        Cancelar
                      </button>
                      <button onClick={() => desarmarKit.mutate()}
                        disabled={desarmarKit.isPending || !desarmarCantidad || parseFloat(desarmarCantidad) <= 0}
                        className="flex-1 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm py-2.5">
                        {desarmarKit.isPending ? 'Procesando...' : <><RotateCcw size={15} /> Desarmar</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
    </div>
  )
}
