import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Package, AlertTriangle, ArrowDown, TrendingUp, TrendingDown,
  ShoppingCart, DollarSign, CheckCircle, Zap, ChevronRight, Clock, BarChart2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Link } from 'react-router-dom'

type InsightTipo = 'danger' | 'warning' | 'success' | 'info'

interface Insight {
  tipo: InsightTipo
  titulo: string
  impacto: string
  accion: string
  link: string
}

const INSIGHT_STYLES: Record<InsightTipo, { border: string; bg: string; iconColor: string; iconBg: string }> = {
  danger:  { border: 'border-l-red-500',   bg: 'bg-red-50/40',   iconColor: 'text-red-500',   iconBg: 'bg-red-100' },
  warning: { border: 'border-l-amber-500', bg: 'bg-amber-50/40', iconColor: 'text-amber-600', iconBg: 'bg-amber-100' },
  success: { border: 'border-l-green-500', bg: 'bg-green-50/40', iconColor: 'text-green-600', iconBg: 'bg-green-100' },
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50/40',  iconColor: 'text-blue-600',  iconBg: 'bg-blue-100' },
}

const INSIGHT_ICONS: Record<InsightTipo, React.ElementType> = {
  danger:  AlertTriangle,
  warning: Clock,
  success: CheckCircle,
  info:    BarChart2,
}

const SEMAFORO_COLOR: Record<string, string> = {
  ok:      'bg-green-400',
  danger:  'bg-red-400',
  warning: 'bg-amber-400',
  neutral: 'bg-gray-300',
}

