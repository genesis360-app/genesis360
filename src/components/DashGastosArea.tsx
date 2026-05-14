import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, PieChart, Pie,
} from 'recharts'
import {
  SlidersHorizontal, X, TrendingDown, TrendingUp, Flame, Zap,
  AlertTriangle, CheckCircle, Clock, BarChart2, DollarSign, FileText,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCotizacion } from '@/hooks/useCotizacion'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { KPICard } from '@/components/KPICard'
import { InsightCard } from '@/components/InsightCard'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type GastosPeriodo = 'mes' | 'trimestre' | 'año' | 'custom'
type Moneda = 'ARS' | 'USD'

const PERIODO_LABELS: Record<GastosPeriodo, string> = {
  mes: 'Este mes', trimestre: 'Trimestre', año: 'Año', custom: 'Custom',
}

// ─── Helpers de fecha ────────────────────────────────────────────────────────

function getGastosFechas(p: GastosPeriodo, custom?: { desde: string; hasta: string }): { desde: string; hasta: string } {
  if (p === 'custom' && custom) return custom
  const hoy = new Date()
  const hasta = new Date(hoy); hasta.setHours(23, 59, 59, 999)
  let desde = new Date(hoy)
  switch (p) {
    case 'mes':       desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); break
    case 'trimestre': desde = new Date(hoy.getFullYear(), Math.floor(hoy.getMonth() / 3) * 3, 1); break
    case 'año':       desde = new Date(hoy.getFullYear(), 0, 1); break
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

function getGastosFechasPrev(p: GastosPeriodo, custom?: { desde: string; hasta: string }): { desde: string; hasta: string } {
  const hoy = new Date()
  switch (p) {
    case 'mes': {
      const d1 = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
      const d2 = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59)
      return { desde: d1.toISOString(), hasta: d2.toISOString() }
    }
    case 'trimestre': {
      const t = Math.floor(hoy.getMonth() / 3)
      return {
        desde: new Date(hoy.getFullYear(), (t - 1) * 3, 1).toISOString(),
        hasta: new Date(hoy.getFullYear(), t * 3, 0, 23, 59, 59).toISOString(),
      }
    }
    case 'año': {
      return {
        desde: new Date(hoy.getFullYear() - 1, 0, 1).toISOString(),
        hasta: new Date(hoy.getFullYear() - 1, 11, 31, 23, 59, 59).toISOString(),
      }
    }
    case 'custom': if (custom) {
      const ms = new Date(custom.hasta).getTime() - new Date(custom.desde).getTime()
      return { desde: new Date(new Date(custom.desde).getTime() - ms).toISOString(), hasta: new Date(new Date(custom.desde).getTime() - 1).toISOString() }
    }
    default: return { desde: new Date().toISOString(), hasta: new Date().toISOString() }
  }
}

// ─── Colores para pie de categorías ──────────────────────────────────────────

const CAT_COLORS = [
  '#3B82F6', // blue
  '#06B6D4', // cyan / turquesa
  '#F59E0B', // amber / mostaza
  '#7B00FF', // lila / accent
  '#10B981', // emerald
  '#EF4444', // red
  '#EC4899', // pink
  '#8B5CF6', // violet
  '#F97316', // orange
  '#6B7280', // gray
]

// ─── Tooltip pie ──────────────────────────────────────────────────────────────

function PieTooltipGastos({ active, payload, fmt }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-sm">
      <p className="font-semibold text-gray-800 dark:text-gray-100">{d.nombre}</p>
      <p className="text-accent font-bold">{fmt(d.total)}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">{d.pct}% del total</p>
    </div>
  )
}

// ─── Tooltip barras mensuales ─────────────────────────────────────────────────

