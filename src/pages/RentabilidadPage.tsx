import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, DollarSign, Package, ShoppingCart, Award } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type Periodo = '7d' | '30d' | '90d' | 'mes'

function formatMoneda(v: number) {
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function formatPct(v: number) {
  return `${v.toFixed(1)}%`
}

function getFechaDesde(periodo: Periodo) {
  const d = new Date()
  if (periodo === '7d') d.setDate(d.getDate() - 7)
  else if (periodo === '30d') d.setDate(d.getDate() - 30)
  else if (periodo === '90d') d.setDate(d.getDate() - 90)
  else d.setDate(1)
  return d.toISOString()
}

function KpiCard({ label, value, sub, icon: Icon, color, trend }: any) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'good' ? 'text-green-600 dark:text-green-400' : trend === 'bad' ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
          {trend === 'good' && <TrendingUp size={11} />}
          {trend === 'bad' && <TrendingDown size={11} />}
          {sub}
        </p>
      )}
    </div>
  )
}

export default function RentabilidadPage({ hideHeader = false }: { hideHeader?: boolean }) {
  const { tenant } = useAuthStore()
  const [periodo, setPeriodo] = useState<Periodo>('30d')

  const { data: ventas = [], isLoading } = useQuery({
    queryKey: ['rentabilidad-ventas', tenant?.id, periodo],
    queryFn: async () => {
      const desde = getFechaDesde(periodo)
      const { data, error } = await supabase
        .from('ventas')
        .select(`
          id, numero, total, cliente_nombre, created_at,
          venta_items(
            cantidad, precio_unitario, precio_costo_historico, subtotal,
            productos(nombre, categoria_id, categorias(nombre))
          )
        `)
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'despachada')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!tenant,
  })

  // Computar métricas derivadas
  const { kpis, porVenta, porProducto } = useMemo(() => {
    let totalVentas = 0
    let totalCosto = 0
    let ventasConCosto = 0

    const ventaRows: any[] = []
    const prodMap: Record<string, { nombre: string; venta: number; costo: number; cantidad: number }> = {}

    for (const v of ventas) {
      let costoVenta = 0
      let hayAlgunCosto = false

      for (const item of (v.venta_items ?? []) as any[]) {
        const subtotal = item.subtotal ?? (item.precio_unitario * item.cantidad)
        totalVentas += subtotal

        if (item.precio_costo_historico) {
          const costo = item.precio_costo_historico * item.cantidad
          costoVenta += costo
          totalCosto += costo
          hayAlgunCosto = true
        }

        const nombre = item.productos?.nombre ?? 'Producto'
        if (!prodMap[nombre]) prodMap[nombre] = { nombre, venta: 0, costo: 0, cantidad: 0 }
        prodMap[nombre].venta += subtotal
        if (item.precio_costo_historico) prodMap[nombre].costo += item.precio_costo_historico * item.cantidad
        prodMap[nombre].cantidad += item.cantidad
      }

      if (hayAlgunCosto) ventasConCosto++

      const ganancia = costoVenta > 0 ? (v.total - costoVenta) : null
      const margen = ganancia !== null && v.total > 0 ? (ganancia / v.total) * 100 : null

      ventaRows.push({
        id: v.id,
        numero: v.numero,
        fecha: v.created_at,
        cliente: v.cliente_nombre,
        total: v.total,
        costo: costoVenta || null,
        ganancia,
        margen,
      })
    }

    const gananciaTotal = totalCosto > 0 ? totalVentas - totalCosto : null
    const margenPromedio = gananciaTotal !== null && totalVentas > 0 ? (gananciaTotal / totalVentas) * 100 : null

    const porProducto = Object.values(prodMap)
      .map(p => ({
        ...p,
        ganancia: p.costo > 0 ? p.venta - p.costo : null,
        margen: p.costo > 0 && p.venta > 0 ? ((p.venta - p.costo) / p.venta) * 100 : null,
      }))
      .sort((a, b) => (b.ganancia ?? 0) - (a.ganancia ?? 0))
      .slice(0, 10)

    return {
      kpis: { totalVentas, totalCosto, gananciaTotal, margenPromedio, ventasConCosto, totalVentasCount: ventas.length },
      porVenta: ventaRows,
      porProducto,
    }
  }, [ventas])

  const sinDatos = kpis.totalCosto === 0

  const PERIODOS: { key: Periodo; label: string }[] = [
    { key: '7d', label: '7 días' },
    { key: 'mes', label: 'Este mes' },
    { key: '30d', label: '30 días' },
    { key: '90d', label: '90 días' },
  ]

  return (
    <div className={hideHeader ? '' : 'p-6 max-w-5xl mx-auto'}>
      {/* Header */}
      {!hideHeader && <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
            <TrendingUp size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Rentabilidad Real</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Margen y ganancia de tus ventas despachadas</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {PERIODOS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${periodo === p.key ? 'bg-white dark:bg-gray-800 shadow text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>}

      {isLoading ? (
        <p className="text-center text-gray-400 dark:text-gray-500 py-16">Cargando...</p>
      ) : ventas.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin ventas despachadas en este período</p>
        </div>
      ) : (
        <>
          {/* Aviso si no hay datos de costo */}
          {sinDatos && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-700 dark:text-amber-400">
              <strong>Sin datos de costo disponibles.</strong> Para ver la rentabilidad, ingresá el precio de compra al registrar movimientos de ingreso de stock.
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="Ventas totales"
              value={formatMoneda(kpis.totalVentas)}
              sub={`${kpis.totalVentasCount} ventas despachadas`}
              icon={ShoppingCart}
              color="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            />
            <KpiCard
              label="Costo total"
              value={kpis.totalCosto > 0 ? formatMoneda(kpis.totalCosto) : '—'}
              sub={kpis.ventasConCosto > 0 ? `${kpis.ventasConCosto} ventas con costo` : 'Sin datos de costo'}
              icon={Package}
              color="bg-orange-100 text-orange-600"
            />
            <KpiCard
              label="Ganancia bruta"
              value={kpis.gananciaTotal !== null ? formatMoneda(kpis.gananciaTotal) : '—'}
              sub={kpis.gananciaTotal !== null ? (kpis.gananciaTotal >= 0 ? 'Ganancia' : 'Pérdida') : 'Ingresá costos'}
              icon={DollarSign}
              color="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
              trend={kpis.gananciaTotal !== null ? (kpis.gananciaTotal >= 0 ? 'good' : 'bad') : undefined}
            />
            <KpiCard
              label="Margen promedio"
              value={kpis.margenPromedio !== null ? formatPct(kpis.margenPromedio) : '—'}
              sub={kpis.margenPromedio !== null ? (kpis.margenPromedio >= 30 ? 'Margen saludable' : kpis.margenPromedio >= 15 ? 'Margen ajustado' : 'Margen bajo') : ''}
              icon={Award}
              color="bg-purple-100 text-purple-600"
              trend={kpis.margenPromedio !== null ? (kpis.margenPromedio >= 20 ? 'good' : 'bad') : undefined}
            />
          </div>

          {/* Gráfico por producto */}
          {!sinDatos && porProducto.some(p => p.ganancia !== null) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm mb-6">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                <Award size={16} /> Top productos por ganancia
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={porProducto.filter(p => p.ganancia !== null)} layout="vertical" margin={{ left: 16 }}>
                  <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="nombre" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatMoneda(Number(v))} />
                  <Bar dataKey="ganancia" radius={[0, 4, 4, 0]}>
                    {porProducto.map((p, i) => (
                      <Cell key={i} fill={(p.ganancia ?? 0) >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabla por venta */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <ShoppingCart size={16} /> Detalle por venta
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Fecha</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Cliente</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Venta</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Costo</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Ganancia</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Margen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                  {porVenta.map((v: any) => (
                    <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">#{v.numero ?? v.id.slice(-4)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {new Date(v.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[120px] truncate">{v.cliente ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-gray-100">{formatMoneda(v.total)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{v.costo ? formatMoneda(v.costo) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${v.ganancia === null ? 'text-gray-300' : v.ganancia >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                        {v.ganancia !== null ? formatMoneda(v.ganancia) : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${v.margen === null ? 'text-gray-300' : v.margen >= 20 ? 'text-green-600 dark:text-green-400' : v.margen >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>
                        {v.margen !== null ? formatPct(v.margen) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