export default function DashboardPage() {
  const { tenant } = useAuthStore()

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id],
    queryFn: async () => {
      const hoy = new Date()
      const inicioMes    = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
      const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString()
      const finMesAnt    = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59).toISOString()
      const hace7dias    = new Date(Date.now() - 7 * 86400000).toISOString()
      const hace30dias   = new Date(Date.now() - 30 * 86400000).toISOString()

      const [productos, alertas, movimientos, ventasMes, ventasMesAnt, rebajesRecientes] = await Promise.all([
        supabase.from('productos').select('id, stock_actual, stock_minimo, precio_costo').eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('alertas').select('id').eq('tenant_id', tenant!.id).eq('resuelta', false),
        supabase.from('movimientos_stock').select('tipo, cantidad').eq('tenant_id', tenant!.id).gte('created_at', hace7dias),
        supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes),
        supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMesAnt).lte('created_at', finMesAnt),
        supabase.from('movimientos_stock').select('producto_id').eq('tenant_id', tenant!.id).eq('tipo', 'rebaje').gte('created_at', hace30dias),
      ])

      const prods            = productos.data ?? []
      const totalProductos   = prods.length
      const stockCritico     = prods.filter(p => p.stock_actual <= p.stock_minimo).length
      const valorInventario  = prods.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)
      const alertasActivas   = alertas.data?.length ?? 0
      const movs             = movimientos.data ?? []
      const ingresosHoy      = movs.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + m.cantidad, 0)
      const rebajesHoy       = movs.filter(m => m.tipo === 'rebaje').reduce((a, m) => a + m.cantidad, 0)
      const totalVentasMes   = (ventasMes.data ?? []).reduce((a, v) => a + (v.total ?? 0), 0)
      const cantVentasMes    = ventasMes.data?.length ?? 0
      const totalVentasMesAnt = (ventasMesAnt.data ?? []).reduce((a, v) => a + (v.total ?? 0), 0)

      // Stock muerto: productos con stock > 0 sin ningún rebaje en 30 días
      const vendidosSet      = new Set((rebajesRecientes.data ?? []).map((r: any) => r.producto_id))
      const prodsInactivos   = prods.filter(p => p.stock_actual > 0 && !vendidosSet.has(p.id))
      const cantStockMuerto  = prodsInactivos.length
      const valorStockMuerto = prodsInactivos.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)

      return {
        totalProductos, stockCritico, valorInventario, alertasActivas,
        ingresosHoy, rebajesHoy, totalVentasMes, cantVentasMes,
        totalVentasMesAnt, cantStockMuerto, valorStockMuerto,
      }
    },
    enabled: !!tenant,
  })

  const { data: movRecientes = [] } = useQuery({
    queryKey: ['movimientos-recientes', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_stock').select('*, productos(nombre,sku)')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(5)
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: topProductos = [] } = useQuery({
    queryKey: ['dashboard-top-productos', tenant?.id],
    queryFn: async () => {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const { data: ventas } = await supabase.from('ventas')
        .select('venta_items(cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes)
      const ranking: Record<string, { nombre: string; cantidad: number }> = {}
      ;(ventas ?? []).forEach((v: any) => {
        ;(v.venta_items ?? []).forEach((item: any) => {
          const nombre = item.productos?.nombre ?? ''
          if (!ranking[nombre]) ranking[nombre] = { nombre, cantidad: 0 }
          ranking[nombre].cantidad += item.cantidad ?? 0
        })
      })
      return Object.values(ranking).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
    },
    enabled: !!tenant,
  })

  // ─── Insights ────────────────────────────────────────────────────────────────
  const insights = useMemo<Insight[]>(() => {
    if (!stats) return []
    const list: Insight[] = []

    if (stats.alertasActivas > 0) {
      list.push({
        tipo: 'danger',
        titulo: `${stats.alertasActivas} producto${stats.alertasActivas !== 1 ? 's' : ''} llegaron al stock mínimo`,
        impacto: 'Podés quedarte sin mercadería para vender',
        accion: 'Reponer ahora',
        link: '/alertas',
      })
    }

    if (stats.cantStockMuerto > 0 && stats.valorStockMuerto > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${stats.cantStockMuerto} producto${stats.cantStockMuerto !== 1 ? 's' : ''} sin movimiento en 30 días`,
        impacto: `$${stats.valorStockMuerto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} inmovilizados en mercadería parada`,
        accion: 'Ver inventario',
        link: '/inventario',
      })
    }

    if (stats.totalVentasMesAnt > 0) {
      const pct  = (stats.totalVentasMes - stats.totalVentasMesAnt) / stats.totalVentasMesAnt * 100
      const diff = Math.abs(stats.totalVentasMes - stats.totalVentasMesAnt)
      if (pct <= -10) {
        list.push({
          tipo: 'warning',
          titulo: `Las ventas bajaron ${Math.abs(pct).toFixed(0)}% vs el mes pasado`,
          impacto: `Facturaste $${diff.toLocaleString('es-AR', { maximumFractionDigits: 0 })} menos`,
          accion: 'Analizar métricas',
          link: '/metricas',
        })
      } else if (pct >= 10) {
        list.push({
          tipo: 'success',
          titulo: `Las ventas subieron ${pct.toFixed(0)}% vs el mes pasado 🎉`,
          impacto: `Facturaste $${diff.toLocaleString('es-AR', { maximumFractionDigits: 0 })} más`,
          accion: 'Ver métricas',
          link: '/metricas',
        })
      }
    }

    if (list.length === 0) {
      list.push({
        tipo: 'success',
        titulo: 'Todo en orden por ahora',
        impacto: 'No hay problemas críticos detectados en tu negocio',
        accion: 'Ver métricas',
        link: '/metricas',
      })
    }

    return list
  }, [stats])

  // ─── Semáforos ───────────────────────────────────────────────────────────────
  const sem = useMemo(() => {
    if (!stats) return { alertas: 'neutral', stock: 'neutral', ventas: 'neutral' }
    const pctV = stats.totalVentasMesAnt > 0
      ? (stats.totalVentasMes - stats.totalVentasMesAnt) / stats.totalVentasMesAnt * 100
      : 0
    return {
      alertas: stats.alertasActivas > 0 ? 'danger' : 'ok',
      stock:   stats.stockCritico > stats.totalProductos * 0.15 ? 'danger' : stats.stockCritico > 0 ? 'warning' : 'ok',
      ventas:  stats.totalVentasMesAnt === 0 ? 'neutral' : pctV > 5 ? 'ok' : pctV < -10 ? 'danger' : 'warning',
    }
  }, [stats])

  const trendVentas = stats && stats.totalVentasMesAnt > 0
    ? (stats.totalVentasMes - stats.totalVentasMesAnt) / stats.totalVentasMesAnt * 100
    : null

  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E3A5F] capitalize">{fecha}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{tenant?.nombre}</p>
      </div>

      {/* KPI Cards con semáforo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        <Link to="/inventario" className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 bg-blue-50 text-blue-600">
            <Package size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-800">{(stats?.totalProductos ?? 0).toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-0.5">Total productos</p>
        </Link>

        <Link to="/alertas" className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-50 text-red-500">
              <AlertTriangle size={20} />
            </div>
            <span className={`w-2.5 h-2.5 rounded-full mt-1 ${SEMAFORO_COLOR[sem.alertas]}`} />
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats?.alertasActivas ?? 0}</p>
          <p className="text-sm text-gray-500 mt-0.5">Alertas activas</p>
        </Link>

        <Link to="/movimientos" className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 bg-green-50 text-green-600">
            <ArrowDown size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-800">{(stats?.ingresosHoy ?? 0).toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-0.5">Ingresos (7d)</p>
        </Link>

        <Link to="/alertas" className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 text-amber-500">
              <Package size={20} />
            </div>
            <span className={`w-2.5 h-2.5 rounded-full mt-1 ${SEMAFORO_COLOR[sem.stock]}`} />
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats?.stockCritico ?? 0}</p>
          <p className="text-sm text-gray-500 mt-0.5">Stock crítico</p>
        </Link>
      </div>

      {/* Ventas del mes + Valor inventario */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-[#1E3A5F] to-[#2E75B6] rounded-xl p-5 text-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <DollarSign size={18} className="text-blue-200" />
              <span className="text-blue-200 text-sm">Ventas este mes</span>
            </div>
            {trendVentas !== null && (
              <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
                ${trendVentas >= 0 ? 'bg-green-500/30 text-green-200' : 'bg-red-500/30 text-red-200'}`}>
                {trendVentas >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {Math.abs(trendVentas).toFixed(0)}%
              </div>
            )}
          </div>
          <p className="text-3xl font-bold">
            ${(stats?.totalVentasMes ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-blue-200 text-xs mt-1">{stats?.cantVentasMes ?? 0} ventas despachadas</p>
          {trendVentas !== null && stats && (
            <p className="text-blue-300 text-xs mt-0.5">
              {trendVentas >= 0 ? '+' : ''}${Math.abs(stats.totalVentasMes - stats.totalVentasMesAnt).toLocaleString('es-AR', { maximumFractionDigits: 0 })} vs mes anterior
            </p>
          )}
          <Link to="/metricas" className="inline-block mt-3 text-xs text-blue-300 hover:text-white transition-colors">
            Ver métricas completas →
          </Link>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-[#2E75B6]" />
            <h2 className="font-semibold text-gray-700">Valor del inventario</h2>
          </div>
          <p className="text-3xl font-bold text-[#1E3A5F]">
            ${(stats?.valorInventario ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400 mt-1">Precio costo × stock actual</p>
          {(stats?.cantStockMuerto ?? 0) > 0 && (
            <p className="text-xs text-amber-500 mt-1">
              ⚠ ${(stats?.valorStockMuerto ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} en stock sin movimiento
            </p>
          )}
        </div>
      </div>

      {/* Insights */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-[#2E75B6]" />
          <h2 className="font-semibold text-gray-700">Lo que necesitás saber</h2>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const style = INSIGHT_STYLES[insight.tipo]
            const Icon  = INSIGHT_ICONS[insight.tipo]
            return (
              <div key={i}
                className={`bg-white rounded-xl border border-gray-100 border-l-4 ${style.border} ${style.bg}
                  p-4 flex items-center justify-between gap-4 shadow-sm`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
                    <Icon size={16} className={style.iconColor} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 text-sm leading-tight">{insight.titulo}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{insight.impacto}</p>
                  </div>
                </div>
                <Link
                  to={insight.link}
                  className="flex items-center gap-1 text-xs font-semibold text-[#2E75B6] hover:text-[#1E3A5F] whitespace-nowrap flex-shrink-0 transition-colors"
                >
                  {insight.accion} <ChevronRight size={13} />
                </Link>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid lg:grid-cols-2 gap-6">

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <ShoppingCart size={16} className="text-[#2E75B6]" /> Top productos este mes
            </h2>
            <Link to="/metricas" className="text-xs text-[#2E75B6] hover:underline">Ver más →</Link>
          </div>
          {topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Sin ventas este mes</p>
          ) : (
            <div className="space-y-2">
              {topProductos.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${i === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>
                      {i + 1}
                    </span>
                    <span className="text-gray-700 truncate max-w-[160px]">{p.nombre}</span>
                  </div>
                  <span className="font-semibold text-[#1E3A5F]">{p.cantidad} u.</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">Movimientos recientes</h2>
            <Link to="/movimientos" className="text-xs text-[#2E75B6] hover:underline">Ver todos →</Link>
          </div>
          {movRecientes.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Sin movimientos aún</p>
          ) : (
            <div className="space-y-2">
              {movRecientes.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${m.tipo === 'ingreso' ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <span className="text-gray-700 truncate max-w-[160px]">{m.productos?.nombre}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className={`font-medium ${m.tipo === 'ingreso' ? 'text-green-600' : 'text-blue-600'}`}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{m.cantidad}
                    </span>
                    <span className="text-xs">{new Date(m.created_at).toLocaleDateString('es-AR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
