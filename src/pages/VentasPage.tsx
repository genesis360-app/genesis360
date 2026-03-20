import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, ShoppingCart, Package, Truck, X, Hash, Percent, CreditCard, User, FileText, Zap, DollarSign, Printer, Layers, Camera, Scissors, Gift } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useGruposEstados } from '@/hooks/useGruposEstados'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import toast from 'react-hot-toast'

type EstadoVenta = 'pendiente' | 'reservada' | 'despachada' | 'cancelada' | 'facturada'
type Tab = 'nueva' | 'historial'
type DescTipo = 'pct' | 'monto'
type MedioPagoItem = { tipo: string; monto: string }

const ESTADOS: Record<EstadoVenta, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-yellow-700', bg: 'bg-yellow-100' },
  reservada:  { label: 'Reservada',  color: 'text-blue-700',   bg: 'bg-blue-100'   },
  despachada: { label: 'Despachada', color: 'text-green-700',  bg: 'bg-green-100'  },
  cancelada:  { label: 'Cancelada',  color: 'text-red-700',    bg: 'bg-red-100'    },
  facturada:  { label: 'Facturada',  color: 'text-purple-700', bg: 'bg-purple-100' },
}

const MEDIOS_PAGO = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia', 'Mercado Pago', 'Otro']

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
  linea_id?: string
  series_seleccionadas: string[]
  series_disponibles: any[]
}

