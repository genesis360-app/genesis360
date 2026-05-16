import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Package, AlertTriangle, ArrowDown, TrendingUp, TrendingDown,
  ShoppingCart, DollarSign, CheckCircle, Zap, ChevronRight, Clock, BarChart2,
  ChevronDown, ChevronUp, Truck, Hourglass, Lock,
  Wallet, Flame, Calculator, Activity,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { Link } from 'react-router-dom'
import { useRecomendaciones } from '@/hooks/useRecomendaciones'
import MetricasPage from './MetricasPage'
import RentabilidadPage from './RentabilidadPage'
import RecomendacionesPage from './RecomendacionesPage'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { UpgradePrompt } from '@/components/UpgradePrompt'
import { useCotizacion } from '@/hooks/useCotizacion'
import { FilterBar, getFechasDashboard, getFechasAnteriores, labelPeriodo } from '@/components/FilterBar'
import type { PeriodoDash, Moneda, IVAMode } from '@/components/FilterBar'
import { KPICard } from '@/components/KPICard'
import { InsightCard } from '@/components/InsightCard'
import type { InsightVariant } from '@/components/InsightCard'
import { VentasVsGastosChart } from '@/components/VentasVsGastosChart'
import { MixCajaChart } from '@/components/MixCajaChart'
import { DashVentasArea } from '@/components/DashVentasArea'
import { DashGastosArea } from '@/components/DashGastosArea'
import { DashProductosArea } from '@/components/DashProductosArea'
import { DashInventarioArea } from '@/components/DashInventarioArea'
import { DashClientesArea } from '@/components/DashClientesArea'
import { DashProveedoresArea } from '@/components/DashProveedoresArea'
import { DashFacturacionArea } from '@/components/DashFacturacionArea'
import { DashEnviosArea } from '@/components/DashEnviosArea'
import { DashMarketingArea } from '@/components/DashMarketingArea'
import { Component, type ReactNode } from 'react'

// Error boundary local para áreas del Dashboard — no tira la página entera
class AreaErrorBoundary extends Component<{ label: string; children: ReactNode }, { err: string | null }> {
  state = { err: null }
  static getDerivedStateFromError(e: Error) { return { err: e.message } }
  componentDidCatch(e: Error, info: any) {
    console.error(`[Dashboard ${this.props.label}] crash:`, e.message, e.stack, info?.componentStack)
  }
  render() {
    if (this.state.err) return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center space-y-2">
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Error en área {this.props.label}</p>
        <p className="text-xs text-red-500 dark:text-red-500 font-mono">{this.state.err}</p>
        <button onClick={() => this.setState({ err: null })}
          className="text-xs text-red-600 underline hover:no-underline">Reintentar</button>
      </div>
    )
    return this.props.children
  }
}

type InsightTipo = 'danger' | 'warning' | 'success' | 'info'

interface Insight {
  tipo: InsightTipo
  titulo: string
  impacto: string
  accion: string
  link: string
}

