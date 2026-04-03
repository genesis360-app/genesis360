import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, Search, Plus, Hash, X, Info, Layers, ChevronRight, ChevronDown,
  User, Clock, Package, TrendingDown, TrendingUp, AlertTriangle, Zap, Camera,
  MapPin, Tag, Settings2,
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
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import toast from 'react-hot-toast'
import type { Producto } from '@/lib/supabase'
import { getRebajeSort } from '@/lib/rebajeSort'

type Tab = 'movimientos' | 'inventario'
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

export default function InventarioPage() {
  const { tenant, user } = useAuthStore()
  const { cotizacion: cotizacionNum } = useCotizacion()
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const { limits } = usePlanLimits()
  const { sucursalId, applyFilter } = useSucursalFilter()

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('movimientos')

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

  // ── Inventario tab state ───────────────────────────────────────────────────
  const [invSearch, setInvSearch] = useState('')
  const [filterAlerta, setFilterAlerta] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [invScannerOpen, setInvScannerOpen] = useState(false)
  const [lpnAcciones, setLpnAcciones] = useState<{ linea: any; producto: any } | null>(null)

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
        .select('*, productos(nombre,sku,unidad_medida), users(nombre_display), estados_inventario(nombre,color), inventario_lineas(lpn, nro_lote, fecha_vencimiento, precio_costo_snapshot, ubicaciones(nombre), proveedores(nombre), inventario_series(nro_serie))')
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

  const { data: lineasProducto = [] } = useQuery({
    queryKey: ['lineas-producto', selectedProduct?.id],
    queryFn: async () => {
      const tieneSeries = (selectedProduct as any).tiene_series
      let q = supabase.from('inventario_lineas')
        .select('*, estados_inventario(nombre,color), ubicaciones(nombre,prioridad), inventario_series(id,nro_serie,activo)')
        .eq('producto_id', selectedProduct!.id)
        .eq('activo', true)
        .order('created_at', { ascending: true })
      if (!tieneSeries) q = q.gt('cantidad', 0)
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
    queryKey: ['productos', tenant?.id, invSearch],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('*, categorias(nombre), proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('nombre')
      if (invSearch) q = q.or(`nombre.ilike.%${invSearch}%,sku.ilike.%${invSearch}%,codigo_barras.eq.${invSearch}`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'inventario',
  })

  const { data: lineasMap = {} } = useQuery({
    queryKey: ['inventario_lineas_all', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase
        .from('inventario_lineas')
        .select('*, estados_inventario(nombre,color), ubicaciones(nombre,prioridad), proveedores(nombre), inventario_series(id, nro_serie, activo, reservado)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .order('created_at', { ascending: true })
      q = applyFilter(q)
      const { data, error } = await q
      if (error) throw error
      const map: Record<string, any[]> = {}
      for (const l of data ?? []) {
        if (!map[l.producto_id]) map[l.producto_id] = []
        map[l.producto_id].push(l)
      }
      return map
    },
    enabled: !!tenant && tab === 'inventario',
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
      const tieneSeries = (selectedProduct as any).tiene_series
      const tieneLote = (selectedProduct as any).tiene_lote
      const tieneVencimiento = (selectedProduct as any).tiene_vencimiento
      const cant = tieneSeries
        ? series.filter(s => s.trim()).length
        : parseInt(form.cantidad)
      if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
      if (tieneLote && !form.nroLote.trim()) throw new Error('Este producto requiere número de lote')
      if (tieneVencimiento && !form.fechaVencimiento) throw new Error('Este producto requiere fecha de vencimiento')

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', selectedProduct.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

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

      const { data: prodAntes } = await supabase.from('productos').select('stock_actual').eq('id', selectedProduct.id).single()
      const stockAntes = prodAntes?.stock_actual ?? 0

      if (tieneSeries) {
        if (rebajeSeries.length === 0) throw new Error('Seleccioná al menos una serie')
        const { error: seriesError } = await supabase.from('inventario_series').update({ activo: false }).in('id', rebajeSeries)
        if (seriesError) throw seriesError
        const { count } = await supabase.from('inventario_series').select('id', { count: 'exact', head: true }).eq('linea_id', rebajeLinea.id).eq('activo', true)
        if (count === 0) {
          await supabase.from('inventario_lineas').update({ activo: false }).eq('id', rebajeLinea.id)
        }
      } else {
        const cant = parseInt(rebajeCantidad)
        if (!cant || cant <= 0) throw new Error('Ingresá una cantidad válida')
        if (cant > rebajeLinea.cantidad) throw new Error(`Stock insuficiente en esta línea. Disponible: ${rebajeLinea.cantidad}`)
        const nuevaCant = rebajeLinea.cantidad - cant
        await supabase.from('inventario_lineas').update({ cantidad: nuevaCant, activo: nuevaCant > 0 }).eq('id', rebajeLinea.id)
      }

      const cant = tieneSeries ? rebajeSeries.length : parseInt(rebajeCantidad)
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
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      closeModal()
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
  }

  useModalKeyboard({
    isOpen: modal !== null,
    onClose: closeModal,
    onConfirm: () => {
      if (modal === 'ingreso' && !ingresoMutation.isPending) ingresoMutation.mutate()
      if (modal === 'rebaje' && !rebajeMutation.isPending) rebajeMutation.mutate()
    },
  })

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

  // ── Computed values ────────────────────────────────────────────────────────
  const filteredMov = movimientos.filter(m => {
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

  const filteredInv = productos.filter(p => {
    const stock = getStockTotal(p)
    if (filterAlerta && stock > (p as any).stock_minimo) return false
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
            {tab === 'movimientos' ? 'Registro de ingresos y rebajes' : 'Líneas de stock y LPNs'}
          </p>
        </div>
        {tab === 'movimientos' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModal('ingreso')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              <ArrowDown size={16} /> Ingreso
            </button>
            <button onClick={() => setMasivoModal('ingreso')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Ingreso de múltiples SKUs">
              <ArrowDown size={16} /> Masivo
            </button>
            <button onClick={() => setModal('rebaje')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              <ArrowUp size={16} /> Rebaje
            </button>
            <button onClick={() => setMasivoModal('rebaje')} disabled={limiteAlcanzado}
              className="flex items-center gap-2 border-2 border-accent text-accent px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Rebaje de múltiples SKUs">
              <ArrowUp size={16} /> Masivo
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl w-fit">
        {([
          { id: 'movimientos' as const, label: 'Movimientos' },
          { id: 'inventario' as const, label: 'Inventario' },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === id
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ════════════════════════ TAB: MOVIMIENTOS ════════════════════════ */}
      {tab === 'movimientos' && (
        <>
          {/* Banner uso de movimientos */}
          {limits && limits.max_movimientos !== -1 && (
            <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
              limiteAlcanzado
                ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                : limiteWarning
                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
            }`}>
              {limiteAlcanzado ? <AlertTriangle size={15} className="flex-shrink-0" /> : <Zap size={15} className="flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="font-medium">
                  {limits.movimientos_mes.toLocaleString()} / {limits.max_movimientos.toLocaleString()} movimientos este mes
                </span>
                {limits.addon_movimientos > 0 && (
                  <span className="ml-2 text-xs opacity-70">(incluye {limits.addon_movimientos} extra)</span>
                )}
                <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${limiteAlcanzado ? 'bg-red-500' : limiteWarning ? 'bg-amber-400' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, limits.pct_movimientos)}%` }}
                  />
                </div>
              </div>
              <Link to="/suscripcion" className="flex-shrink-0 text-xs font-medium underline underline-offset-2 hover:opacity-80">
                {limiteAlcanzado ? 'Ampliar límite' : 'Ver plan'}
              </Link>
            </div>
          )}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input type="text" value={movSearch} onChange={e => setMovSearch(e.target.value)}
              placeholder="Buscar por producto o SKU..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
          </div>

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
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Stock prev.</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Stock nuevo</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Motivo</th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMov.map((m: any) => (
                      <tr key={m.id} onClick={() => setMovDetalle(m)}
                        className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                          {new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800 dark:text-gray-100">{m.productos?.nombre}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{m.productos?.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                            ${m.tipo === 'ingreso' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                            {m.tipo === 'ingreso' ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
                            {m.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{m.cantidad}</td>
                        <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500 hidden md:table-cell">{m.stock_antes}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell">{m.stock_despues}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">{m.motivo ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-300"><ChevronRight size={14} /></td>
                      </tr>
                    ))}
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
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{movDetalle.productos?.sku}
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
                              <p className="text-sm text-gray-700 dark:text-gray-300 font-mono">{linea.lpn}</p>
                            </div>
                          )}
                          {linea.nro_lote && (
                            <div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-0.5">Nro. de lote</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300 font-mono">{linea.nro_lote}</p>
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
                              className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 px-2 py-1 rounded-lg font-mono border border-purple-100">
                              {s.nro_serie}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-300 font-mono border-t border-gray-100 pt-3">ID: {movDetalle.id}</p>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">SKU: {selectedProduct.sku} | Stock: {(selectedProduct as any).stock_actual}</p>
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
                    <div className="mb-3">
                      <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        LPN
                        <InfoTip text="LPN (License Plate Number) es el identificador único de cada lote físico de mercadería. Se genera automáticamente si lo dejás vacío." />
                        <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal text-xs">(opcional — se genera automático)</span>
                      </label>
                      <input type="text" value={form.lpn} onChange={e => setForm(p => ({ ...p, lpn: e.target.value }))}
                        placeholder="Ej: LPN-20260101-A1"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:border-accent" />
                    </div>

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
                                  className="w-full pl-8 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-accent" />
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
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Cantidad{(selectedProduct as any)?.unidad_medida && (
                            <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">({(selectedProduct as any).unidad_medida})</span>
                          )}
                        </label>
                        <input type="number" onWheel={e => e.currentTarget.blur()} min="1" value={form.cantidad}
                          onChange={e => setForm(p => ({ ...p, cantidad: e.target.value }))}
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" placeholder="0" />
                      </div>
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
                        <p className="text-xs text-gray-500 dark:text-gray-400">Stock total: {(selectedProduct as any).stock_actual}</p>
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
                                  <span className="font-mono">{l.lpn}</span>
                                  {(l.ubicaciones?.prioridad ?? 0) > 0 && (
                                    <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-500 px-1 rounded font-mono">P{l.ubicaciones.prioridad}</span>
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
                                  <span className="font-mono text-sm">{s.nro_serie}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Cantidad a rebajar (disponible: {rebajeLinea.cantidad})
                            </label>
                            <input type="number" onWheel={e => e.currentTarget.blur()} min="1" max={rebajeLinea.cantidad}
                              value={rebajeCantidad} onChange={e => setRebajeCantidad(e.target.value)}
                              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent" placeholder="0" />
                          </div>
                        )}

                        <div className="mb-5">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
                          {motivos.filter((m: any) => m.tipo === 'rebaje' || m.tipo === 'ambos').length > 0 ? (
                            <div className="space-y-2">
                              <select value={rebajeMotivoSelect}
                                onChange={e => {
                                  const val = e.target.value
                                  setRebajeMotivoSelect(val)
                                  setRebajeMotivo(val === '__otro__' ? '' : val)
                                }}
                                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent">
                                <option value="">Seleccioná un motivo...</option>
                                {(motivos as any[]).filter((m: any) => m.tipo === 'rebaje' || m.tipo === 'ambos')
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
                placeholder="Buscar por nombre, SKU o código..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-800" />
            </div>
            <button onClick={() => setInvScannerOpen(true)}
              className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-accent transition-colors bg-white dark:bg-gray-800"
              title="Escanear código de barras">
              <Camera size={17} />
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {invLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredInv.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="font-medium">{invSearch ? 'No se encontraron productos' : 'No hay productos aún'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {filteredInv.map(p => {
                  const lineas = lineasMap[p.id] ?? []
                  const stockTotal = getStockTotal(p)
                  const critico = stockTotal <= (p as any).stock_minimo
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
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{(p as any).sku}</p>
                        </div>

                        <div className="hidden md:block text-xs text-gray-400 dark:text-gray-500">
                          {(p as any).categorias?.nombre ?? '—'}
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-lg text-xs
                            ${critico ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                            {critico && <AlertTriangle size={11} />}
                            {stockTotal} {(p as any).unidad_medida}
                          </span>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{lineas.length} línea{lineas.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>

                      {/* Líneas expandidas */}
                      {expanded && (
                        <div className="bg-gray-50 dark:bg-gray-700 border-t border-gray-100 dark:border-gray-600 px-4 py-3">
                          {lineas.length === 0 ? (
                            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">Sin líneas de inventario. Registrá un ingreso para este producto.</p>
                          ) : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 mb-1">
                                <span className="col-span-1">LPN</span>
                                <span className="col-span-1 text-right">Cantidad</span>
                                <span className="col-span-1">Estado</span>
                                <span className="col-span-1">Ubicación</span>
                                <span className="col-span-1">Lote / Venc.</span>
                                <span className="col-span-1">Series</span>
                                <span className="col-span-1 text-center">Acciones</span>
                              </div>
                              {lineas.map((l: any) => (
                                <div key={l.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-3 py-2.5 grid grid-cols-7 gap-2 items-center text-sm">
                                  <div className="col-span-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-xs text-primary font-semibold">{l.lpn}</span>
                                      {(l.ubicaciones?.prioridad ?? 0) > 0 && (
                                        <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-500 px-1 rounded font-mono" title="Prioridad de la ubicación">P{l.ubicaciones.prioridad}</span>
                                      )}
                                    </div>
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
                                    <select
                                      value={l.estado_id ?? ''}
                                      onChange={e => cambiarEstadoLinea.mutate({ lineaId: l.id, estadoId: e.target.value })}
                                      className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 w-full focus:outline-none focus:border-accent bg-white dark:bg-gray-800"
                                      style={{ color: l.estados_inventario?.color ?? '#6b7280', fontWeight: 500 }}
                                    >
                                      <option value="">Sin estado</option>
                                      {(estados as any[]).map(e => (
                                        <option key={e.id} value={e.id}>{e.nombre}</option>
                                      ))}
                                    </select>
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
                                    {tieneSerieProd ? (
                                      <div className="space-y-0.5">
                                        {(l.inventario_series ?? []).filter((s: any) => s.activo).map((s: any) => (
                                          <span key={s.id} className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">
                                            <Hash size={9} />{s.nro_serie}
                                          </span>
                                        ))}
                                      </div>
                                    ) : <span className="text-xs text-gray-300">—</span>}
                                  </div>

                                  <div className="col-span-1 flex justify-center">
                                    <button
                                      onClick={e => { e.stopPropagation(); setLpnAcciones({ linea: l, producto: p }) }}
                                      className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
                                      title="Acciones sobre este LPN">
                                      <Settings2 size={15} />
                                    </button>
                                  </div>
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
            )}
          </div>

          {invScannerOpen && (
            <BarcodeScanner
              title="Buscar producto"
              onDetected={code => { setInvSearch(code); setInvScannerOpen(false) }}
              onClose={() => setInvScannerOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
