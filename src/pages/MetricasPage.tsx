import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, ShoppingCart, Package,
  DollarSign, BarChart2, Clock, AlertTriangle, Award, Minus
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

type Periodo = '7d' | '30d' | '90d' | 'mes'

const COLORES = ['#1E3A5F', '#2E75B6', '#7DB9E8', '#22c55e', '#f97316', '#8b5cf6', '#ef4444', '#eab308']

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function StatCard({ label, value, sub, icon: Icon, color, trend }: any) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
          {trend === 'up' && <TrendingUp size={11} />}
          {trend === 'down' && <TrendingDown size={11} />}
          {trend === 'neutral' && <Minus size={11} />}
          {sub}
        </p>
      )}
    </div>
  )
}

export default function MetricasPage() {
  const { tenant } = useAuthStore()
  const [periodo, setPeriodo] = useState<Periodo>('30d')

  const getFechaDesde = () => {
    const d = new Date()
    if (periodo === '7d') d.setDate(d.getDate() - 7)
    else if (periodo === '30d') d.setDate(d.getDate() - 30)
    else if (periodo === '90d') d.setDate(d.getDate() - 90)
    else { d.setDate(1) } // mes actual
    return d.toISOString()
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
    queryKey: ['metricas-ventas', tenant?.id, periodo],
    queryFn: async () => {
      const { data } = await supabase.from('ventas')
        .select('*, venta_items(cantidad, subtotal, precio_unitario, descuento, productos(nombre, sku, precio_costo))')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', getFechaDesde())
        .order('created_at')
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: ventasAnteriores = [] } = useQuery({
    queryKey: ['metricas-ventas-ant', tenant?.id, periodo],
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
        .select('id, nombre, sku, precio_costo, precio_venta, stock_actual, updated_at')
        .eq('tenant_id', tenant!.id).eq('activo', true).order('nombre')
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

  // Productos más vendidos
  const rankingProductos: Record<string, { nombre: string; sku: string; cantidad: number; total: number; costo: number }> = {}
  ventasPeriodo.forEach((v: any) => {
    ;(v.venta_items ?? []).forEach((item: any) => {
      const pid = item.producto_id ?? item.productos?.sku
      if (!pid) return
      if (!rankingProductos[pid]) {
        rankingProductos[pid] = {
          nombre: item.productos?.nombre ?? '',
          sku: item.productos?.sku ?? '',
          cantidad: 0, total: 0,
          costo: item.productos?.precio_costo ?? 0,
        }
      }
      rankingProductos[pid].cantidad += item.cantidad ?? 0
      rankingProductos[pid].total += item.subtotal ?? 0
    })
  })
  const topProductos = Object.values(rankingProductos)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10)

  // Ventas por medio de pago
  const ventasPorMedio: Record<string, number> = {}
  ventasPeriodo.forEach((v: any) => {
    const medio = v.medio_pago ?? 'Sin especificar'
    ventasPorMedio[medio] = (ventasPorMedio[medio] ?? 0) + v.total
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
    .filter((p: any) => !productosVendidosIds.has(p.id) && p.stock_actual > 0)
    .map((p: any) => ({
      ...p,
      ultimaVenta: ultimaVentaMap[p.id] ?? null,
    }))
    .sort((a: any, b: any) => {
      if (!a.ultimaVenta) return -1
      if (!b.ultimaVenta) return 1
      return new Date(a.ultimaVenta).getTime() - new Date(b.ultimaVenta).getTime()
    })

  // Margen por producto (top vendidos)
  const margenProductos = topProductos
    .filter(p => p.costo > 0)
    .map(p => ({
      nombre: p.nombre.length > 20 ? p.nombre.slice(0, 20) + '...' : p.nombre,
      margen: p.total > 0 ? Math.round(((p.total - p.costo * p.cantidad) / p.total) * 100) : 0,
      total: p.total,
    }))
    .sort((a, b) => b.margen - a.margen)

  const PERIODOS = [
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: '90d', label: '90 días' },
    { id: 'mes', label: 'Este mes' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Métricas</h1>
          <p className="text-gray-500 text-sm mt-0.5">Análisis de ventas y rotación de stock</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {PERIODOS.map(p => (
            <button key={p.id} onClick={() => setPeriodo(p.id as Periodo)}
              className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-all
                ${periodo === p.id ? 'bg-white text-[#1E3A5F] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ventas totales" icon={DollarSign} color="bg-blue-50 text-blue-600"
          value={formatMoneda(totalVentas)}
          sub={`${varVentas >= 0 ? '+' : ''}${varVentas.toFixed(1)}% vs período anterior`}
          trend={varVentas > 0 ? 'up' : varVentas < 0 ? 'down' : 'neutral'}
        />
        <StatCard
          label="Nº de ventas" icon={ShoppingCart} color="bg-green-50 text-green-600"
          value={ventasPeriodo.length}
          sub={`${ventasAnteriores.length} en período anterior`}
          trend={ventasPeriodo.length >= ventasAnteriores.length ? 'up' : 'down'}
        />
        <StatCard
          label="Ticket promedio" icon={TrendingUp} color="bg-purple-50 text-purple-600"
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
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-700 mb-4">Ventas por día</h2>
          {dataGrafico.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Sin ventas en este período</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dataGrafico}>
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatMoneda(v)} />
                <Bar dataKey="total" fill="#2E75B6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Medios de pago */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-700 mb-4">Ventas por medio de pago</h2>
          {dataMediosPago.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Sin datos</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={dataMediosPago} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {dataMediosPago.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoneda(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top productos */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Award size={18} className="text-yellow-500" />
            <h2 className="font-semibold text-gray-700">Productos más vendidos</h2>
          </div>
          {topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin ventas en este período</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {topProductos.map((p, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${i === 0 ? 'bg-yellow-100 text-yellow-600' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-400'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                    <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-[#1E3A5F]">{p.cantidad} u.</p>
                    <p className="text-xs text-gray-400">{formatMoneda(p.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Margen por producto */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-700 mb-4">Margen de ganancia (top vendidos)</h2>
          {margenProductos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sin datos suficientes</p>
          ) : (
            <div className="space-y-3">
              {margenProductos.slice(0, 6).map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 truncate max-w-48">{p.nombre}</span>
                    <span className={`font-bold ${p.margen >= 30 ? 'text-green-600' : p.margen >= 15 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {p.margen}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.margen >= 30 ? 'bg-green-500' : p.margen >= 15 ? 'bg-yellow-500' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(p.margen, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Productos sin movimiento */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Clock size={18} className="text-orange-500" />
          <h2 className="font-semibold text-gray-700">Productos sin movimiento en el período</h2>
          <span className="ml-auto text-xs text-gray-400">{sinMovimiento.length} productos</span>
        </div>
        {sinMovimiento.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">¡Todos los productos tuvieron movimiento!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Producto</th>
                  <th className="text-right px-5 py-3 font-semibold text-gray-600">Stock actual</th>
                  <th className="text-right px-5 py-3 font-semibold text-gray-600">Valor en stock</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 hidden md:table-cell">Última venta</th>
                </tr>
              </thead>
              <tbody>
                {sinMovimiento.slice(0, 20).map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{p.nombre}</p>
                      <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-700">{p.stock_actual}</td>
                    <td className="px-5 py-3 text-right text-gray-500">{formatMoneda(p.stock_actual * p.precio_costo)}</td>
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
              <p className="text-xs text-gray-400 text-center py-2">Mostrando 20 de {sinMovimiento.length}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