const INSIGHT_STYLES: Record<InsightTipo, { border: string; bg: string; iconColor: string; iconBg: string }> = {
  danger:  { border: 'border-l-red-500',   bg: 'bg-red-50 dark:bg-gray-800',   iconColor: 'text-red-500 dark:text-red-400',   iconBg: 'bg-red-100 dark:bg-red-900/30' },
  warning: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-gray-800', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-900/30' },
  success: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-gray-800', iconColor: 'text-green-600 dark:text-green-400', iconBg: 'bg-green-100 dark:bg-green-900/30' },
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50 dark:bg-gray-800',  iconColor: 'text-blue-600 dark:text-blue-400',  iconBg: 'bg-blue-100 dark:bg-blue-900/30' },
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
  const { sucursalId } = useSucursalFilter()
  const { score, recomendaciones } = useRecomendaciones()
  const { limits } = usePlanLimits()
  const [tab, setTab] = useState<'general' | 'metricas' | 'insights' | 'rentabilidad' | 'recomendaciones' | 'graficos'>('general')
  const [area, setArea] = useState<'todo' | 'ventas' | 'gastos' | 'productos' | 'inventario' | 'clientes' | 'proveedores' | 'facturacion' | 'envios' | 'marketing'>('todo')
  const [sinMovExpanded, setSinMovExpanded] = useState(false)
  const [coberturaExpanded, setCoberturaExpanded] = useState(false)
  const [periodo, setPeriodo] = useState<PeriodoDash>('mes')
  const [moneda, setMoneda] = useState<Moneda>('ARS')
  const [iva, setIva] = useState<IVAMode>('incluido')
  const [customDesde, setCustomDesde] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
  const [customHasta, setCustomHasta] = useState(() => new Date().toISOString())
  const { cotizacion } = useCotizacion()

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', tenant?.id, sucursalId],
    queryFn: async () => {
      const hoy = new Date()
      const inicioMes    = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
      const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString()
      const finMesAnt    = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59).toISOString()
      const hace7dias    = new Date(Date.now() - 7 * 86400000).toISOString()
      const hace30dias   = new Date(Date.now() - 30 * 86400000).toISOString()

      const fechaReservaVieja = new Date(hoy.getTime() - 3 * 86400000).toISOString()
      const inicioMesStr = inicioMes.split('T')[0]

      // Helper: agrega .eq('sucursal_id') si hay una activa
      const bySuc = <T extends object>(q: T): T =>
        sucursalId ? (q as any).eq('sucursal_id', sucursalId) : q

      const [productos, alertas, movimientos, ventasMes, ventasMesAnt, rebajesRecientes, ventasDeuda, productosInactivos, reservasViejas, gastosMes, ventasMesCosto] = await Promise.all([
        supabase.from('productos').select('id, nombre, sku, stock_actual, stock_minimo, precio_costo').eq('tenant_id', tenant!.id).eq('activo', true),
        supabase.from('alertas').select('id').eq('tenant_id', tenant!.id).eq('resuelta', false),
        bySuc(supabase.from('movimientos_stock').select('tipo, cantidad, productos(precio_costo)').eq('tenant_id', tenant!.id).gte('created_at', hace7dias)),
        bySuc(supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes)),
        bySuc(supabase.from('ventas').select('total').eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMesAnt).lte('created_at', finMesAnt)),
        bySuc(supabase.from('movimientos_stock').select('producto_id, cantidad').eq('tenant_id', tenant!.id).eq('tipo', 'rebaje').gte('created_at', hace30dias)),
        bySuc(supabase.from('ventas').select('total, monto_pagado').eq('tenant_id', tenant!.id).in('estado', ['pendiente', 'reservada'])),
        supabase.from('productos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant!.id).eq('activo', false),
        bySuc(supabase.from('ventas').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant!.id).eq('estado', 'reservada').lt('created_at', fechaReservaVieja)),
        bySuc(supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).gte('fecha', inicioMesStr)),
        supabase.from('venta_items').select('cantidad, precio_costo_historico').eq('tenant_id', tenant!.id).gte('created_at', inicioMes),
      ])

      const prods                 = productos.data ?? []
      const totalProductos        = prods.length
      const totalProductosInactivos = productosInactivos.count ?? 0
      const stockCritico          = prods.filter(p => p.stock_actual <= p.stock_minimo).length
      const valorInventario       = prods.reduce((acc, p) => acc + p.precio_costo * p.stock_actual, 0)
      // alertasActivas = alertas DB + reservas viejas (mismo cálculo que sidebar badge useAlertas)
      const alertasActivas        = (alertas.data?.length ?? 0) + (reservasViejas.count ?? 0)
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

      // Deuda pendiente: ventas pendientes/reservadas con saldo sin cobrar
      const deudaTotal = (ventasDeuda.data ?? []).reduce((acc, v) => {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        return acc + saldo
      }, 0)
      const cantDeudoras = (ventasDeuda.data ?? []).filter(v => Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0)) > 0.5).length

      // Rentabilidad neta = ventas − costo de lo vendido − gastos del mes
      const gastosTotal    = (gastosMes.data ?? []).reduce((a, g) => a + (g.monto ?? 0), 0)
      const costoVentas    = (ventasMesCosto.data ?? []).reduce((a, vi: any) => a + (vi.precio_costo_historico ?? 0) * (vi.cantidad ?? 0), 0)
      const rentabilidadNeta = totalVentasMes - costoVentas - gastosTotal
      const margenNeto = totalVentasMes > 0 ? (rentabilidadNeta / totalVentasMes) * 100 : null

      return {
        totalProductos, totalProductosInactivos, stockCritico, valorInventario, alertasActivas,
        ingresosHoy, cantIngresosHoy, rebajesHoy, totalVentasMes, cantVentasMes,
        totalVentasMesAnt, cantStockMuerto, valorStockMuerto, prodsInactivos, prodsCriticos,
        proyeccionCobertura, deudaTotal, cantDeudoras,
        gastosTotal, costoVentas, rentabilidadNeta, margenNeto,
      }
    },
    enabled: !!tenant,
  })

  const { data: movRecientes = [] } = useQuery({
    queryKey: ['movimientos-recientes', tenant?.id, sucursalId],
    queryFn: async () => {
      let q = supabase.from('movimientos_stock').select('*, productos(nombre,sku)')
        .eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(5)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data } = await q
      return data ?? []
    },
    enabled: !!tenant,
  })

  const { data: topProductos = [] } = useQuery({
    queryKey: ['dashboard-top-productos', tenant?.id, sucursalId],
    queryFn: async () => {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      let q = supabase.from('ventas')
        .select('venta_items(cantidad, productos(nombre, sku))')
        .eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data: ventas } = await q
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

  // ─── KPIs período (Ingreso Neto / Margen / Burn Rate / IVA) ─────────────────
  const customRange = { desde: customDesde, hasta: customHasta }
  const { data: dashKpis } = useQuery({
    queryKey: ['dash-kpis', tenant?.id, periodo, customDesde, customHasta, sucursalId],
    queryFn: async () => {
      const { desde, hasta } = getFechasDashboard(periodo, customRange)
      const { desde: desdePrev, hasta: hastaPrev } = getFechasAnteriores(periodo, customRange)
      const desdeDate = desde.split('T')[0]
      const hastaDate = hasta.split('T')[0]
      const desdePrevDate = desdePrev.split('T')[0]
      const hastaPrevDate = hastaPrev.split('T')[0]

      // caja_sesiones: .eq('cajas.sucursal_id') no funciona en Supabase (joined col filter)
      // → primero obtenemos los caja_ids de la sucursal, luego filtramos por ellos
      let cajaIds: string[] | null = null
      if (sucursalId) {
        const { data: cajasData } = await supabase.from('cajas')
          .select('id').eq('tenant_id', tenant!.id).eq('sucursal_id', sucursalId)
        cajaIds = (cajasData ?? []).map((c: any) => c.id)
      }

      const buildSesQ = (desde: string, hasta: string) => {
        let q = supabase.from('caja_sesiones').select('id').eq('tenant_id', tenant!.id)
          .gte('created_at', desde).lte('created_at', hasta)
        if (cajaIds) q = q.in('caja_id', cajaIds.length > 0 ? cajaIds : ['__none__'])
        return q
      }

      const [sessionsRes, sessionsPrevRes, viRes, viPrevRes, gastosRes, gastosPrevRes] = await Promise.all([
        buildSesQ(desde, hasta),
        buildSesQ(desdePrev, hastaPrev),
        supabase.from('venta_items').select('cantidad, precio_unitario, precio_costo_historico, iva_monto')
          .eq('tenant_id', tenant!.id).gte('created_at', desde).lte('created_at', hasta),
        supabase.from('venta_items').select('cantidad, precio_unitario, precio_costo_historico, iva_monto')
          .eq('tenant_id', tenant!.id).gte('created_at', desdePrev).lte('created_at', hastaPrev),
        sucursalId
          ? supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).eq('sucursal_id', sucursalId).gte('fecha', desdeDate).lte('fecha', hastaDate)
          : supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).gte('fecha', desdeDate).lte('fecha', hastaDate),
        sucursalId
          ? supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).eq('sucursal_id', sucursalId).gte('fecha', desdePrevDate).lte('fecha', hastaPrevDate)
          : supabase.from('gastos').select('monto').eq('tenant_id', tenant!.id).gte('fecha', desdePrevDate).lte('fecha', hastaPrevDate),
      ])

      // Ingreso Neto desde caja_movimientos
      let ingresoNeto = 0
      let ingresoNetoPrev = 0
      const sesIds = sessionsRes.data?.map(s => s.id) ?? []
      const sesIdsPrev = sessionsPrevRes.data?.map(s => s.id) ?? []
      if (sesIds.length > 0) {
        const { data: movs } = await supabase.from('caja_movimientos')
          .select('tipo, monto').in('sesion_id', sesIds).in('tipo', ['ingreso', 'egreso'])
        movs?.forEach(m => { ingresoNeto += m.tipo === 'ingreso' ? (m.monto ?? 0) : -(m.monto ?? 0) })
      }
      if (sesIdsPrev.length > 0) {
        const { data: movsPrev } = await supabase.from('caja_movimientos')
          .select('tipo, monto').in('sesion_id', sesIdsPrev).in('tipo', ['ingreso', 'egreso'])
        movsPrev?.forEach(m => { ingresoNetoPrev += m.tipo === 'ingreso' ? (m.monto ?? 0) : -(m.monto ?? 0) })
      }

      // Margen de contribución (markup sobre costo, usando neto sin IVA)
      let totalVentas = 0, totalCosto = 0, ivaVentas = 0
      let totalVentasPrev = 0, totalCostoPrev = 0, ivaVentasPrev = 0
      viRes.data?.forEach((vi: any) => {
        const sub = (vi.precio_unitario ?? 0) * (vi.cantidad ?? 0)
        totalVentas += sub
        if (vi.precio_costo_historico) totalCosto += vi.precio_costo_historico * vi.cantidad
        if (vi.iva_monto) ivaVentas += vi.iva_monto
      })
      viPrevRes.data?.forEach((vi: any) => {
        const sub = (vi.precio_unitario ?? 0) * (vi.cantidad ?? 0)
        totalVentasPrev += sub
        if (vi.precio_costo_historico) totalCostoPrev += vi.precio_costo_historico * vi.cantidad
        if (vi.iva_monto) ivaVentasPrev += vi.iva_monto
      })

      const totalVentasNeto = totalVentas - ivaVentas
      const totalVentasNetoPrev = totalVentasPrev - ivaVentasPrev
      const margenContrib = totalVentasNeto > 0 && totalCosto > 0
        ? ((totalVentasNeto - totalCosto) / totalCosto) * 100 : null
      const margenContribPrev = totalVentasNetoPrev > 0 && totalCostoPrev > 0
        ? ((totalVentasNetoPrev - totalCostoPrev) / totalCostoPrev) * 100 : null

      // Burn Rate diario
      const totalGastos = (gastosRes.data ?? []).reduce((a, g) => a + (g.monto ?? 0), 0)
      const totalGastosPrev = (gastosPrevRes.data ?? []).reduce((a, g) => a + (g.monto ?? 0), 0)
      const { desde: d1s, hasta: d2s } = getFechasDashboard(periodo, customRange)
      const d1 = new Date(d1s), d2 = new Date(d2s)
      const daysInPeriod = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / 86400000))
      const daysElapsed = Math.min(daysInPeriod, Math.ceil((Date.now() - d1.getTime()) / 86400000))
      const burnRate = daysElapsed > 0 ? totalGastos / daysElapsed : 0
      const { desde: dp1s, hasta: dp2s } = getFechasAnteriores(periodo, customRange)
      const daysPrev = Math.max(1, Math.ceil((new Date(dp2s).getTime() - new Date(dp1s).getTime()) / 86400000))
      const burnRatePrev = daysPrev > 0 ? totalGastosPrev / daysPrev : 0

      return {
        ingresoNeto, ingresoNetoPrev,
        margenContrib, margenContribPrev,
        burnRate, burnRatePrev,
        ivaVentas,
        totalVentas, totalCosto,
      }
    },
    enabled: !!tenant,
  })

  // ─── Fugas y Movimientos (top 8 por monto) ───────────────────────────────────
  const { data: fugasData = [] } = useQuery({
    queryKey: ['dash-fugas', tenant?.id, periodo, customDesde, customHasta, sucursalId],
    queryFn: async () => {
      const { desde, hasta } = getFechasDashboard(periodo, customRange)
      const desdeDate = desde.split('T')[0]
      const hastaDate = hasta.split('T')[0]
      let gastosQ = supabase.from('gastos').select('id, descripcion, monto, fecha')
        .eq('tenant_id', tenant!.id).gte('fecha', desdeDate).lte('fecha', hastaDate)
        .order('monto', { ascending: false }).limit(5)
      let ventasQ = supabase.from('ventas').select('id, numero, total, cliente_nombre, created_at')
        .eq('tenant_id', tenant!.id).in('estado', ['despachada', 'facturada'])
        .gte('created_at', desde).lte('created_at', hasta)
        .order('total', { ascending: false }).limit(5)
      if (sucursalId) {
        gastosQ = gastosQ.eq('sucursal_id', sucursalId)
        ventasQ = ventasQ.eq('sucursal_id', sucursalId)
      }
      const [{ data: gastos }, { data: ventas }] = await Promise.all([gastosQ, ventasQ])
      const rows = [
        ...(gastos ?? []).map(g => ({
          id: g.id, tipo: 'gasto' as const,
          descripcion: g.descripcion ?? 'Gasto',
          monto: -(g.monto ?? 0),
          fecha: g.fecha,
        })),
        ...(ventas ?? []).map(v => ({
          id: v.id, tipo: 'venta' as const,
          descripcion: v.cliente_nombre
            ? `Venta #${v.numero} — ${v.cliente_nombre}`
            : `Venta #${v.numero ?? v.id.slice(-4)}`,
          monto: v.total ?? 0,
          fecha: v.created_at?.split('T')[0] ?? '',
        })),
      ]
      return rows.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)).slice(0, 8)
    },
    enabled: !!tenant,
  })

  // ─── Stock inmovilizado (solo se carga en tab insights) ──────────────────────
  const { data: stockInmov } = useQuery({
    queryKey: ['stock-inmovilizado', tenant?.id, sucursalId],
    queryFn: async () => {
      const { data: estadosInmov } = await supabase
        .from('estados_inventario').select('id')
        .eq('tenant_id', tenant!.id).eq('es_disponible_venta', false)
      const eIds = (estadosInmov ?? []).map((e: any) => e.id)
      if (eIds.length === 0) return { unidades: 0, valor: 0, porEstado: [] as {nombre:string;color:string;unidades:number;valor:number}[] }

      let lineasQ = supabase
        .from('inventario_lineas')
        .select('cantidad, estado_id, productos(precio_costo), estados_inventario!estado_id(nombre, color)')
        .eq('tenant_id', tenant!.id).eq('activo', true).gt('cantidad', 0)
        .in('estado_id', eIds)
      if (sucursalId) lineasQ = lineasQ.eq('sucursal_id', sucursalId)
      const { data: lineas } = await lineasQ

      const unidades = (lineas ?? []).reduce((s, l: any) => s + Number(l.cantidad), 0)
      const valor    = (lineas ?? []).reduce((s, l: any) => s + Number(l.cantidad) * Number(l.productos?.precio_costo ?? 0), 0)

      const map: Record<string, {nombre:string;color:string;unidades:number;valor:number}> = {}
      for (const l of lineas ?? []) {
        const e = (l as any).estados_inventario
        if (!map[l.estado_id as string]) map[l.estado_id as string] = { nombre: e?.nombre ?? 'Sin estado', color: e?.color ?? '#888', unidades: 0, valor: 0 }
        map[l.estado_id as string].unidades += Number(l.cantidad)
        map[l.estado_id as string].valor    += Number(l.cantidad) * Number((l as any).productos?.precio_costo ?? 0)
      }
      return { unidades, valor, porEstado: Object.values(map).sort((a, b) => b.unidades - a.unidades) }
    },
    enabled: !!tenant && tab === 'insights',
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

  const tabButtons = (active: typeof tab) => (
    <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl flex-wrap">
      {([
        { id: 'general'         as const, label: 'General' },
        { id: 'insights'        as const, label: 'Insights' },
        { id: 'metricas'        as const, label: 'Métricas',        lock: limits && !limits.puede_metricas },
        { id: 'rentabilidad'    as const, label: 'Rentabilidad' },
        { id: 'recomendaciones' as const, label: 'Recomendaciones' },
        { id: 'graficos'        as const, label: 'Gráficos' },
      ]).map(({ id, label, lock }) => (
        <button key={id} onClick={() => setTab(id)}
          className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
            ${active === id
              ? 'bg-white dark:bg-gray-800 text-primary shadow-sm dark:shadow-gray-900'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          {lock && <Lock size={12} className="text-gray-400" />}
          {label}
        </button>
      ))}
    </div>
  )

  if (tab === 'insights') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
          </div>
          {tabButtons('insights')}
        </div>

        {/* Score de salud */}
        {score && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900">
            <div className="flex items-center gap-5">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  <circle cx="50" cy="50" r="40" fill="none" strokeWidth="12"
                    stroke={score.total >= 70 ? '#22c55e' : score.total >= 40 ? '#f59e0b' : '#ef4444'}
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - score.total / 100)}`}
                    strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold text-gray-800 dark:text-gray-100">{score.total}</span>
                </div>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-lg">Score de salud del negocio</p>
                <p className={`text-sm font-medium mt-0.5 ${score.total >= 70 ? 'text-green-600 dark:text-green-400' : score.total >= 40 ? 'text-amber-500 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
                  {score.total >= 70 ? 'Negocio saludable' : score.total >= 40 ? 'Puede mejorar' : 'Necesita atención'}
                </p>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {([
                    { label: 'Rotación',      val: score.rotacion,     max: 20 },
                    { label: 'Rentabilidad',  val: score.rentabilidad, max: 25 },
                    { label: 'Reservas',      val: score.reservas,     max: 20 },
                    { label: 'Crecimiento',   val: score.crecimiento,  max: 20 },
                    { label: 'Datos',         val: score.datos,        max: 15 },
                  ]).map(d => (
                    <div key={d.label} className="text-center">
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{d.label}</p>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full" style={{ width: `${(d.val / d.max) * 100}%` }} />
                      </div>
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mt-1">{d.val}/{d.max}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI stock inmovilizado */}
        {stockInmov && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                <Package size={15} className="text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Stock inmovilizado</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Unidades en estados no disponibles para la venta</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
                  {stockInmov.unidades.toLocaleString('es-AR')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">unidades</p>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
                  ${stockInmov.valor.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">valor a costo</p>
              </div>
            </div>
            {stockInmov.porEstado.length > 0 && (
              <div className="space-y-2">
                {stockInmov.porEstado.map(e => (
                  <div key={e.nombre} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <span className="text-gray-600 dark:text-gray-300">{e.nombre}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>{e.unidades.toLocaleString('es-AR')} ud.</span>
                      <span className="font-medium">${e.valor.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stockInmov.unidades === 0 && (
              <p className="text-sm text-green-600 dark:text-green-400 text-center">✓ Sin stock inmovilizado</p>
            )}
          </div>
        )}

        {/* Lista completa de recomendaciones */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">
              {recomendaciones.length} insight{recomendaciones.length !== 1 ? 's' : ''} detectado{recomendaciones.length !== 1 ? 's' : ''}
            </h2>
          </div>
          <div className="space-y-3">
            {recomendaciones.map(r => {
              const style = INSIGHT_STYLES[r.tipo]
              const Icon  = INSIGHT_ICONS[r.tipo]
              return (
                <div key={r.id}
                  className={`rounded-xl border-l-4 ${style.border} ${style.bg} p-4 shadow-sm dark:shadow-gray-900`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${style.iconBg}`}>
                      <Icon size={17} className={style.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{r.titulo}</p>
                      <p className={`text-xs font-medium mt-0.5 ${style.iconColor}`}>{r.impacto}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">{r.descripcion}</p>
                      <div className="mt-2.5">
                        {r.link === '/metricas' ? (
                          <button onClick={() => setTab('metricas')}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-primary transition-colors">
                            {r.accion} <ChevronRight size={12} />
                          </button>
                        ) : (
                          <Link to={r.link}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-primary transition-colors">
                            {r.accion} <ChevronRight size={12} />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  if (tab === 'graficos') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-primary">{tenant?.nombre ?? 'Dashboard'}</h1>
          {tabButtons('graficos')}
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <BarChart2 size={40} className="mb-3 opacity-30" />
          <p className="font-medium text-gray-500 dark:text-gray-400">Gráficos avanzados</p>
          <p className="text-sm mt-1 text-center max-w-xs">Esta sección está en desarrollo. Próximamente encontrarás todos los gráficos del negocio en un solo lugar.</p>
        </div>
      </div>
    )
  }

  if (tab === 'metricas') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
          </div>
          {tabButtons('metricas')}
        </div>
        {limits && !limits.puede_metricas
          ? <UpgradePrompt feature="metricas" />
          : <MetricasPage hideHeader />
        }
      </div>
    )
  }

  if (tab === 'rentabilidad') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
          </div>
          {tabButtons('rentabilidad')}
        </div>
        <RentabilidadPage hideHeader />
      </div>
    )
  }

  if (tab === 'recomendaciones') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{tenant?.nombre}</p>
          </div>
          {tabButtons('recomendaciones')}
        </div>
        <RecomendacionesPage hideHeader />
      </div>
    )
  }

  // ─── Helpers de formato ──────────────────────────────────────────────────────
  const conv   = moneda === 'USD' && cotizacion > 0 ? cotizacion : 1
  const sym    = moneda === 'USD' ? 'U$D ' : '$'
  const fmtARS = (v: number) => `${sym}${(v / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  const fmtPct = (v: number) => `${v.toFixed(1)}%`

  // Ajuste por IVA
  const ajustarIva = (valor: number, ivaMontoAsoc = 0) =>
    iva === 'excluido' ? valor - ivaMontoAsoc : valor

  // Badges comparativas
  const badgeVsAnterior = (actual: number | null, anterior: number | null, invertido = false) => {
    if (actual === null || anterior === null || anterior === 0) return undefined
    const pct = ((actual - anterior) / Math.abs(anterior)) * 100
    const positivo = invertido ? pct < 0 : pct > 0
    const color = Math.abs(pct) < 1 ? 'neutral' : positivo ? 'success' : 'danger'
    const label = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs período ant.`
    return { label, color } as const
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-primary">{tenant?.nombre ?? 'Dashboard'}</h1>
        {tabButtons('general')}
      </div>

      {/* Sub-navegación de área */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { id: 'todo'        as const, label: 'Todo' },
          { id: 'ventas'      as const, label: 'Ventas' },
          { id: 'gastos'      as const, label: 'Gastos' },
          { id: 'productos'   as const, label: 'Productos' },
          { id: 'inventario'  as const, label: 'Inventario' },
          { id: 'clientes'    as const, label: 'Clientes' },
          { id: 'proveedores' as const, label: 'Proveedores' },
          { id: 'facturacion' as const, label: 'Facturación' },
          { id: 'envios'      as const, label: 'Envíos' },
          { id: 'marketing'   as const, label: 'Marketing' },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setArea(id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border
              ${area === id
                ? 'bg-accent text-white border-accent shadow-sm'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {area === 'ventas'      && <AreaErrorBoundary label="Ventas"><DashVentasArea /></AreaErrorBoundary>}
      {area === 'gastos'      && <AreaErrorBoundary label="Gastos"><DashGastosArea /></AreaErrorBoundary>}
      {area === 'productos'   && <AreaErrorBoundary label="Productos"><DashProductosArea /></AreaErrorBoundary>}
      {area === 'inventario'  && <AreaErrorBoundary label="Inventario"><DashInventarioArea /></AreaErrorBoundary>}
      {area === 'clientes'    && <AreaErrorBoundary label="Clientes"><DashClientesArea /></AreaErrorBoundary>}
      {area === 'proveedores' && <AreaErrorBoundary label="Proveedores"><DashProveedoresArea /></AreaErrorBoundary>}
      {area === 'facturacion' && <AreaErrorBoundary label="Facturación"><DashFacturacionArea /></AreaErrorBoundary>}
      {area === 'envios'      && <AreaErrorBoundary label="Envíos"><DashEnviosArea /></AreaErrorBoundary>}
      {area === 'marketing'   && <AreaErrorBoundary label="Marketing"><DashMarketingArea /></AreaErrorBoundary>}

      {/* ── Área: TODO + otras (mantienen contenido existente) ────────────────── */}
      {area !== 'ventas' && area !== 'gastos' && area !== 'productos' && area !== 'inventario'
        && area !== 'clientes' && area !== 'proveedores' && area !== 'facturacion'
        && area !== 'envios' && area !== 'marketing' && area !== 'todo' && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <BarChart2 size={36} className="mb-3 opacity-30" />
          <p className="font-medium text-gray-500 dark:text-gray-400">
            Vista {(area as string).charAt(0).toUpperCase() + (area as string).slice(1)}
          </p>
          <p className="text-sm mt-1">Próximamente — en desarrollo</p>
        </div>
      )}

      {/* ── Área: TODO — contenido existente ─────────────────────────────────── */}
      {area === 'todo' && (<>

      {/* FilterBar */}
      <FilterBar
        periodo={periodo} setPeriodo={setPeriodo}
        moneda={moneda} setMoneda={setMoneda}
        iva={iva} setIva={setIva}
        customDesde={customDesde} customHasta={customHasta}
        onCustomChange={(d, h) => { setCustomDesde(d); setCustomHasta(h) }}
      />

      {/* ── 4 KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Ingreso Neto (Caja Real) */}
        <KPICard
          title="Ingreso Neto (Caja)"
          value={dashKpis ? fmtARS(dashKpis.ingresoNeto) : '—'}
          badge={badgeVsAnterior(dashKpis?.ingresoNeto ?? null, dashKpis?.ingresoNetoPrev ?? null)}
          sub={`Efectivo ${labelPeriodo(periodo)}`}
          icon={<div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"><Wallet size={20} /></div>}
        />

        {/* Margen de Contribución */}
        <KPICard
          title="Margen Contribución"
          value={dashKpis?.margenContrib != null ? fmtPct(dashKpis.margenContrib) : '—'}
          badge={(() => {
            if (!dashKpis?.margenContrib) return undefined
            const m = dashKpis.margenContrib
            return {
              label: m >= 30 ? 'Saludable' : m >= 15 ? 'Ajustado' : 'Bajo',
              color: m >= 30 ? 'success' : m >= 15 ? 'warning' : 'danger',
            } as const
          })()}
          sub={dashKpis?.margenContrib == null ? 'Sin datos de costo' : `${fmtARS(ajustarIva(dashKpis.totalVentas - dashKpis.totalCosto))} ganancia bruta`}
          icon={<div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"><TrendingUp size={20} /></div>}
          onClick={() => setTab('rentabilidad')}
        />

        {/* Burn Rate Diario */}
        <KPICard
          title="Burn Rate Diario"
          value={dashKpis && dashKpis.burnRate > 0 ? `${fmtARS(dashKpis.burnRate)}/día` : '—'}
          badge={badgeVsAnterior(dashKpis?.burnRate ?? null, dashKpis?.burnRatePrev ?? null, true)}
          sub={`Gasto promedio diario ${labelPeriodo(periodo)}`}
          icon={<div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"><Flame size={20} /></div>}
        />

        {/* Posición IVA Técnica */}
        <KPICard
          title="Posición IVA"
          value={dashKpis && dashKpis.ivaVentas > 0 ? fmtARS(dashKpis.ivaVentas) : '—'}
          badge={dashKpis && dashKpis.ivaVentas > 0
            ? { label: 'Débito fiscal', color: 'warning' }
            : undefined}
          sub={dashKpis && dashKpis.ivaVentas > 0
            ? 'IVA ventas del período'
            : 'Sin IVA discriminado'}
          icon={<div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Calculator size={20} /></div>}
        />
      </div>

      {/* ── Gráficos: La Balanza + El Mix de Caja ───────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">La Balanza</h2>
            <span className="ml-auto text-xs text-muted">Ventas vs Gastos · {labelPeriodo(periodo)}</span>
          </div>
          <VentasVsGastosChart periodo={periodo} moneda={moneda} cotizacion={conv} />
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={16} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">El Mix de Caja</h2>
            <span className="ml-auto text-xs text-muted">Origen de fondos · {labelPeriodo(periodo)}</span>
          </div>
          <MixCajaChart periodo={periodo} moneda={moneda} cotizacion={conv} />
        </div>
      </div>

      {/* ── Insights automáticos ─────────────────────────────────────────────── */}
      {recomendaciones.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-accent" />
              <h2 className="font-semibold text-gray-700 dark:text-gray-300">Insights automáticos</h2>
              <span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{recomendaciones.length}</span>
            </div>
            <button onClick={() => setTab('insights')} className="text-xs text-accent hover:underline">Ver todos →</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {recomendaciones.slice(0, 4).map(r => {
              const iconMap = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }
              const Icon = iconMap[r.tipo]
              return (
                <InsightCard
                  key={r.id}
                  variant={r.tipo as InsightVariant}
                  icon={<Icon size={16} />}
                  title={r.titulo}
                  description={r.impacto}
                  action={{
                    label: r.accion,
                    onClick: () => r.link === '/metricas' ? setTab('metricas') : window.location.href = r.link,
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Fugas y Movimientos ──────────────────────────────────────────────── */}
      {fugasData.length > 0 && (
        <div className="bg-surface border border-border-ds rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-ds flex items-center gap-2">
            <ShoppingCart size={16} className="text-accent" />
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Fugas y Movimientos</h2>
            <span className="ml-auto text-xs text-muted">Top 8 por monto · {labelPeriodo(periodo)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted uppercase">Descripción</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted uppercase hidden sm:table-cell">Tipo</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-muted uppercase">Monto</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-muted uppercase hidden md:table-cell">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {fugasData.map((row: any) => (
                  <tr key={`${row.tipo}-${row.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-5 py-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{row.descripcion}</td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
                        ${row.tipo === 'venta'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {row.tipo === 'venta' ? 'Venta' : 'Gasto'}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${row.monto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {row.monto >= 0 ? '+' : ''}{fmtARS(Math.abs(row.monto))}
                    </td>
                    <td className="px-5 py-3 text-right text-muted text-xs hidden md:table-cell">
                      {row.fecha ? new Date(row.fecha + (row.fecha.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Secciones existentes (sin movimiento, proyección, crítico, etc.) ── */}

      {/* Productos sin movimiento — expandable */}
      {(stats?.cantStockMuerto ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 overflow-hidden">
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
          <Link to="/recomendaciones" className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900 hover:shadow-md transition-all flex items-center gap-4">
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
                className={`rounded-xl p-4 shadow-sm hover:shadow-md transition-all
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
                className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${style.border} ${style.bg}
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
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 overflow-hidden">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900 overflow-hidden">
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

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900">
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

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm dark:shadow-gray-900">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300">Movimientos recientes</h2>
            <Link to="/inventario" className="text-xs text-accent hover:underline">Ver todos →</Link>
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
      </>)}  {/* end area === 'todo' */}
    </div>
  )
}
