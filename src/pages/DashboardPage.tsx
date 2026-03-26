import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Package, AlertTriangle, ArrowDown, TrendingUp, TrendingDown,
  ShoppingCart, DollarSign, CheckCircle, Zap, ChevronRight, Clock, BarChart2,
  ChevronDown, ChevronUp, Truck, Hourglass, Lock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Link } from 'react-router-dom'
import { useRecomendaciones } from '@/hooks/useRecomendaciones'
import MetricasPage from './MetricasPage'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'

type InsightTipo = 'danger' | 'warning' | 'success' | 'info'

interface Insight {
  tipo: InsightTipo
  titulo: string
  impacto: string
  accion: string
  link: string
}

const INSIGHT_STYLES: Record<InsightTipo, { border: string; bg: string; iconColor: string; iconBg: string }> = {
  danger:  { border: 'border-l-red-500',   bg: 'bg-red-50 dark:bg-red-900/20/40 dark:bg-red-900/20',   iconColor: 'text-red-500 dark:text-red-400',   iconBg: 'bg-red-100 dark:bg-red-900/30' },
  warning: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20/40 dark:bg-amber-900/20', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-900/30' },
  success: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-green-900/20/40 dark:bg-green-900/20', iconColor: 'text-green-600 dark:text-green-400', iconBg: 'bg-green-100 dark:bg-green-900/30' },
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50 dark:bg-blue-900/20/40 dark:bg-blue-900/20',  iconColor: 'text-blue-600 dark:text-blue-400',  iconBg: 'bg-blue-100 dark:bg-blue-900/30' },
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
  const { score, recomendaciones } = useRecomendaciones()
  const { limits } = usePlanLimits()
  const [tab, setTab] = useState<'general' | 'metricas'>('general')
  const [sinMovExpanded, setSinMovExpanded] = useState(false)
  const [coberturaExpanded, setCoberturaExpanded] = useState(false)

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
        supabase.from('productos').select('id, nombre, sku, stock_actual, stock_minimo, precio_costo').eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('alertas').select('id').eq('tenant_id', tenant!.id).eq('resuelta', false),
        supabase.from('movimientos_stock').select('tipo, cantidad, productos(precio_costo)').eq('tenant_id', tenant!.id).gte('created_at', hace7dias),
        supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes),
        supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMesAnt).lte('created_at', finMesAnt),
        supabase.from('movimientos_stock').select('producto_id, cantidad').eq('tenant_id', tenant!.id).eq('tipo', 'rebaje').gte('created_at', hace30dias),
      ])

      const prods            = productos.data ?? []
      const totalProductos   = prods.length
      const stockCritico     = prods.filter(p => p.stock_actual <= p.stock_minimo).length
      const valorInventario  = prods.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)
      const alertasActivas   = alertas.data?.length ?? 0
      const movs             = movimientos.data ?? []
      const ingresosMovs     = movs.filter(m => m.tipo === 'ingreso')
      const ingresosHoy      = ingresosMovs.reduce((a, m) => a + m.cantidad * ((m as any).productos?.precio_costo ?? 0), 0)
      const cantIngresosHoy  = ingresosMovs.reduce((a, m) => a + m.cantidad, 0)
      const rebajesHoy       = movs.filter(m => m.tipo === 'rebaje').reduce((a, m) => a + m.cantidad, 0)
      const totalVentasMes   = (ventasMes.data ?? []).reduce((a, v) => a + (v.total ?? 0), 0)
      const cantVentasMes    = ventasMes.data?.length ?? 0
      const totalVentasMesAnt = (ventasMesAnt.data ?? []).reduce((a, v) => a + (v.total ?? 0), 0)

      // Velocidad de ventas en últimos 30d
      const velocidadMap: Record<string, number> = {}
      ;(rebajesRecientes.data ?? []).forEach((r: any) => {
        velocidadMap[r.producto_id] = (velocidadMap[r.producto_id] ?? 0) + r.cantidad
      })

      // Stock muerto: productos con stock > 0 sin ningún rebaje en 30 días
      const vendidosSet      = new Set((rebajesRecientes.data ?? []).map((r: any) => r.producto_id))
      const prodsInactivos   = prods.filter(p => p.stock_actual > 0 && !vendidosSet.has(p.id))
      const cantStockMuerto  = prodsInactivos.length
      const valorStockMuerto = prodsInactivos.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)

      // Sugerencia de pedido: stock crítico con velocidad y cantidad sugerida
      const prodsCriticos = prods
        .filter(p => p.stock_actual <= p.stock_minimo)
        .map(p => {
          const vendido30d = velocidadMap[p.id] ?? 0
          const promDiario = vendido30d / 30
          const diasCobertura = promDiario > 0 ? Math.floor(p.stock_actual / promDiario) : null
          const sugerido = vendido30d > 0
            ? Math.max(0, Math.ceil(vendido30d * 1.2) - p.stock_actual)
            : Math.max(1, p.stock_minimo * 2 - p.stock_actual)
          return { id: p.id, nombre: (p as any).nombre, sku: (p as any).sku, stock_actual: p.stock_actual, stock_minimo: p.stock_minimo, diasCobertura, sugerido }
        })

      // Proyección de cobertura: productos con stock > mínimo y velocidad de venta > 0
      // Muestra cuántos días de stock quedan antes de llegar al mínimo
      const proyeccionCobertura = prods
        .filter(p => p.stock_actual > p.stock_minimo && (velocidadMap[p.id] ?? 0) > 0)
        .map(p => {
          const vendido30d = velocidadMap[p.id]
          const promDiario = vendido30d / 30
          // Días hasta llegar al stock_minimo (no hasta 0)
          const diasHastaCritico = Math.floor((p.stock_actual - p.stock_minimo) / promDiario)
          return { id: p.id, nombre: (p as any).nombre, sku: (p as any).sku, stock_actual: p.stock_actual, stock_minimo: p.stock_minimo, vendido30d, diasHastaCritico }
        })
        .sort((a, b) => a.diasHastaCritico - b.diasHastaCritico)
        .slice(0, 10)

      return {
        totalProductos, stockCritico, valorInventario, alertasActivas,
        ingresosHoy, cantIngresosHoy, rebajesHoy, totalVentasMes, cantVentasMes,
        totalVentasMesAnt, cantStockMuerto, valorStockMuerto, prodsInactivos, prodsCriticos,
        proyeccionCobertura,
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

  if (tab === 'metricas') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
            <button onClick={() => setTab('general')}
              className="py-1.5 px-4 rounded-lg text-sm font-medium transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              General
            </button>
            <button onClick={() => setTab('metricas')}
              className="py-1.5 px-4 rounded-lg text-sm font-medium transition-all bg-white dark:bg-gray-800 text-primary shadow-sm dark:shadow-gray-900 flex items-center gap-1.5">
              {limits && !limits.puede_metricas && <Lock size={12} className="text-gray-400" />}
              Métricas
            </button>
          </div>
        </div>
        {limits && !limits.puede_metricas
          ? <UpgradePrompt feature="metricas" />
          : <MetricasPage hideHeader />
        }
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary capitalize">{fecha}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          <button onClick={() => setTab('general')}
            className="py-1.5 px-4 rounded-lg text-sm font-medium transition-all bg-white dark:bg-gray-800 text-primary shadow-sm dark:shadow-gray-900">
            General
          </button>
          <button onClick={() => setTab('metricas')}
            className="py-1.5 px-4 rounded-lg text-sm font-medium transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1.5">
            {limits && !limits.puede_metricas && <Lock size={12} className="text-gray-400" />}
            Métricas
          </button>
        </div>
      </div>

      {/* KPI Cards con semáforo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        <Link to="/inventario" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
            <Package size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{(stats?.totalProductos ?? 0).toLocaleString()}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Total productos</p>
        </Link>

        <Link to="/alertas" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400">
              <AlertTriangle size={20} />
            </div>
            <span className={`w-2.5 h-2.5 rounded-full mt-1 ${SEMAFORO_COLOR[sem.alertas]}`} />
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{stats?.alertasActivas ?? 0}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Alertas activas</p>
        </Link>

        <Link to="/movimientos" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
            <ArrowDown size={20} />
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">${(stats?.ingresosHoy ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Ingresos (7d)</p>
          {(stats?.cantIngresosHoy ?? 0) > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{stats!.cantIngresosHoy} unidades</p>
          )}
        </Link>

        <Link to="/alertas" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all">
          <div className="flex items-start justify-between mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400">
              <Package size={20} />
            </div>
            <span className={`w-2.5 h-2.5 rounded-full mt-1 ${SEMAFORO_COLOR[sem.stock]}`} />
          </div>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{stats?.stockCritico ?? 0}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Stock crítico</p>
        </Link>
      </div>

      {/* Ventas del mes + Valor inventario */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-primary to-accent rounded-xl p-5 text-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <DollarSign size={18} className="text-blue-200" />
              <span className="text-blue-200 text-sm">Ventas este mes</span>
            </div>
            {trendVentas !== null && (
              <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
                ${trendVentas >= 0 ? 'bg-green-50 dark:bg-green-900/200/30 text-green-200' : 'bg-red-50 dark:bg-red-900/200/30 text-red-200'}`}>
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
          <button onClick={() => setTab('metricas')} className="inline-block mt-3 text-xs text-blue-300 hover:text-white transition-colors">
            Ver métricas completas →
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Valor del inventario</h2>
          </div>
          <p className="text-3xl font-bold text-primary">
            ${(stats?.valorInventario ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">Precio costo × stock actual</p>
          {(stats?.cantStockMuerto ?? 0) > 0 && (
            <p className="text-xs text-amber-500 mt-1">
              ⚠ ${(stats?.valorStockMuerto ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} en stock sin movimiento
            </p>
          )}
        </div>
      </div>

      {/* Productos sin movimiento — expandable */}
      {(stats?.cantStockMuerto ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setSinMovExpanded(v => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Clock size={15} className="text-amber-500" />
              <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">
                {stats!.cantStockMuerto} producto{stats!.cantStockMuerto !== 1 ? 's' : ''} sin movimiento en 30 días
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                ${(stats?.valorStockMuerto ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} inmovilizados
              </span>
            </div>
            {sinMovExpanded
              ? <ChevronUp size={15} className="text-gray-400 dark:text-gray-400 flex-shrink-0" />
              : <ChevronDown size={15} className="text-gray-400 dark:text-gray-400 flex-shrink-0" />}
          </button>
          {sinMovExpanded && (
            <div className="border-t border-gray-100 dark:border-gray-700">
              {(stats?.prodsInactivos ?? []).slice(0, 10).map((p: any) => (
                <div key={p.id} className="px-5 py-2.5 flex items-center justify-between text-sm border-b border-gray-50 dark:border-gray-700 last:border-0">
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{p.nombre}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-400 font-mono ml-2">{p.sku}</span>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-400">{p.stock_actual} en stock · ${(p.stock_actual * p.precio_costo).toLocaleString('es-AR', { maximumFractionDigits: 0 })} inmovilizados</span>
                </div>
              ))}
              {(stats?.prodsInactivos?.length ?? 0) > 10 && (
                <div className="px-5 py-2 text-xs text-gray-400 dark:text-gray-400 text-center">
                  +{(stats?.prodsInactivos?.length ?? 0) - 10} más —{' '}
                  <button onClick={() => setTab('metricas')} className="text-accent hover:underline">Ver en Métricas</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Score de Salud + Recomendaciones urgentes */}
      {score && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Score widget */}
          <Link to="/recomendaciones" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all flex items-center gap-4">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                <circle
                  cx="50" cy="50" r="40" fill="none" strokeWidth="12"
                  stroke={score.total >= 70 ? '#22c55e' : score.total >= 40 ? '#f59e0b' : '#ef4444'}
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={`${2 * Math.PI * 40 * (1 - score.total / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-gray-800 dark:text-gray-100">{score.total}</span>
              </div>
            </div>
            <div>
              <p className="font-semibold text-gray-800 dark:text-gray-100">Score de salud</p>
              <p className={`text-sm font-medium ${score.total >= 70 ? 'text-green-600 dark:text-green-400' : score.total >= 40 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
                {score.total >= 70 ? 'Negocio saludable' : score.total >= 40 ? 'Puede mejorar' : 'Necesita atención'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">Ver análisis completo →</p>
            </div>
          </Link>

          {/* Recomendaciones urgentes (2 primeras) */}
          {recomendaciones.slice(0, 2).map(r => {
            const urgente = r.tipo === 'danger' || r.tipo === 'warning'
            return (
              <Link
                key={r.id}
                to={r.link}
                className={`rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all
                  ${r.tipo === 'danger' ? 'bg-red-50 dark:bg-red-900/20 border-l-4 border-l-red-500' :
                    r.tipo === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border-l-4 border-l-amber-500' :
                    r.tipo === 'success' ? 'bg-green-50 dark:bg-green-900/20 border-l-4 border-l-green-500' :
                    'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-400'}`}
              >
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-snug">{r.titulo}</p>
                <p className={`text-xs mt-1 font-medium
                  ${r.tipo === 'danger' ? 'text-red-600 dark:text-red-400' : r.tipo === 'warning' ? 'text-amber-600 dark:text-amber-400' :
                    r.tipo === 'success' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
                  {r.impacto}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1">
                  {r.accion} <ChevronRight size={11} />
                </p>
              </Link>
            )
          })}
        </div>
      )}

      {/* Insights */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Lo que necesitás saber</h2>
          </div>
          <Link to="/recomendaciones" className="text-xs text-accent hover:underline">Ver todas →</Link>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const style = INSIGHT_STYLES[insight.tipo]
            const Icon  = INSIGHT_ICONS[insight.tipo]
            return (
              <div key={i}
                className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 border-l-4 ${style.border} ${style.bg}
                  p-4 flex items-center justify-between gap-4 shadow-sm dark:shadow-gray-900`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
                    <Icon size={16} className={style.iconColor} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-tight">{insight.titulo}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{insight.impacto}</p>
                  </div>
                </div>
                {insight.link === '/metricas' ? (
                  <button onClick={() => setTab('metricas')}
                    className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-primary whitespace-nowrap flex-shrink-0 transition-colors">
                    {insight.accion} <ChevronRight size={13} />
                  </button>
                ) : (
                  <Link to={insight.link}
                    className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-primary whitespace-nowrap flex-shrink-0 transition-colors">
                    {insight.accion} <ChevronRight size={13} />
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Sugerencia de pedido */}
      {(stats?.prodsCriticos?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <Truck size={16} className="text-blue-500 dark:text-blue-400" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Sugerencia de pedido</h2>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-400">{stats!.prodsCriticos.length} productos con stock crítico</span>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {stats!.prodsCriticos.slice(0, 8).map((p: any) => (
              <div key={p.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400 font-mono">{p.sku}</p>
                </div>
                <div className="flex items-center gap-5 flex-shrink-0 text-right text-sm">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-400">Stock / Mín.</p>
                    <p className="font-semibold text-red-500 dark:text-red-400">{p.stock_actual} / {p.stock_minimo}</p>
                  </div>
                  {p.diasCobertura !== null && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-400">Cobertura</p>
                      <p className={`font-semibold ${p.diasCobertura <= 3 ? 'text-red-500 dark:text-red-400' : p.diasCobertura <= 7 ? 'text-amber-500 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {p.diasCobertura}d
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-400">Pedir</p>
                    <p className="font-bold text-primary">{p.sugerido} u.</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {(stats?.prodsCriticos?.length ?? 0) > 8 && (
            <div className="px-5 py-2 text-xs text-gray-400 dark:text-gray-400 text-center border-t border-gray-50 dark:border-gray-700">
              +{stats!.prodsCriticos.length - 8} más con stock crítico
            </div>
          )}
        </div>
      )}

      {/* Proyección de cobertura */}
      {(stats?.proyeccionCobertura?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setCoberturaExpanded(v => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Hourglass size={15} className="text-blue-500 dark:text-blue-400" />
              <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Proyección de stock</span>
              <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                {stats!.proyeccionCobertura.length} productos con stock decreciente
              </span>
            </div>
            {coberturaExpanded
              ? <ChevronUp size={15} className="text-gray-400 dark:text-gray-400 flex-shrink-0" />
              : <ChevronDown size={15} className="text-gray-400 dark:text-gray-400 flex-shrink-0" />}
          </button>
          {coberturaExpanded && (
            <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
              <div className="px-5 py-2 grid grid-cols-4 gap-3 text-xs text-gray-400 dark:text-gray-400 font-medium uppercase tracking-wide">
                <span className="col-span-2">Producto</span>
                <span className="text-right">Stock / Mín.</span>
                <span className="text-right">Días restantes</span>
              </div>
              {stats!.proyeccionCobertura.map((p: any) => {
                const nivel = p.diasHastaCritico <= 7 ? 'red' : p.diasHastaCritico <= 14 ? 'amber' : 'green'
                return (
                  <div key={p.id} className="px-5 py-2.5 grid grid-cols-4 gap-3 items-center text-sm">
                    <div className="col-span-2 min-w-0">
                      <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nombre}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-400 font-mono">{p.sku}</p>
                    </div>
                    <p className="text-right text-gray-600 dark:text-gray-400">{p.stock_actual} / {p.stock_minimo}</p>
                    <div className="text-right">
                      <span className={`inline-block font-semibold px-2 py-0.5 rounded-full text-xs
                        ${nivel === 'red'   ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                          nivel === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                                             'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                        {p.diasHastaCritico}d
                      </span>
                    </div>
                  </div>
                )
              })}
              <div className="px-5 py-2 text-xs text-gray-400 dark:text-gray-400 text-center">
                Días estimados hasta alcanzar el stock mínimo · basado en ventas de los últimos 30 días
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom grid */}
      <div className="grid lg:grid-cols-2 gap-6">

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <ShoppingCart size={16} className="text-accent" /> Top productos este mes
            </h2>
            <button onClick={() => setTab('metricas')} className="text-xs text-accent hover:underline">Ver más →</button>
          </div>
          {topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">Sin ventas este mes</p>
          ) : (
            <div className="space-y-2">
              {topProductos.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${i === 0 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                      {i + 1}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">{p.nombre}</span>
                  </div>
                  <span className="font-semibold text-primary">{p.cantidad} u.</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Movimientos recientes</h2>
            <Link to="/movimientos" className="text-xs text-accent hover:underline">Ver todos →</Link>
          </div>
          {movRecientes.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-400 py-4 text-center">Sin movimientos aún</p>
          ) : (
            <div className="space-y-2">
              {movRecientes.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${m.tipo === 'ingreso' ? 'bg-green-50 dark:bg-green-900/200' : 'bg-blue-50 dark:bg-blue-900/200'}`} />
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">{m.productos?.nombre}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400 dark:text-gray-400">
                    <span className={`font-medium ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
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
