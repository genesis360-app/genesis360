import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, ShoppingCart, Package,
  DollarSign, BarChart2, Clock, AlertTriangle, Award, Minus, Filter,
  Target, ArrowUpDown, MapPin,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { BRAND } from '@/config/brand'

type Periodo = '7d' | '30d' | '90d' | 'mes' | 'custom'

const COLORES = [BRAND.color.primary, BRAND.color.accent, '#7DB9E8', '#22c55e', '#f97316', '#8b5cf6', '#ef4444', '#eab308']

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function StatCard({ label, value, sub, icon: Icon, color, trend }: any) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'up' ? 'text-green-600 dark:text-green-400' : trend === 'down' ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
          {trend === 'up' && <TrendingUp size={11} />}
          {trend === 'down' && <TrendingDown size={11} />}
          {trend === 'neutral' && <Minus size={11} />}
          {sub}
        </p>
      )}
    </div>
  )
}

export default function MetricasPage({ hideHeader }: { hideHeader?: boolean } = {}) {
  const { tenant } = useAuthStore()
  const [periodo, setPeriodo] = useState<Periodo>('30d')
  const [fechaDesdeCustom, setFechaDesdeCustom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [fechaHastaCustom, setFechaHastaCustom] = useState(() => new Date().toISOString().split('T')[0])
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null)

  const getFechaDesde = () => {
    if (periodo === 'custom') return new Date(fechaDesdeCustom + 'T00:00:00').toISOString()
    const d = new Date()
    if (periodo === '7d') d.setDate(d.getDate() - 7)
    else if (periodo === '30d') d.setDate(d.getDate() - 30)
    else if (periodo === '90d') d.setDate(d.getDate() - 90)
    else { d.setDate(1) } // mes actual
    return d.toISOString()
  }

  const getFechaHasta = () => {
    if (periodo === 'custom') return new Date(fechaHastaCustom + 'T23:59:59').toISOString()
    return new Date().toISOString()
  }

  const getFechaDesdeAnterior = () => {
    const d = new Date()
    if (periodo === '7d') { d.setDate(d.getDate() - 14); return d.toISOString() }
    if (periodo === '30d') { d.setDate(d.getDate() - 60); return d.toISOString() }
    if (periodo === '90d') { d.setDate(d.getDate() - 180); return d.toISOString() }
    d.setMonth(d.getMonth() - 1); d.setDate(1); return d.toISOString()
  }

  const getFechaHastaAnterior = () => {
    const d = new Date()
    if (periodo === 'mes') { d.setDate(0); return d.toISOString() }
    const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 90
    d.setDate(d.getDate() - dias); return d.toISOString()
  }

  const { data: ventasPeriodo = [] } = useQuery({
    queryKey: ['metricas-ventas', tenant?.id, periodo, fechaDesdeCustom, fechaHastaCustom],
    queryFn: async () => {
      let q = supabase.from('ventas')
        .select('*, venta_items(producto_id, cantidad, subtotal, precio_unitario, iva_monto, descuento, productos(nombre, sku, precio_costo, categoria_id))')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', getFechaDesde())
        .order('created_at')
      if (periodo === 'custom') q = q.lte('created_at', getFechaHasta())
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ventasAnteriores = [] } = useQuery({
    queryKey: ['metricas-ventas-ant', tenant?.id, periodo, fechaDesdeCustom, fechaHastaCustom],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('total')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', getFechaDesdeAnterior())
        .lte('created_at', getFechaHastaAnterior())
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: productos = [] } = useQuery({
    queryKey: ['metricas-productos', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('productos')
        .select('id, nombre, sku, precio_costo, precio_venta, stock_actual, updated_at, categoria_id, margen_objetivo, alicuota_iva')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('categorias')
        .select('id, nombre').eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: gastosTotal = 0 } = useQuery({
    queryKey: ['metricas-gastos', tenant?.id, periodo, fechaDesdeCustom, fechaHastaCustom],
    queryFn: async () => {
      const fechaDesdeStr = getFechaDesde().split('T')[0]
      let q = supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).gte('fecha', fechaDesdeStr)
      if (periodo === 'custom') q = q.lte('fecha', fechaHastaCustom)
      const { data } = await q
      return (data ?? []).reduce((a, g: any) => a + Number(g.monto), 0)
    },
    enabled: !!tenant,
  })

  // Movimientos de inventario en el período
  const { data: movimientosPeriodo = [] } = useQuery({
    queryKey: ['metricas-movimientos', tenant?.id, periodo, fechaDesdeCustom, fechaHastaCustom],
    queryFn: async () => {
      let q = supabase.from('movimientos_stock')
        .select('tipo, motivo, cantidad')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', getFechaDesde())
      if (periodo === 'custom') q = q.lte('created_at', getFechaHasta())
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Stock por ubicación
  const { data: stockUbicaciones = [] } = useQuery({
    queryKey: ['metricas-stock-ubicaciones', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('inventario_lineas')
        .select('cantidad, ubicacion_id, ubicaciones(nombre), productos(precio_costo)')
        .eq('tenant_id', tenant!.id).eq('activo', true).gt('cantidad', 0)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ultimasVentas = [] } = useQuery({
    queryKey: ['metricas-ultimas-ventas', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('venta_items')
        .select('producto_id, created_at, ventas!inner(estado, created_at)')
        .in('ventas.estado', ['despachada', 'facturada'])
        .eq('ventas.tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  // ── Cálculos ─────────────────────────────────────────────────────────────────

  const totalVentas = ventasPeriodo.reduce((a: number, v: any) => a + v.total, 0)
  const totalVentasAnt = ventasAnteriores.reduce((a: number, v: any) => a + v.total, 0)
  const varVentas = totalVentasAnt > 0 ? ((totalVentas - totalVentasAnt) / totalVentasAnt) * 100 : 0

  const ticketPromedio = ventasPeriodo.length > 0 ? totalVentas / ventasPeriodo.length : 0
  const ticketAnt = ventasAnteriores.length > 0
    ? totalVentasAnt / ventasAnteriores.length : 0
  const varTicket = ticketAnt > 0 ? ((ticketPromedio - ticketAnt) / ticketAnt) * 100 : 0

  // Productos más vendidos — total es subtotal con IVA; ivaMonto acumula el IVA para extraer el neto
  const rankingProductos: Record<string, { nombre: string; sku: string; cantidad: number; total: number; ivaMonto: number; costo: number; categoria_id: string | null }> = {}
  ventasPeriodo.forEach((v: any) => {
    ;(v.venta_items ?? []).forEach((item: any) => {
      const pid = item.producto_id ?? item.productos?.sku
      if (!pid) return
      if (!rankingProductos[pid]) {
        rankingProductos[pid] = {
          nombre: item.productos?.nombre ?? '',
          sku: item.productos?.sku ?? '',
          cantidad: 0, total: 0, ivaMonto: 0,
          costo: item.productos?.precio_costo ?? 0,
          categoria_id: item.productos?.categoria_id ?? null,
        }
      }
      rankingProductos[pid].cantidad += item.cantidad ?? 0
      rankingProductos[pid].total += item.subtotal ?? 0
      rankingProductos[pid].ivaMonto += item.iva_monto ?? 0
    })
  })
  const topProductos = Object.values(rankingProductos)
    .filter(p => !categoriaFiltro || p.categoria_id === categoriaFiltro)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10)

  // Ventas por medio de pago — medio_pago se guarda como JSON string
  const ventasPorMedio: Record<string, number> = {}
  ventasPeriodo.forEach((v: any) => {
    if (!v.medio_pago) {
      ventasPorMedio['Sin especificar'] = (ventasPorMedio['Sin especificar'] ?? 0) + v.total
      return
    }
    try {
      const arr = JSON.parse(v.medio_pago) as { tipo: string; monto: number }[]
      if (Array.isArray(arr)) {
        // Si hay monto por tipo, usarlo; si no, dividir en partes iguales
        const totalArr = arr.reduce((s, p) => s + (p.monto || 0), 0)
        arr.forEach(p => {
          const tipo = p.tipo || 'Sin especificar'
          const monto = totalArr > 0 ? (p.monto || 0) : v.total / arr.length
          ventasPorMedio[tipo] = (ventasPorMedio[tipo] ?? 0) + monto
        })
        return
      }
    } catch {}
    // Fallback para registros legacy con string plano
    ventasPorMedio[v.medio_pago] = (ventasPorMedio[v.medio_pago] ?? 0) + v.total
  })
  const dataMediosPago = Object.entries(ventasPorMedio).map(([name, value]) => ({ name, value }))

  // Ventas por día (para el gráfico)
  const ventasPorDia: Record<string, number> = {}
  ventasPeriodo.forEach((v: any) => {
    const dia = new Date(v.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
    ventasPorDia[dia] = (ventasPorDia[dia] ?? 0) + v.total
  })
  const dataGrafico = Object.entries(ventasPorDia).map(([fecha, total]) => ({ fecha, total }))

  // Última venta por producto
  const ultimaVentaMap: Record<string, string> = {}
  ultimasVentas.forEach((uv: any) => {
    if (!ultimaVentaMap[uv.producto_id]) {
      ultimaVentaMap[uv.producto_id] = (uv.ventas as any)?.created_at ?? uv.created_at
    }
  })

  // Productos sin movimiento (nunca vendidos o no vendidos en el período)
  const productosVendidosIds = new Set(Object.keys(rankingProductos))
  const sinMovimiento = productos
    .filter((p: any) => !productosVendidosIds.has(p.id) && p.stock_actual > 0 && (!categoriaFiltro || p.categoria_id === categoriaFiltro))
    .map((p: any) => ({
      ...p,
      ultimaVenta: ultimaVentaMap[p.id] ?? null,
    }))
    .sort((a: any, b: any) => {
      if (!a.ultimaVenta) return -1
      if (!b.ultimaVenta) return 1
      return new Date(a.ultimaVenta).getTime() - new Date(b.ultimaVenta).getTime()
    })

  // Margen por producto (top vendidos) — markup sobre costo, usando precio neto sin IVA
  const margenProductos = topProductos
    .filter(p => p.costo > 0)
    .map(p => {
      const totalNeto = p.total - p.ivaMonto
      const markup = (p.costo * p.cantidad) > 0
        ? Math.round(((totalNeto - p.costo * p.cantidad) / (p.costo * p.cantidad)) * 100)
        : 0
      return {
        nombre: p.nombre.length > 20 ? p.nombre.slice(0, 20) + '...' : p.nombre,
        margen: markup,
        total: p.total,
      }
    })
    .sort((a, b) => b.margen - a.margen)

  // Costo de ventas y ganancia neta — strip IVA de totalVentas para comparar manzanas con manzanas
  const ivaVentasPeriodo = Object.values(rankingProductos).reduce((a, p) => a + p.ivaMonto, 0)
  const costoVentas = Object.values(rankingProductos).reduce((a, p) => a + p.costo * p.cantidad, 0)
  const gananciaNeta = (totalVentas - ivaVentasPeriodo) - costoVentas - gastosTotal

  // Insights de margen objetivo — mismo markup que ProductoFormPage: (neto - costo) / costo
  const insightsMargen = (productos as any[])
    .filter(p => p.margen_objetivo != null && p.precio_costo > 0 && p.precio_venta > 0)
    .map(p => {
      const ivaF = 1 + ((p.alicuota_iva ?? 21) as number) / 100
      const margenActual = ((p.precio_venta / ivaF - p.precio_costo) / p.precio_costo) * 100
      return {
        id: p.id, nombre: p.nombre, sku: p.sku,
        margenActual: Math.round(margenActual * 10) / 10,
        margenObjetivo: p.margen_objetivo as number,
        diff: Math.round((margenActual - p.margen_objetivo) * 10) / 10,
        bajandoObjetivo: margenActual < p.margen_objetivo,
      }
    })
    .sort((a, b) => a.diff - b.diff) // peores primero

  // Métricas de movimientos
  const totalIngresos = movimientosPeriodo.filter((m: any) => m.tipo === 'ingreso').reduce((a: number, m: any) => a + m.cantidad, 0)
  const totalRebajes = movimientosPeriodo.filter((m: any) => m.tipo === 'rebaje').reduce((a: number, m: any) => a + m.cantidad, 0)
  const motivosMap: Record<string, { count: number; cantidad: number }> = {}
  movimientosPeriodo.forEach((m: any) => {
    const key = m.motivo || 'Sin motivo'
    if (!motivosMap[key]) motivosMap[key] = { count: 0, cantidad: 0 }
    motivosMap[key].count++
    motivosMap[key].cantidad += m.cantidad ?? 0
  })
  const topMotivos = Object.entries(motivosMap)
    .map(([motivo, d]) => ({ motivo, ...d }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 8)

  // Stock por ubicación
  const ubicacionMap: Record<string, { nombre: string; valor: number; unidades: number }> = {}
  ;(stockUbicaciones as any[]).forEach(l => {
    const nombre = (l.ubicaciones as any)?.nombre ?? 'Sin ubicación'
    const costo = (l.productos as any)?.precio_costo ?? 0
    if (!ubicacionMap[nombre]) ubicacionMap[nombre] = { nombre, valor: 0, unidades: 0 }
    ubicacionMap[nombre].valor += l.cantidad * costo
    ubicacionMap[nombre].unidades += l.cantidad
  })
  const stockPorUbicacion = Object.values(ubicacionMap)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
  const maxValorUbicacion = stockPorUbicacion[0]?.valor ?? 1

  const PERIODOS = [
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: '90d', label: '90 días' },
    { id: 'mes', label: 'Este mes' },
    { id: 'custom', label: 'Personalizado' },
  ]

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-primary">Métricas</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Análisis de ventas y rotación de stock</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {(categorias as any[]).length > 0 && (
            <div className="relative">
              <Filter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <select
                value={categoriaFiltro ?? ''}
                onChange={e => setCategoriaFiltro(e.target.value || null)}
                className="pl-7 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Todas las categorías</option>
                {(categorias as any[]).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
            {PERIODOS.map(p => (
              <button key={p.id} onClick={() => setPeriodo(p.id as Periodo)}
                className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-all
                  ${periodo === p.id ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {periodo === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={fechaDesdeCustom} onChange={e => setFechaDesdeCustom(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" />
              <span className="text-gray-400 dark:text-gray-500 text-sm">→</span>
              <input type="date" value={fechaHastaCustom} onChange={e => setFechaHastaCustom(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          )}
        </div>
      </div>

      {/* Resultado del período */}
      <div className="bg-gradient-to-br from-primary to-accent rounded-xl p-5 text-white">
        <p className="text-blue-200 text-xs font-medium mb-4 uppercase tracking-wide">Resultado del período</p>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-blue-200 text-xs mb-1">Ventas</p>
            <p className="text-2xl font-bold">{formatMoneda(totalVentas)}</p>
            <p className="text-blue-300 text-xs mt-0.5">{ventasPeriodo.length} órdenes</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs mb-1">− Costo + Gastos</p>
            <p className="text-2xl font-bold">{formatMoneda(costoVentas + gastosTotal)}</p>
            <p className="text-blue-300 text-xs mt-0.5">{formatMoneda(costoVentas)} costo · {formatMoneda(gastosTotal)} gastos</p>
          </div>
          <div>
            <p className="text-blue-200 text-xs mb-1">= Ganancia neta</p>
            <p className={`text-2xl font-bold ${gananciaNeta >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {formatMoneda(gananciaNeta)}
            </p>
            {totalVentas > 0 && (
              <p className="text-blue-300 text-xs mt-0.5">
                {((gananciaNeta / totalVentas) * 100).toFixed(1)}% de margen neto
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stats principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ventas totales" icon={DollarSign} color="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
          value={formatMoneda(totalVentas)}
          sub={`${varVentas >= 0 ? '+' : ''}${varVentas.toFixed(1)}% vs período anterior`}
          trend={varVentas > 0 ? 'up' : varVentas < 0 ? 'down' : 'neutral'}
        />
        <StatCard
          label="Nº de ventas" icon={ShoppingCart} color="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
          value={ventasPeriodo.length}
          sub={`${ventasAnteriores.length} en período anterior`}
          trend={ventasPeriodo.length >= ventasAnteriores.length ? 'up' : 'down'}
        />
        <StatCard
          label="Ticket promedio" icon={TrendingUp} color="bg-purple-50 dark:bg-purple-900/20 text-purple-600"
          value={formatMoneda(ticketPromedio)}
          sub={`${varTicket >= 0 ? '+' : ''}${varTicket.toFixed(1)}% vs anterior`}
          trend={varTicket > 0 ? 'up' : varTicket < 0 ? 'down' : 'neutral'}
        />
        <StatCard
          label="Productos parados" icon={AlertTriangle} color="bg-orange-50 text-orange-500"
          value={sinMovimiento.length}
          sub="Con stock sin vender en el período"
          trend="neutral"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Gráfico ventas por día */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Ventas por día</h2>
          {dataGrafico.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm">Sin ventas en este período</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dataGrafico}>
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatMoneda(v as number)} />
                <Bar dataKey="total" fill={BRAND.color.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Medios de pago */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Ventas por medio de pago</h2>
          {dataMediosPago.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm">Sin datos</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={dataMediosPago} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {dataMediosPago.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatMoneda(v as number)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top productos */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Award size={18} className="text-yellow-500" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Productos más vendidos</h2>
          </div>
          {topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin ventas en este período</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {topProductos.map((p, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${i === 0 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600' : i === 1 ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.sku}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-primary">{p.cantidad} u.</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{formatMoneda(p.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Margen por producto */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Margen de ganancia (top vendidos)</h2>
          {margenProductos.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin datos suficientes</p>
          ) : (
            <div className="space-y-3">
              {margenProductos.slice(0, 6).map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-48">{p.nombre}</span>
                    <span className={`font-bold ${p.margen >= 30 ? 'text-green-600 dark:text-green-400' : p.margen >= 15 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {p.margen}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.margen >= 30 ? 'bg-green-50 dark:bg-green-900/200' : p.margen >= 15 ? 'bg-yellow-50 dark:bg-yellow-900/200' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(p.margen, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Insights de margen objetivo */}
      {insightsMargen.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Target size={18} className="text-purple-500" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Insights de margen objetivo</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{insightsMargen.length} productos con objetivo definido</span>
          </div>
          <div className="divide-y divide-gray-50">
            {insightsMargen.slice(0, 10).map((p, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.bajandoObjetivo ? 'bg-red-400' : 'bg-green-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.sku}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${p.bajandoObjetivo ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                    {p.margenActual}%
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    obj: {p.margenObjetivo}%
                    {' '}<span className={`font-medium ${p.bajandoObjetivo ? 'text-red-400' : 'text-green-500'}`}>
                      ({p.diff >= 0 ? '+' : ''}{p.diff}pp)
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
          {insightsMargen.filter(p => p.bajandoObjetivo).length > 0 && (
            <div className="px-5 py-3 bg-red-50 dark:bg-red-900/20 border-t border-red-100 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle size={13} />
              {insightsMargen.filter(p => p.bajandoObjetivo).length} producto(s) por debajo de su objetivo de margen
            </div>
          )}
        </div>
      )}

      {/* Métricas de inventario */}
      <div>
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
          <ArrowUpDown size={18} className="text-primary" /> Métricas de inventario
        </h2>
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Movimientos del período */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 text-sm">Movimientos en el período</h3>
            {movimientosPeriodo.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin movimientos en este período</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">{totalIngresos.toLocaleString('es-AR')}</p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">Unidades ingresadas</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {movimientosPeriodo.filter((m: any) => m.tipo === 'ingreso').length} órdenes
                    </p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{totalRebajes.toLocaleString('es-AR')}</p>
                    <p className="text-xs text-orange-500 mt-1">Unidades rebajadas</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {movimientosPeriodo.filter((m: any) => m.tipo === 'rebaje').length} órdenes
                    </p>
                  </div>
                </div>
                {topMotivos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Top motivos</p>
                    <div className="space-y-2">
                      {topMotivos.map((m, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-gray-600 dark:text-gray-400 truncate max-w-48">{m.motivo}</span>
                            <span className="text-gray-500 dark:text-gray-400 font-medium ml-2 flex-shrink-0">{m.cantidad} u.</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full"
                              style={{ width: `${Math.min((m.cantidad / (topMotivos[0]?.cantidad || 1)) * 100, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Stock por ubicación */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 text-sm flex items-center gap-2">
              <MapPin size={14} className="text-gray-400 dark:text-gray-500" /> Stock por ubicación
            </h3>
            {stockPorUbicacion.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Sin datos de ubicaciones</p>
            ) : (
              <div className="space-y-3">
                {stockPorUbicacion.map((u, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 dark:text-gray-400 truncate max-w-40">{u.nombre}</span>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{formatMoneda(u.valor)}</span>
                        <span className="text-gray-400 dark:text-gray-500 ml-1">· {u.unidades.toLocaleString('es-AR')} u.</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min((u.valor / maxValorUbicacion) * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Productos sin movimiento */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={18} className="text-orange-500" />
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Productos sin movimiento en el período</h2>
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{sinMovimiento.length} productos</span>
        </div>
        {sinMovimiento.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">¡Todos los productos tuvieron movimiento!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:bg-gray-700">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">Producto</th>
                  <th className="text-right px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">Stock actual</th>
                  <th className="text-right px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">Valor en stock</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Última venta</th>
                </tr>
              </thead>
              <tbody>
                {sinMovimiento.slice(0, 20).map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">{p.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{p.sku}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{p.stock_actual}</td>
                    <td className="px-5 py-3 text-right text-gray-500 dark:text-gray-400">{formatMoneda(p.stock_actual * p.precio_costo)}</td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {p.ultimaVenta
                        ? <span className="text-xs text-orange-500">{new Date(p.ultimaVenta).toLocaleDateString('es-AR')}</span>
                        : <span className="text-xs text-red-500 font-medium">Nunca vendido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sinMovimiento.length > 20 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Mostrando 20 de {sinMovimiento.length}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