export default function VentasPage() {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const { grupos, grupoDefault, estadosDefault } = useGruposEstados()
  const [tab, setTab] = useState<Tab>('nueva')
  const [ventaGrupoId, setVentaGrupoId] = useState<string | null>(null)

  // Nueva venta
  const [cart, setCart] = useState<CartItem[]>([])
  const [productoSearch, setProductoSearch] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [clienteSearch, setClienteSearch] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteDropOpen, setClienteDropOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [mediosPago, setMediosPago] = useState<MedioPagoItem[]>([{ tipo: '', monto: '' }])
  const [descuentoTotal, setDescuentoTotal] = useState('')
  const [descuentoTotalTipo, setDescuentoTotalTipo] = useState<DescTipo>('pct')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [ticketVenta, setTicketVenta] = useState<any | null>(null)

  // Historial
  const [searchHistorial, setSearchHistorial] = useState('')
  const [filterEstado, setFilterEstado] = useState<EstadoVenta | ''>('')
  const [ventaDetalle, setVentaDetalle] = useState<any | null>(null)

  // Modal series
  const [seriesModal, setSeriesModal] = useState<{ itemIdx: number; lineas: any[] } | null>(null)

  // Foco en buscador de productos
  const [searchFocused, setSearchFocused] = useState(false)

  const { data: productosBusqueda = [] } = useQuery({
    queryKey: ['productos-venta', tenant?.id, productoSearch, ventaGrupoId],
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
        .select('id, nombre, sku, precio_venta, precio_costo, tiene_series, stock_actual, unidad_medida')
        .eq('tenant_id', tenant!.id).eq('activo', true)
        .order('nombre')
        .limit(20)
      if (productoSearch.length > 0)
        prodQuery = prodQuery.or(`nombre.ilike.%${productoSearch}%,sku.ilike.%${productoSearch}%`)
      const { data: prods } = await prodQuery

      if (!prods || prods.length === 0) return []

      // Calcular stock disponible por producto según el grupo activo
      const productoIds = prods.map((p: any) => p.id)

      // Traer líneas activas de estos productos
      let lineasQuery = supabase.from('inventario_lineas')
        .select('producto_id, cantidad, cantidad_reservada, estado_id, inventario_series(id, activo, reservado)')
        .eq('tenant_id', tenant!.id)
        .eq('activo', true)
        .in('producto_id', productoIds)

      // Si hay filtro de grupo, filtrar por estado
      if (estadosFiltro.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFiltro)
      }

      const { data: lineas } = await lineasQuery

      // Calcular stock disponible por producto (excluyendo reservados)
      const stockMap: Record<string, number> = {}
      for (const linea of lineas ?? []) {
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
      let q = supabase.from('clientes').select('id, nombre, telefono')
        .eq('tenant_id', tenant!.id).order('nombre').limit(10)
      if (clienteSearch) q = q.ilike('nombre', `%${clienteSearch}%`)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant && clienteDropOpen,
  })

  const { data: ventas = [], isLoading: loadingVentas } = useQuery({
    queryKey: ['ventas', tenant?.id, filterEstado],
    queryFn: async () => {
      let q = supabase.from('ventas').select('*, venta_items(id, cantidad, precio_unitario, descuento, subtotal, productos(nombre,sku))')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false })
      if (filterEstado) q = q.eq('estado', filterEstado)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant && tab === 'historial',
  })

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
        .select('id, lpn, estado_id, inventario_series(id, nro_serie, activo, reservado)')
        .eq('producto_id', p.id).eq('activo', true)

      if (estadosFiltro.length > 0) {
        lineasQuery = lineasQuery.in('estado_id', estadosFiltro)
      }

      const { data: lineas } = await lineasQuery
      seriesDisp = (lineas ?? []).flatMap((l: any) =>
        (l.inventario_series ?? [])
          .filter((s: any) => s.activo && !s.reservado)
          .map((s: any) => ({ ...s, lpn: l.lpn, linea_id: l.id }))
      )
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
      series_seleccionadas: [],
      series_disponibles: seriesDisp,
    }
    setCart(prev => [...prev, newItem])
  }

  const handleBarcodeScan = async (code: string) => {
    setScannerOpen(false)
    // Buscar por codigo_barras o SKU exacto
    const { data: prods } = await supabase.from('productos')
      .select('id, nombre, sku, precio_venta, precio_costo, tiene_series, stock_actual, unidad_medida, codigo_barras')
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
    setCart(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const removeItem = (idx: number) => setCart(prev => prev.filter((_, i) => i !== idx))

  const { data: combosDisp = [] } = useQuery({
    queryKey: ['combos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('combos')
        .select('id, nombre, producto_id, cantidad, descuento_pct')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const findCombo = (productoId: string, cantidad: number, descActual: number) => {
    return (combosDisp as any[])
      .filter(c => c.producto_id === productoId && cantidad >= c.cantidad && descActual !== c.descuento_pct)
      .sort((a, b) => b.cantidad - a.cantidad)[0] ?? null
  }

  const aplicarCombo = (idx: number, combo: any) => {
    const item = cart[idx]
    const comboUnits = Math.floor(item.cantidad / combo.cantidad) * combo.cantidad
    const remainder = item.cantidad % combo.cantidad
    const rows: CartItem[] = []
    if (comboUnits > 0)
      rows.push({ ...item, cantidad: comboUnits, descuento: combo.descuento_pct, descuento_tipo: 'pct' })
    if (remainder > 0)
      rows.push({ ...item, cantidad: remainder, descuento: 0, descuento_tipo: 'pct' })
    setCart(prev => [...prev.slice(0, idx), ...rows, ...prev.slice(idx + 1)])
    toast.success(`Combo aplicado: ${comboUnits} und. con ${combo.descuento_pct}% off${remainder > 0 ? ` + ${remainder} sin descuento` : ''}`)
  }

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
    // Validar medios de pago
    const hayMontos = mediosPago.some(m => m.monto !== '')
    if (hayMontos && Math.abs(totalFaltante) > 0.5) {
      toast.error(
        totalFaltante > 0
          ? `Falta asignar $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en medios de pago`
          : `El monto ingresado excede el total por $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
      )
      return
    }
    // Para reservar o despachar no se puede cobrar de menos
    if ((estado === 'reservada' || estado === 'despachada') && hayMontos && totalFaltante > 0.5) {
      toast.error(`El monto pagado ($${totalAsignado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}) es menor al total. No se puede reservar ni despachar con pago incompleto.`)
      return
    }
    setSaving(true)
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
        notas: notas || null,
        usuario_id: user?.id,
        ...(estado === 'despachada' ? { despachado_at: new Date().toISOString() } : {}),
      }).select().single()
      if (ventaError) throw ventaError

      // Crear items
      for (const item of cart) {
        const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
        const itemSubtotal = getItemSubtotal(item)

        const { data: ventaItem, error: itemError } = await supabase.from('venta_items').insert({
          tenant_id: tenant!.id,
          venta_id: venta.id,
          producto_id: item.producto_id,
          cantidad: cant,
          precio_unitario: item.precio_unitario,
          precio_costo_historico: item.precio_costo || null,
          descuento: item.descuento_tipo === 'pct' ? item.descuento : 0,
          subtotal: itemSubtotal,
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
          if (estado === 'reservada') {
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada').eq('producto_id', item.producto_id)
              .eq('activo', true).gt('cantidad', 0).order('cantidad', { ascending: false })
            let restante = cant
            for (const linea of lineas ?? []) {
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
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada').eq('producto_id', item.producto_id)
              .eq('activo', true).gt('cantidad', 0).order('cantidad', { ascending: false })
            let restante = cant
            for (const linea of lineas ?? []) {
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
            .select('stock_actual').eq('id', item.producto_id).single()
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
            })
          }
        }
      } // cierre del for (const item of cart)

      const msg = estado === 'despachada' ? 'Venta despachada' : estado === 'reservada' ? 'Venta reservada' : 'Venta registrada'
      toast.success(msg)
      setTicketVenta({ ...venta, items: cart.map(i => ({ ...i, subtotal: getItemSubtotal(i) })) })
      setCart([]); setClienteId(null); setClienteSearch(''); setClienteNombre(''); setClienteTelefono('')
      setMediosPago([{ tipo: '', monto: '' }]); setDescuentoTotal(''); setNotas('')
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      setTab('historial')
    } catch (err: any) {
      toast.error(err.message ?? 'Error al registrar la venta')
    } finally {
      setSaving(false)
    }
  }

  const cambiarEstado = useMutation({
    mutationFn: async ({ ventaId, nuevoEstado }: { ventaId: string; nuevoEstado: EstadoVenta }) => {
      const venta = ventas.find((v: any) => v.id === ventaId)
      if (!venta) throw new Error('Venta no encontrada')

      const { data: items } = await supabase.from('venta_items')
        .select('*, venta_series(serie_id), productos(tiene_series)')
        .eq('venta_id', ventaId)

      if (nuevoEstado === 'reservada') {
        // Reservar series y cantidad en líneas
        for (const item of items ?? []) {
          if ((item.productos as any)?.tiene_series) {
            const serieIds = (item.venta_series ?? []).map((s: any) => s.serie_id)
            await supabase.from('inventario_series').update({ reservado: true }).in('id', serieIds)
          } else {
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
              .order('cantidad', { ascending: false })
            let restante = item.cantidad
            for (const linea of lineas ?? []) {
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
            // Rebajar de líneas, priorizando las reservadas
            const { data: lineas } = await supabase.from('inventario_lineas')
              .select('id, cantidad, cantidad_reservada')
              .eq('producto_id', item.producto_id).eq('activo', true).gt('cantidad', 0)
              .order('cantidad_reservada', { ascending: false })
            let restante = item.cantidad
            for (const linea of lineas ?? []) {
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
            })
          }
        }
        await supabase.from('ventas')
          .update({ estado: 'despachada', despachado_at: new Date().toISOString() })
          .eq('id', ventaId)

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

      } else {
        await supabase.from('ventas').update({ estado: nuevoEstado }).eq('id', ventaId)
      }
    },
    onSuccess: () => {
      toast.success('Estado actualizado')
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      qc.invalidateQueries({ queryKey: ['inventario_lineas_all'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['alertas'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      setVentaDetalle(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const filteredVentas = ventas.filter((v: any) => {
    if (!searchHistorial) return true
    const s = searchHistorial.toLowerCase()
    return v.numero?.toString().includes(s) || (v.cliente_nombre ?? '').toLowerCase().includes(s)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Ventas</h1>
          <p className="text-gray-500 text-sm mt-0.5">Registrá y gestioná tus ventas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[{ id: 'nueva', label: 'Nueva venta', icon: Plus }, { id: 'historial', label: 'Historial', icon: FileText }].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`flex items-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all
              ${tab === id ? 'bg-white text-[#1E3A5F] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── NUEVA VENTA ── */}
      {tab === 'nueva' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">

            {/* Buscador de productos */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><ShoppingCart size={16} /> Agregar productos</h2>

              {/* Filtro por grupo */}
              {grupos.length > 0 && (
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <Layers size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-500">Ver stock de:</span>
                  <button onClick={() => setVentaGrupoId('todos')}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all
                      ${ventaGrupoId === 'todos' ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    Todos
                  </button>
                  {grupos.map(g => (
                    <button key={g.id}
                      onClick={() => setVentaGrupoId(ventaGrupoId === g.id ? null : g.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1
                        ${ventaGrupoId === g.id || (ventaGrupoId === null && g.es_default)
                          ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {g.nombre}
                      {g.es_default && ventaGrupoId === null && <span className="text-yellow-300">★</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="relative flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={productoSearch} onChange={e => setProductoSearch(e.target.value)}
                    placeholder="Buscar por nombre, SKU o código..."
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                    className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="px-3 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 hover:text-[#2E75B6] transition-colors flex-shrink-0"
                  title="Escanear código de barras"
                >
                  <Camera size={17} />
                </button>
                {productosBusqueda.length > 0 && searchFocused && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {(productosBusqueda as any[]).map(p => (
                      <button key={p.id} onClick={() => agregarProducto(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0 flex items-center justify-between">
                        <div>
                          <span className="font-medium">{p.nombre}</span>
                          <span className="text-gray-400 ml-2 text-xs font-mono">{p.sku}</span>
                          {p.tiene_series && <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-1 rounded">series</span>}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[#1E3A5F]">${p.precio_venta?.toLocaleString('es-AR')}</p>
                          <p className="text-xs text-gray-400">
                            {p.stock_filtrado
                              ? <span className="text-blue-600 font-medium">{p.stock_disponible} disp. en grupo</span>
                              : `${p.stock_actual} en stock`
                            }
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Carrito */}
            {cart.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h2 className="font-semibold text-gray-700 flex items-center gap-2"><Package size={16} /> {cart.length} producto{cart.length !== 1 ? 's' : ''}</h2>
                </div>
                <div className="divide-y divide-gray-50">
                  {cart.map((item, idx) => (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <p className="font-medium text-gray-800">{item.nombre}</p>
                          <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {!item.tiene_series && item.cantidad > 1 && (
                            <button onClick={() => splitItem(idx)} title="Separar 1 unidad con descuento diferente"
                              className="text-gray-300 hover:text-blue-400 transition-colors">
                              <Scissors size={14} />
                            </button>
                          )}
                          <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-400 transition-colors"><X size={16} /></button>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-2">
                        {/* Cantidad */}
                        {!item.tiene_series && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => updateItem(idx, 'cantidad', Math.max(1, item.cantidad - 1))}
                              className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">−</button>
                            <input
                              type="number" min="1" value={item.cantidad}
                              onChange={e => updateItem(idx, 'cantidad', Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-12 text-center text-sm font-medium border border-gray-200 rounded-lg py-0.5 focus:outline-none focus:border-[#2E75B6]"
                            />
                            <button onClick={() => updateItem(idx, 'cantidad', item.cantidad + 1)}
                              className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">+</button>
                          </div>
                        )}

                        {/* Precio */}
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                          <input type="number" value={item.precio_unitario}
                            onChange={e => updateItem(idx, 'precio_unitario', parseFloat(e.target.value) || 0)}
                            className="w-full pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#2E75B6]" />
                        </div>

                        {/* Descuento con toggle % / $ */}
                        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden w-28">
                          <input type="number" min="0" value={item.descuento}
                            onChange={e => updateItem(idx, 'descuento', parseFloat(e.target.value) || 0)}
                            className="w-full pl-2 pr-1 py-1.5 text-sm focus:outline-none" placeholder="0" />
                          <button onClick={() => updateItem(idx, 'descuento_tipo', item.descuento_tipo === 'pct' ? 'monto' : 'pct')}
                            className="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-bold border-l border-gray-200 transition-colors">
                            {item.descuento_tipo === 'pct' ? '%' : '$'}
                          </button>
                        </div>

                        {/* Subtotal */}
                        <p className="text-sm font-semibold text-[#1E3A5F] w-20 text-right">
                          ${getItemSubtotal(item).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      </div>

                      {/* Sugerencia de combo */}
                      {!item.tiene_series && (() => {
                        const combo = findCombo(item.producto_id, item.cantidad, item.descuento)
                        if (!combo) return null
                        return (
                          <div className="mt-1.5 flex items-center gap-2 text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-1.5 border border-amber-200">
                            <Gift size={12} />
                            <span className="flex-1">Combo: {combo.cantidad}× con {combo.descuento_pct}% off disponible</span>
                            <button onClick={() => aplicarCombo(idx, combo)}
                              className="font-semibold hover:underline text-amber-800">
                              Aplicar
                            </button>
                          </div>
                        )
                      })()}

                      {/* Series */}
                      {item.tiene_series && (
                        <div className="mt-2">
                          <button onClick={() => setSeriesModal({ itemIdx: idx, lineas: item.series_disponibles })}
                            className="flex items-center gap-1.5 text-xs text-[#2E75B6] hover:underline">
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
                                  <span key={sid} className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-mono">{s.nro_serie}</span>
                                ) : null
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Panel lateral */}
          <div className="space-y-4">
            {/* Cliente */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-semibold text-gray-700 flex items-center gap-2"><User size={16} /> Cliente</h2>
              {/* Autocomplete cliente registrado */}
              <div className="relative">
                {clienteId ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 border border-blue-300 bg-blue-50 rounded-xl text-sm">
                    <span className="flex-1 font-medium text-blue-800">{clienteNombre}</span>
                    <button onClick={() => { setClienteId(null); setClienteNombre(''); setClienteTelefono(''); setClienteSearch('') }} className="text-blue-400 hover:text-blue-700"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={clienteSearch}
                      onChange={e => { setClienteSearch(e.target.value); setClienteDropOpen(true) }}
                      onFocus={() => setClienteDropOpen(true)}
                      onBlur={() => setTimeout(() => setClienteDropOpen(false), 150)}
                      placeholder="Buscar cliente registrado..."
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]"
                    />
                    {clienteDropOpen && clientesBusqueda.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
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
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                          >
                            <span className="font-medium">{c.nombre}</span>
                            {c.telefono && <span className="text-gray-400 ml-2">{c.telefono}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Campos manuales (si no hay cliente registrado) */}
              {!clienteId && (
                <>
                  <input type="text" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)}
                    placeholder="Nombre (opcional)"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                  <input type="text" value={clienteTelefono} onChange={e => setClienteTelefono(e.target.value)}
                    placeholder="Teléfono (opcional)"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                </>
              )}
            </div>

            {/* Pago */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <h2 className="font-semibold text-gray-700 flex items-center gap-2"><CreditCard size={16} /> Pago</h2>

              {mediosPago.map((mp, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select value={mp.tipo} onChange={e => updateMedioPago(idx, 'tipo', e.target.value)}
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]">
                    <option value="">Medio de pago...</option>
                    {MEDIOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="number" min="0" value={mp.monto}
                    onChange={e => updateMedioPago(idx, 'monto', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    placeholder="Monto"
                    className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6]" />
                  {mediosPago.length > 1 && (
                    <button onClick={() => removeMedioPago(idx)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}

              <button onClick={addMedioPago}
                className="flex items-center gap-1 text-xs text-[#2E75B6] hover:underline">
                <Plus size={12} /> Agregar otro medio
              </button>

              {cart.length > 0 && totalAsignado > 0 && (
                <p className={`text-xs text-right font-medium ${totalFaltante === 0 ? 'text-green-600' : totalFaltante > 0 ? 'text-orange-500' : 'text-red-500'}`}>
                  {totalFaltante === 0
                    ? '✓ Total cubierto'
                    : totalFaltante > 0
                      ? `Falta asignar: $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                      : `Excede por: $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
                </p>
              )}
              {/* Descuento general con toggle % / $ */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Descuento general</label>
                <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                  <input type="number" min="0" value={descuentoTotal}
                    onChange={e => setDescuentoTotal(e.target.value)}
                    placeholder="0"
                    className="flex-1 px-3 py-2.5 text-sm focus:outline-none" />
                  <button onClick={() => setDescuentoTotalTipo(t => t === 'pct' ? 'monto' : 'pct')}
                    className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-bold border-l border-gray-200 transition-colors min-w-10">
                    {descuentoTotalTipo === 'pct' ? '%' : '$'}
                  </button>
                </div>
              </div>
              <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
                placeholder="Notas (opcional)"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] resize-none" />
            </div>

            {/* Totales */}
            {cart.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-2">
                {/* Subtotal sin descuentos */}
                {(() => {
                  const subtotalSinDesc = cart.reduce((acc, item) => {
                    const cant = item.tiene_series ? item.series_seleccionadas.length : item.cantidad
                    return acc + item.precio_unitario * cant
                  }, 0)
                  const descItemsTotal = subtotalSinDesc - subtotal
                  return (
                    <>
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>Precio lista</span>
                        <span>${subtotalSinDesc.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      {descItemsTotal > 0 && (
                        <div className="flex justify-between text-sm text-blue-600">
                          <span>Desc. por producto</span>
                          <span>−${descItemsTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Subtotal</span>
                        <span>${subtotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </>
                  )
                })()}
                {descTotalMonto > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Desc. general {descuentoTotalTipo === 'pct' ? `(${descTotalVal}%)` : `($${descTotalVal})`}</span>
                    <span>−${descTotalMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-[#1E3A5F] text-lg border-t border-gray-100 pt-2">
                  <span>Total</span>
                  <span>${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>

                <div className="space-y-2 pt-1">
                  <button onClick={() => registrarVenta('reservada')} disabled={saving}
                    className="w-full bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <ShoppingCart size={16} /> {saving ? 'Guardando...' : 'Reservar stock'}
                  </button>
                  <button onClick={() => registrarVenta('despachada')} disabled={saving}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    <Zap size={16} /> Venta directa (despacho inmediato)
                  </button>
                  <button onClick={() => registrarVenta('pendiente')} disabled={saving}
                    className="w-full border-2 border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl hover:border-gray-300 transition-all disabled:opacity-50">
                    Registrar sin reservar
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
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={searchHistorial} onChange={e => setSearchHistorial(e.target.value)}
                placeholder="Buscar por N° o cliente..."
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] bg-white" />
            </div>
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value as EstadoVenta | '')}
              className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#2E75B6] bg-white">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loadingVentas ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1E3A5F]" />
              </div>
            ) : filteredVentas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <ShoppingCart size={40} className="mb-3 opacity-50" />
                <p>No hay ventas registradas</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filteredVentas.map((v: any) => {
                  const est = ESTADOS[v.estado as EstadoVenta]
                  return (
                    <div key={v.id} className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setVentaDetalle(v)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-bold text-[#1E3A5F]">#{v.numero}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>{est.label}</span>
                        </div>
                        <span className="font-bold text-gray-800">${v.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-gray-400">
                        <span>{v.cliente_nombre ?? 'Sin cliente'} {v.medio_pago ? `· ${formatMedioPago(v.medio_pago)}` : ''}</span>
                        <span>{new Date(v.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(v.venta_items ?? []).map((item: any) => (
                          <span key={item.id} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Venta #{ventaDetalle.numero}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.bg} ${ESTADOS[ventaDetalle.estado as EstadoVenta]?.color}`}>
                    {ESTADOS[ventaDetalle.estado as EstadoVenta]?.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(ventaDetalle.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              </div>
              <button onClick={() => setVentaDetalle(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {ventaDetalle.cliente_nombre && (
              <div className="mb-3 text-sm text-gray-600">
                <span className="font-medium">Cliente:</span> {ventaDetalle.cliente_nombre}
                {ventaDetalle.cliente_telefono && ` · ${ventaDetalle.cliente_telefono}`}
              </div>
            )}

            <div className="space-y-2 mb-4">
              {(ventaDetalle.venta_items ?? []).map((item: any) => (
                <div key={item.id} className="flex justify-between text-sm bg-gray-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="font-medium">{item.productos?.nombre}</p>
                    <p className="text-xs text-gray-400">{item.cantidad} × ${item.precio_unitario?.toLocaleString('es-AR')}</p>
                    {item.descuento > 0 && (() => {
                      const descMonto = (item.precio_unitario * item.cantidad) - item.subtotal
                      return (
                        <p className="text-xs text-green-600 font-medium">
                          Descuento {item.descuento}% · −${descMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </p>
                      )
                    })()}
                  </div>
                  <p className="font-semibold">${item.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-3 mb-4 space-y-1 text-sm">
              {ventaDetalle.descuento_total > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuento {ventaDetalle.descuento_total}%</span>
                  <span>−${(ventaDetalle.subtotal * ventaDetalle.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-[#1E3A5F] text-base">
                <span>Total</span>
                <span>${ventaDetalle.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              {ventaDetalle.medio_pago && <p className="text-gray-500">Medio de pago: {formatMedioPago(ventaDetalle.medio_pago)}</p>}
              {ventaDetalle.notas && <p className="text-gray-500">Notas: {ventaDetalle.notas}</p>}
            </div>

            {/* Acciones según estado */}
            <div className="space-y-2">
              <button
                onClick={() => {
                  const items = (ventaDetalle.venta_items ?? []).map((item: any) => ({
                    nombre: item.productos?.nombre ?? '',
                    cantidad: item.cantidad,
                    precio_unitario: item.precio_unitario,
                    descuento: item.descuento ?? 0,
                    descuento_tipo: 'pct' as DescTipo,
                    subtotal: item.subtotal,
                    tiene_series: false,
                    series_seleccionadas: [],
                  }))
                  setTicketVenta({ ...ventaDetalle, items })
                }}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm">
                <Printer size={15} /> Ver / Imprimir ticket
              </button>
              {ventaDetalle.estado === 'pendiente' && (
                <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'reservada' })}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-all">
                  Reservar stock
                </button>
              )}
              {(ventaDetalle.estado === 'pendiente' || ventaDetalle.estado === 'reservada') && (
                <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'despachada' })}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2">
                  <Truck size={16} /> Despachar (rebaja stock)
                </button>
              )}
              {ventaDetalle.estado === 'despachada' && (
                <button onClick={() => cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'facturada' })}
                  disabled={cambiarEstado.isPending}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 rounded-xl transition-all">
                  Marcar como facturada
                </button>
              )}
              {['pendiente', 'reservada'].includes(ventaDetalle.estado) && (
                <button onClick={() => {
                  if (confirm('¿Cancelar esta venta? El stock reservado quedará disponible.'))
                    cambiarEstado.mutate({ ventaId: ventaDetalle.id, nuevoEstado: 'cancelada' })
                }}
                  disabled={cambiarEstado.isPending}
                  className="w-full border-2 border-red-200 text-red-600 font-semibold py-2.5 rounded-xl hover:bg-red-50 transition-all">
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
                  className="w-full border-2 border-gray-200 text-gray-500 font-semibold py-2 rounded-xl hover:bg-gray-50 hover:border-red-200 hover:text-red-500 transition-all text-sm">
                  Eliminar venta
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal TICKET */}
      {ticketVenta && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" id="ticket-print">
            <div className="text-center mb-4 border-b border-dashed border-gray-300 pb-4">
              <p className="text-lg font-bold text-[#1E3A5F]">{tenant?.nombre ?? 'Stokio'}</p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(ticketVenta.created_at ?? Date.now()).toLocaleString('es-AR', {
                  dateStyle: 'full', timeStyle: 'short'
                })}
              </p>
              <p className="text-sm font-mono text-gray-500 mt-1">Venta #{ticketVenta.numero ?? '—'}</p>
            </div>

            {ticketVenta.cliente_nombre && (
              <p className="text-sm text-gray-600 mb-3">
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
                      <span className="text-gray-400 ml-1 text-xs">× {cant}</span>
                      {item.descuento > 0 && (
                        <span className="text-green-600 text-xs ml-1">
                          -{item.descuento_tipo === 'pct' ? `${item.descuento}%` : `$${item.descuento}`}
                        </span>
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
                <div className="border-t border-dashed border-gray-300 pt-3 space-y-1">
                  {tieneDescItems && (
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>Precio lista</span>
                      <span className="line-through">${precioLista.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal</span>
                    <span>${ticketVenta.subtotal?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.descuento_total > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Descuento {ticketVenta.descuento_total}%</span>
                      <span>−${(ticketVenta.subtotal * ticketVenta.descuento_total / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-[#1E3A5F] text-base">
                    <span>TOTAL</span>
                    <span>${ticketVenta.total?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                  </div>
                  {ticketVenta.medio_pago && (() => {
                    let pagos: { tipo: string; monto: number }[] = []
                    try { const p = JSON.parse(ticketVenta.medio_pago); if (Array.isArray(p)) pagos = p } catch {}
                    if (pagos.length === 0)
                      return <p className="text-xs text-gray-400 text-right">{ticketVenta.medio_pago}</p>
                    return (
                      <div className="space-y-0.5 pt-1 border-t border-dashed border-gray-200 mt-1">
                        {pagos.map((p, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-400">
                            <span>{p.tipo}</span>
                            {p.monto > 0 && <span>${p.monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            <p className="text-center text-xs text-gray-300 mt-4 border-t border-dashed border-gray-200 pt-3">
              ¡Gracias por su compra!
            </p>

            <div className="flex gap-2 mt-4">
              <button onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-2 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">
                <Printer size={15} /> Imprimir
              </button>
              <button onClick={() => setTicketVenta(null)}
                className="flex-1 bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-2 rounded-xl text-sm transition-all">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal selección de series */}
      {seriesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#1E3A5F]">Seleccionar series</h2>
              <button onClick={() => setSeriesModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
              {seriesModal.lineas.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No hay series disponibles</p>
              ) : seriesModal.lineas.map((s: any) => {
                const selected = cart[seriesModal.itemIdx]?.series_seleccionadas.includes(s.id)
                return (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={selected}
                      onChange={e => {
                        const current = cart[seriesModal.itemIdx].series_seleccionadas
                        const updated = e.target.checked
                          ? [...current, s.id]
                          : current.filter(id => id !== s.id)
                        updateItem(seriesModal.itemIdx, 'series_seleccionadas', updated)
                        updateItem(seriesModal.itemIdx, 'cantidad', updated.length)
                      }} />
                    <span className="font-mono text-sm">{s.nro_serie}</span>
                    <span className="text-xs text-gray-400">{s.lpn}</span>
                  </label>
                )
              })}
            </div>
            <button onClick={() => setSeriesModal(null)}
              className="w-full bg-[#1E3A5F] hover:bg-[#2E75B6] text-white font-semibold py-2.5 rounded-xl transition-all">
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
    </div>
  )
}