function BarTooltipMensual({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-sm">
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <p className="font-bold text-gray-800 dark:text-gray-100">{fmt(payload[0].value)}</p>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashGastosArea() {
  const { tenant } = useAuthStore()
  const { cotizacion } = useCotizacion()
  const { sucursalId } = useSucursalFilter()

  // Filtros
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodo, setPeriodo] = useState<GastosPeriodo>('mes')
  const [moneda, setMoneda] = useState<Moneda>('ARS')
  const [customDesde, setCustomDesde] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
  const [customHasta, setCustomHasta] = useState(() => new Date().toISOString())
  const [categoriaFiltro, setCategoriaFiltro] = useState('')

  const filterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const conv = moneda === 'USD' && cotizacion > 0 ? cotizacion : 1
  const sym = moneda === 'USD' ? 'U$D ' : '$'
  const fmt = (v: number) => `${sym}${(v / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  const fmtCorto = (v: number) => {
    const val = v / conv
    if (val >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(1)}M`
    if (val >= 1_000) return `${sym}${(val / 1_000).toFixed(0)}K`
    return `${sym}${val.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  }

  const customRange = { desde: customDesde, hasta: customHasta }
  const { desde, hasta } = getGastosFechas(periodo, customRange)
  const { desde: desdePrev, hasta: hastaPrev } = getGastosFechasPrev(periodo, customRange)
  const desdeDate = desde.split('T')[0]
  const hastaDate = hasta.split('T')[0]
  const desdePrevDate = desdePrev.split('T')[0]
  const hastaPrevDate = hastaPrev.split('T')[0]

  const activeFilters = [categoriaFiltro].filter(Boolean).length
  const hoy = new Date().toISOString().split('T')[0]

  // ─── Query principal ──────────────────────────────────────────────────────
  const { data: gData, isLoading } = useQuery({
    queryKey: ['dash-gastos-area', tenant?.id, desde, hasta, desdePrev, hastaPrev, categoriaFiltro, moneda, sucursalId],
    queryFn: async () => {

      // Gastos del período
      let q = supabase.from('gastos')
        .select('id, monto, categoria, descripcion, fecha, comprobante_url, iva_monto, iva_deducible, recurso_id')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', desdeDate).lte('fecha', hastaDate)
      if (categoriaFiltro) q = q.eq('categoria', categoriaFiltro)
      if (sucursalId) q = q.eq('sucursal_id', sucursalId)
      const { data: gastos = [] } = await q

      // Gastos período anterior
      let qGastosPrev = supabase.from('gastos')
        .select('monto')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', desdePrevDate).lte('fecha', hastaPrevDate)
      if (sucursalId) qGastosPrev = qGastosPrev.eq('sucursal_id', sucursalId)
      const { data: gastosPrev = [] } = await qGastosPrev

      // Gastos fijos activos (para estimación fijos vs variables)
      const { data: gastosFijos = [] } = await supabase.from('gastos_fijos')
        .select('monto, categoria, descripcion')
        .eq('tenant_id', tenant!.id).eq('activo', true)

      // Evolución mensual — últimos 6 meses (siempre, independiente del filtro)
      const seisMesesAtras = new Date()
      seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 5)
      seisMesesAtras.setDate(1)
      let qGastosHist = supabase.from('gastos')
        .select('monto, fecha')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', seisMesesAtras.toISOString().split('T')[0])
        .order('fecha')
      if (sucursalId) qGastosHist = qGastosHist.eq('sucursal_id', sucursalId)
      const { data: gastosHistorico = [] } = await qGastosHist

      // Ventas del período (para ratio Gastos/Ventas)
      let qVentas = supabase.from('ventas')
        .select('total')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', desde).lte('created_at', hasta)
      if (sucursalId) qVentas = qVentas.eq('sucursal_id', sucursalId)
      const { data: ventas = [] } = await qVentas

      // Cuotas por vencer próximos 7 días
      const en7Dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
      const { data: cuotasPorVencer = [] } = await supabase.from('gasto_cuotas')
        .select('monto, fecha_vencimiento, gasto_id')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'pendiente')
        .gte('fecha_vencimiento', hoy)
        .lte('fecha_vencimiento', en7Dias)

      // Cuotas vencidas sin pagar
      const { data: cuotasVencidas = [] } = await supabase.from('gasto_cuotas')
        .select('monto')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'pendiente')
        .lt('fecha_vencimiento', hoy)

      // ── KPI 1: Total Salidas ──────────────────────────────────────────────
      const totalGastos = (gastos ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)
      const totalGastosPrev = (gastosPrev ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)

      // ── KPI 2: Burn Rate ──────────────────────────────────────────────────
      const d1 = new Date(desdeDate), d2 = new Date(hastaDate)
      const diasPeriodo = Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / 86400000))
      const diasTranscurridos = Math.min(diasPeriodo, Math.ceil((Date.now() - d1.getTime()) / 86400000))
      const burnRate = diasTranscurridos > 0 ? totalGastos / diasTranscurridos : 0

      // Burn rate prev
      const dp1 = new Date(desdePrevDate), dp2 = new Date(hastaPrevDate)
      const diasPrev = Math.max(1, Math.ceil((dp2.getTime() - dp1.getTime()) / 86400000))
      const burnRatePrev = diasPrev > 0 ? totalGastosPrev / diasPrev : 0

      // ── KPI 3: Ratio Gastos/Ventas ────────────────────────────────────────
      const totalVentas = (ventas ?? []).reduce((a: number, v: any) => a + (v.total ?? 0), 0)
      const ratioGastosVentas = totalVentas > 0 ? (totalGastos / totalVentas) * 100 : null

      // ── KPI 4: Fijos vs Variables ─────────────────────────────────────────
      const fijosMensual = (gastosFijos ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)
      const pctFijos = totalGastos > 0
        ? Math.min(100, Math.round((fijosMensual / totalGastos) * 100))
        : 0
      const pctVariable = 100 - pctFijos

      // ── Pie por categoría ─────────────────────────────────────────────────
      const catMap: Record<string, number> = {}
      for (const g of gastos ?? []) {
        const cat = (g as any).categoria || 'Sin categoría'
        catMap[cat] = (catMap[cat] ?? 0) + ((g as any).monto ?? 0)
      }
      const catTotal = Object.values(catMap).reduce((a, b) => a + b, 0)
      const catData = Object.entries(catMap)
        .map(([nombre, total]) => ({
          nombre,
          total,
          pct: catTotal > 0 ? Math.round((total / catTotal) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total)

      // ── Evolución mensual (últimos 6 meses) ───────────────────────────────
      const monthlyMap: Record<string, number> = {}
      for (const g of gastosHistorico ?? []) {
        const key = (g as any).fecha.slice(0, 7) // YYYY-MM
        monthlyMap[key] = (monthlyMap[key] ?? 0) + ((g as any).monto ?? 0)
      }
      const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      const monthlyData = Object.entries(monthlyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, total]) => {
          const [y, m] = mes.split('-')
          return { mes, total, label: `${MESES_ES[parseInt(m, 10) - 1]} ${y.slice(2)}` }
        })
      const promedioMensual = monthlyData.length > 0
        ? monthlyData.reduce((a, m) => a + m.total, 0) / monthlyData.length
        : 0

      // ── Top 5 por descripción ─────────────────────────────────────────────
      const descMap: Record<string, number> = {}
      for (const g of gastos ?? []) {
        const desc = (g as any).descripcion || 'Sin descripción'
        descMap[desc] = (descMap[desc] ?? 0) + ((g as any).monto ?? 0)
      }
      const top5 = Object.entries(descMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([nombre, total]) => ({ nombre, total }))
      const maxTop5 = Math.max(...top5.map(t => t.total), 1)

      // ── Sin comprobante ───────────────────────────────────────────────────
      const sinComprobante = (gastos ?? []).filter((g: any) => !g.comprobante_url && !g.recurso_id)
      const montoSinComprobante = sinComprobante.reduce((a: number, g: any) => a + (g.monto ?? 0), 0)

      // ── Categorías disponibles para filtro ───────────────────────────────
      const categoriasDisp = [...new Set((gastos ?? []).map((g: any) => g.categoria).filter(Boolean))]

      // ── Categoría con mayor anomalía vs período anterior ──────────────────
      // Comparar distribución por categoría entre períodos
      const catMapPrev: Record<string, number> = {}
      let qGastosPrevCat = supabase.from('gastos')
        .select('categoria, monto')
        .eq('tenant_id', tenant!.id)
        .gte('fecha', desdePrevDate).lte('fecha', hastaPrevDate)
      if (sucursalId) qGastosPrevCat = qGastosPrevCat.eq('sucursal_id', sucursalId)
      const { data: gastosPrevCat = [] } = await qGastosPrevCat
      for (const g of gastosPrevCat ?? []) {
        const cat = (g as any).categoria || 'Sin categoría'
        catMapPrev[cat] = (catMapPrev[cat] ?? 0) + ((g as any).monto ?? 0)
      }
      let mayorAnomaliaCat = '', mayorAnomaliaPct = 0, mayorAnomaliaActual = 0
      for (const [cat, monto] of Object.entries(catMap)) {
        const montoPrevCat = catMapPrev[cat] ?? 0
        if (montoPrevCat > 0 && monto > montoPrevCat) {
          const pct = ((monto - montoPrevCat) / montoPrevCat) * 100
          if (pct > mayorAnomaliaPct) {
            mayorAnomaliaPct = pct; mayorAnomaliaCat = cat; mayorAnomaliaActual = monto
          }
        }
      }

      return {
        totalGastos, totalGastosPrev,
        burnRate, burnRatePrev,
        ratioGastosVentas,
        pctFijos, pctVariable, fijosMensual,
        catData, catTotal,
        monthlyData, promedioMensual,
        top5, maxTop5,
        sinComprobante: { count: sinComprobante.length, monto: montoSinComprobante },
        cuotasPorVencer: { count: (cuotasPorVencer ?? []).length, monto: (cuotasPorVencer ?? []).reduce((a: number, c: any) => a + (c.monto ?? 0), 0) },
        cuotasVencidas: { count: (cuotasVencidas ?? []).length, monto: (cuotasVencidas ?? []).reduce((a: number, c: any) => a + (c.monto ?? 0), 0) },
        anomalia: { cat: mayorAnomaliaCat, pct: mayorAnomaliaPct, monto: mayorAnomaliaActual },
        categoriasDisp,
        totalVentas,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  // ─── Insights ────────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    if (!gData) return []
    const list: { tipo: 'danger' | 'warning' | 'success' | 'info'; titulo: string; impacto: string; accion: string; link: string }[] = []

    // Tendencia gastos
    if (gData.totalGastosPrev > 0 && gData.totalGastos > 0) {
      const pct = ((gData.totalGastos - gData.totalGastosPrev) / gData.totalGastosPrev) * 100
      if (pct >= 20) {
        list.push({
          tipo: 'danger',
          titulo: `Los gastos subieron ${pct.toFixed(0)}% vs el período anterior`,
          impacto: `Gastaste ${fmt(gData.totalGastos - gData.totalGastosPrev)} más en el mismo período.`,
          accion: 'Ver gastos', link: '/gastos',
        })
      } else if (pct <= -15) {
        list.push({
          tipo: 'success',
          titulo: `Bajaste los gastos ${Math.abs(pct).toFixed(0)}% vs el período anterior 🎉`,
          impacto: `Ahorraste ${fmt(Math.abs(gData.totalGastos - gData.totalGastosPrev))} respecto al período anterior.`,
          accion: 'Ver gastos', link: '/gastos',
        })
      }
    }

    // Cuotas vencidas sin pagar
    if (gData.cuotasVencidas.count > 0) {
      list.push({
        tipo: 'danger',
        titulo: `${gData.cuotasVencidas.count} cuota${gData.cuotasVencidas.count !== 1 ? 's' : ''} vencida${gData.cuotasVencidas.count !== 1 ? 's' : ''} sin pagar`,
        impacto: `${fmt(gData.cuotasVencidas.monto)} en cuotas de gastos pasadas de vencimiento.`,
        accion: 'Ver gastos', link: '/gastos',
      })
    }

    // Por vencer
    if (gData.cuotasPorVencer.count > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${gData.cuotasPorVencer.count} cuota${gData.cuotasPorVencer.count !== 1 ? 's' : ''} por vencer en los próximos 7 días`,
        impacto: `${fmt(gData.cuotasPorVencer.monto)} que vencen pronto. Asegurate de tener saldo en caja.`,
        accion: 'Ver gastos', link: '/gastos',
      })
    }

    // Sin comprobante
    if (gData.sinComprobante.count >= 3 && gData.sinComprobante.monto > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${gData.sinComprobante.count} gastos sin comprobante adjunto`,
        impacto: `${fmt(gData.sinComprobante.monto)} sin respaldo fiscal. Podés estar perdiendo crédito de IVA.`,
        accion: 'Cargar comprobantes', link: '/gastos',
      })
    }

    // Anomalía por categoría
    if (gData.anomalia.cat && gData.anomalia.pct >= 30) {
      list.push({
        tipo: 'warning',
        titulo: `"${gData.anomalia.cat}" subió ${gData.anomalia.pct.toFixed(0)}% vs el período anterior`,
        impacto: `Gastaste ${fmt(gData.anomalia.monto)} en esta categoría. Revisá si hubo un gasto atípico.`,
        accion: 'Ver gastos', link: '/gastos',
      })
    }

    // Ratio gastos/ventas alto
    if (gData.ratioGastosVentas !== null && gData.ratioGastosVentas > 80) {
      list.push({
        tipo: 'danger',
        titulo: `Los gastos consumen el ${gData.ratioGastosVentas.toFixed(0)}% de tus ingresos`,
        impacto: `De cada $100 que ingresan, ${gData.ratioGastosVentas.toFixed(0)} se van en gastos de estructura. Margen muy ajustado.`,
        accion: 'Ver rentabilidad', link: '/metricas',
      })
    }

    // Gastos fijos altos (si los fijos > 60% del total)
    if (gData.pctFijos >= 65) {
      list.push({
        tipo: 'info',
        titulo: `El ${gData.pctFijos}% de tus gastos son fijos`,
        impacto: `Tu negocio tiene alta rigidez: ${fmt(gData.fijosMensual)} en gastos recurrentes que se pagan vendas o no.`,
        accion: 'Ver gastos fijos', link: '/gastos',
      })
    }

    return list.slice(0, 4)
  }, [gData, fmt])

  // ─── Helpers badge (gastos: subir = malo → invertido) ────────────────────────
  const badgeVsInv = (actual: number | null, prev: number | null) => {
    if (!actual || !prev || prev === 0) return undefined
    const pct = ((actual - prev) / Math.abs(prev)) * 100
    const color = Math.abs(pct) < 1 ? 'neutral' : pct > 0 ? 'danger' : 'success'
    return { label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs período ant.`, color } as const
  }

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Barra: contexto + botón filtros ──────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Mostrando <span className="font-medium text-primary">{PERIODO_LABELS[periodo].toLowerCase()}</span>
          {moneda === 'USD' && <span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">USD</span>}
          {categoriaFiltro && <span className="ml-1 text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">Cat: {categoriaFiltro}</span>}
        </p>

        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all
              ${filterOpen || activeFilters > 0
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}
          >
            <SlidersHorizontal size={14} />
            Filtros
            {activeFilters > 0 && (
              <span className="w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold">
                {activeFilters}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3>
                <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <X size={14} />
                </button>
              </div>

              {/* Finanzas y Tiempo */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Finanzas y tiempo</p>
                <div className="mb-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Período</p>
                  <div className="flex flex-wrap gap-1">
                    {(['mes', 'trimestre', 'año', 'custom'] as GastosPeriodo[]).map(p => (
                      <button key={p} onClick={() => setPeriodo(p)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                          ${periodo === p ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                        {PERIODO_LABELS[p]}
                      </button>
                    ))}
                  </div>
                  {periodo === 'custom' && (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <input type="date" max={hoy} value={customDesde.split('T')[0]}
                        onChange={e => setCustomDesde(new Date(e.target.value + 'T00:00:00').toISOString())}
                        className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-primary focus:outline-none focus:border-accent" />
                      <span className="text-gray-400">→</span>
                      <input type="date" max={hoy} value={customHasta.split('T')[0]}
                        onChange={e => setCustomHasta(new Date(e.target.value + 'T23:59:59').toISOString())}
                        className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-primary focus:outline-none focus:border-accent" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Moneda</p>
                  <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg w-fit">
                    {(['ARS', 'USD'] as Moneda[]).map(m => (
                      <button key={m} onClick={() => setMoneda(m)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${moneda === m ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contexto */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Contexto</p>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Categoría</p>
                  <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-primary focus:outline-none focus:border-accent">
                    <option value="">Todas las categorías</option>
                    {(gData?.categoriasDisp ?? []).map((c: string) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {activeFilters > 0 && (
                <button onClick={() => setCategoriaFiltro('')}
                  className="w-full text-xs text-gray-400 hover:text-accent transition-colors">
                  Limpiar filtros de contexto
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Capa 1: 4 KPI cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* KPI 1: Total Salidas */}
        <KPICard
          title="Total Salidas Operativas"
          value={isLoading ? '—' : fmt(gData?.totalGastos ?? 0)}
          badge={badgeVsInv(gData?.totalGastos ?? null, gData?.totalGastosPrev ?? null)}
          sub="Dinero total que salió para operar el negocio."
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
              <TrendingDown size={20} />
            </div>
          }
        />

        {/* KPI 2: Burn Rate */}
        <KPICard
          title="Velocidad de Gasto"
          value={isLoading ? '—' : (gData?.burnRate ?? 0) > 0 ? `${fmt(gData!.burnRate)}/día` : '—'}
          badge={badgeVsInv(gData?.burnRate ?? null, gData?.burnRatePrev ?? null)}
          sub="Promedio diario para mantener el negocio abierto."
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
              <Flame size={20} />
            </div>
          }
        />

        {/* KPI 3: Ratio Gastos/Ventas */}
        <KPICard
          title="Peso de la Estructura"
          value={isLoading ? '—' : gData?.ratioGastosVentas != null ? `${gData.ratioGastosVentas.toFixed(0)}%` : '—'}
          badge={gData?.ratioGastosVentas != null ? {
            label: gData.ratioGastosVentas > 80 ? 'Crítico' : gData.ratioGastosVentas > 60 ? 'Elevado' : 'Saludable',
            color: gData.ratioGastosVentas > 80 ? 'danger' : gData.ratioGastosVentas > 60 ? 'warning' : 'success',
          } : undefined}
          sub={gData?.ratioGastosVentas != null
            ? `De cada $100 que ingresan, $${gData.ratioGastosVentas.toFixed(0)} se van en gastos.`
            : 'Sin ventas registradas en el período.'}
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <DollarSign size={20} />
            </div>
          }
        />

        {/* KPI 4: Fijos vs Variables */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent">
              <BarChart2 size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted leading-snug">Rigidez del Gasto</p>
          {isLoading ? (
            <p className="text-3xl font-semibold text-primary mt-1">—</p>
          ) : (
            <>
              <p className="text-3xl font-semibold text-primary mt-1 font-mono tabular-nums">{gData?.pctFijos ?? 0}% fijo</p>
              <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
                <div className="h-full bg-accent rounded-l-full transition-all" style={{ width: `${gData?.pctFijos ?? 0}%` }} />
                <div className="h-full bg-gray-300 dark:bg-gray-600 rounded-r-full transition-all" style={{ width: `${gData?.pctVariable ?? 0}%` }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <p className="text-xs text-muted">{gData?.pctFijos ?? 0}% fijos</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                  <p className="text-xs text-muted">{gData?.pctVariable ?? 0}% variables</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Capa 2: Gráficos ─────────────────────────────────────────────────── */}

      {/* Fila 1: Pie categorías + Top 5 */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Gráfico 1: ¿A dónde se va la plata? (Pie) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">¿A dónde se va la plata?</h3>
            <span className="ml-auto text-xs text-muted">Por categoría</span>
          </div>
          {isLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (gData?.catData ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={150}>
                <PieChart>
                  <Pie
                    data={gData!.catData}
                    cx="50%" cy="50%"
                    innerRadius={35} outerRadius={60}
                    dataKey="total" paddingAngle={2} strokeWidth={0}
                  >
                    {gData!.catData.map((_: any, i: number) => (
                      <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltipGastos fmt={fmt} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
                {gData!.catData.slice(0, 8).map((c: any, i: number) => (
                  <div key={c.nombre} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                      <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{c.nombre}</span>
                    </div>
                    <span className="text-xs font-semibold text-primary flex-shrink-0">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin gastos categorizados</p>
          )}
        </div>

        {/* Gráfico 3: Top 5 por descripción (barras horizontales) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Top 5 destinos de gasto</h3>
            <span className="ml-auto text-xs text-muted">Por monto</span>
          </div>
          {isLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (gData?.top5 ?? []).length > 0 ? (
            <div className="space-y-3">
              {(gData?.top5 ?? []).map((item: any, i: number) => (
                <div key={item.nombre}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{item.nombre}</span>
                    <span className="text-xs font-semibold text-primary flex-shrink-0 tabular-nums">{fmtCorto(item.total)}</span>
                  </div>
                  <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{
                        width: `${(item.total / (gData?.maxTop5 ?? 1)) * 100}%`,
                        backgroundColor: CAT_COLORS[i % CAT_COLORS.length],
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin datos en el período</p>
          )}
        </div>
      </div>

      {/* Gráfico 2: Evolución mensual vs promedio */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Evolución vs. Referencia</h3>
          <span className="ml-auto text-xs text-muted">Últimos 6 meses</span>
        </div>
        {(gData?.promedioMensual ?? 0) > 0 && (
          <p className="text-xs text-muted mb-4 ml-5">
            Línea punteada = promedio mensual ({fmtCorto(gData!.promedioMensual)})
          </p>
        )}
        {isLoading ? (
          <div className="h-48 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
        ) : (gData?.monthlyData ?? []).length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={gData!.monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtCorto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<BarTooltipMensual fmt={fmt} />} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
              {(gData?.promedioMensual ?? 0) > 0 && (
                <ReferenceLine
                  y={gData!.promedioMensual}
                  stroke="#7B00FF"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                />
              )}
              <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {(gData?.monthlyData ?? []).map((entry: any, i: number) => (
                  <Cell
                    key={i}
                    fill={entry.total > (gData?.promedioMensual ?? 0) * 1.15 ? '#EF4444' : '#7B00FF'}
                    fillOpacity={entry.total > (gData?.promedioMensual ?? 0) * 1.15 ? 0.85 : 0.65}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted text-center py-8">Sin datos históricos de gastos</p>
        )}
        {(gData?.monthlyData ?? []).some((m: any) => m.total > (gData?.promedioMensual ?? 0) * 1.15) && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-2 flex items-center gap-1">
            <AlertTriangle size={11} /> Las barras rojas superaron el 15% del promedio mensual
          </p>
        )}
      </div>

      {/* ── Capa 3: Insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu auditor financiero</h3>
            <span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {insights.map((ins, i) => {
              const Icon = INSIGHT_ICONS[ins.tipo]
              return (
                <InsightCard
                  key={i}
                  variant={ins.tipo}
                  icon={<Icon size={15} />}
                  title={ins.titulo}
                  description={ins.impacto}
                  action={{
                    label: ins.accion,
                    onClick: () => { window.location.href = ins.link },
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {!isLoading && (gData?.totalGastos ?? 0) === 0 && (
        <div className="text-center py-12 text-muted">
          <FileText size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500 dark:text-gray-400">Sin gastos registrados en este período</p>
          <p className="text-xs mt-1">Probá cambiando el período en Filtros</p>
        </div>
      )}
    </div>
  )
}
