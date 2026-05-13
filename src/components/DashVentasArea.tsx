import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import {
  SlidersHorizontal, X, ChevronRight, ShoppingCart, Users, BarChart2,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, Zap,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCotizacion } from '@/hooks/useCotizacion'
import { KPICard } from '@/components/KPICard'
import { InsightCard } from '@/components/InsightCard'
import { Link } from 'react-router-dom'

// ─── Tipos y helpers ──────────────────────────────────────────────────────────

type VentasPeriodo = 'hoy' | '7d' | '15d' | '30d' | 'mes' | 'año' | 'custom'
type Moneda = 'ARS' | 'USD'
type IVAMode = 'incluido' | 'excluido'

const PERIODO_LABELS: Record<VentasPeriodo, string> = {
  hoy: 'Hoy', '7d': '7D', '15d': '15D', '30d': '30D',
  mes: 'Mes', año: 'Año', custom: 'Custom',
}

function getVentasFechas(p: VentasPeriodo, custom?: { desde: string; hasta: string }): { desde: string; hasta: string } {
  if (p === 'custom' && custom) return custom
  const hoy = new Date()
  const hasta = new Date(hoy); hasta.setHours(23, 59, 59, 999)
  let desde = new Date(hoy)
  switch (p) {
    case 'hoy': desde.setHours(0, 0, 0, 0); break
    case '7d':  desde = new Date(Date.now() - 7 * 86400000); desde.setHours(0, 0, 0, 0); break
    case '15d': desde = new Date(Date.now() - 15 * 86400000); desde.setHours(0, 0, 0, 0); break
    case '30d': desde = new Date(Date.now() - 30 * 86400000); desde.setHours(0, 0, 0, 0); break
    case 'mes': desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); break
    case 'año': desde = new Date(hoy.getFullYear(), 0, 1); break
    default: desde.setHours(0, 0, 0, 0)
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

function getVentasFechasPrev(p: VentasPeriodo, custom?: { desde: string; hasta: string }): { desde: string; hasta: string } {
  const hoy = new Date()
  switch (p) {
    case 'hoy': {
      const d = new Date(hoy); d.setDate(d.getDate() - 1)
      return {
        desde: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).toISOString(),
        hasta: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString(),
      }
    }
    case '7d':  return { desde: new Date(Date.now() - 14 * 86400000).toISOString(), hasta: new Date(Date.now() - 7 * 86400000).toISOString() }
    case '15d': return { desde: new Date(Date.now() - 30 * 86400000).toISOString(), hasta: new Date(Date.now() - 15 * 86400000).toISOString() }
    case '30d': return { desde: new Date(Date.now() - 60 * 86400000).toISOString(), hasta: new Date(Date.now() - 30 * 86400000).toISOString() }
    case 'mes': {
      const d1 = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
      const d2 = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59)
      return { desde: d1.toISOString(), hasta: d2.toISOString() }
    }
    case 'año': {
      return { desde: new Date(hoy.getFullYear() - 1, 0, 1).toISOString(), hasta: new Date(hoy.getFullYear() - 1, 11, 31, 23, 59, 59).toISOString() }
    }
    case 'custom': if (custom) {
      const ms = new Date(custom.hasta).getTime() - new Date(custom.desde).getTime()
      return { desde: new Date(new Date(custom.desde).getTime() - ms).toISOString(), hasta: new Date(new Date(custom.desde).getTime() - 1).toISOString() }
    }
    default: return { desde: new Date().toISOString(), hasta: new Date().toISOString() }
  }
}

// ─── Colores canales ──────────────────────────────────────────────────────────

const CANAL_DISPLAY: Record<string, string> = {
  POS: 'Presencial', pos: 'Presencial', presencial: 'Presencial',
  tiendanube: 'TiendaNube', TiendaNube: 'TiendaNube',
  mercadolibre: 'MercadoLibre', MercadoLibre: 'MercadoLibre',
  whatsapp: 'WhatsApp', WhatsApp: 'WhatsApp',
}
const CANAL_COLORS = ['#7B00FF', '#00C8E0', '#F59E0B', '#22C55E', '#EF4444', '#6B7280', '#EC4899', '#3B82F6']

// ─── Heatmap ─────────────────────────────────────────────────────────────────
// Display: Dom=col0, Lun=col1... Sáb=col6 → ordenados Lun–Dom en pantalla

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAY_JS_ORDER = [1, 2, 3, 4, 5, 6, 0] // Lun=1...Dom=0 en JS
const HOUR_START = 7
const HOUR_END = 22 // 7hs a 22hs inclusive

function buildHeatmapMatrix(ventas: any[]): number[][] {
  // [7 days display order][18 hours]
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(HOUR_END - HOUR_START + 1).fill(0))
  for (const v of ventas) {
    const d = new Date(v.created_at)
    const jsDay = d.getDay() // 0=Sun...6=Sat
    const displayIdx = DAY_JS_ORDER.indexOf(jsDay)
    if (displayIdx === -1) continue
    const hour = d.getHours()
    if (hour < HOUR_START || hour > HOUR_END) continue
    matrix[displayIdx][hour - HOUR_START]++
  }
  return matrix
}

function HeatmapChart({ matrix }: { matrix: number[][] }) {
  const maxVal = Math.max(1, ...matrix.flat())
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 480 }}>
        {/* Hour labels */}
        <div className="flex mb-1 ml-10">
          {hours.filter((_, i) => i % 2 === 0).map(h => (
            <div key={h} style={{ width: `${100 / Math.ceil(hours.length / 2)}%` }}
              className="text-center text-[9px] text-gray-400 dark:text-gray-500">
              {h}h
            </div>
          ))}
        </div>
        {/* Rows */}
        {DAY_LABELS.map((day, di) => (
          <div key={day} className="flex items-center gap-0.5 mb-0.5">
            <span className="w-9 text-right text-[10px] text-gray-400 dark:text-gray-500 pr-1.5 flex-shrink-0">{day}</span>
            {matrix[di].map((val, hi) => {
              const intensity = val / maxVal
              return (
                <div key={hi}
                  title={`${day} ${HOUR_START + hi}:00 — ${val} venta${val !== 1 ? 's' : ''}`}
                  className="flex-1 rounded-sm cursor-default transition-all"
                  style={{
                    height: 18,
                    backgroundColor: intensity === 0
                      ? 'rgb(243 244 246)' // gray-100
                      : `rgba(123, 0, 255, ${Math.max(0.12, intensity)})`,
                  }}
                />
              )
            })}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 justify-end">
          <span className="text-[9px] text-gray-400 dark:text-gray-500">Menos</span>
          {[0.12, 0.3, 0.55, 0.75, 1.0].map((op, i) => (
            <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(123, 0, 255, ${op})` }} />
          ))}
          <span className="text-[9px] text-gray-400 dark:text-gray-500">Más</span>
        </div>
      </div>
    </div>
  )
}

// ─── Funnel ───────────────────────────────────────────────────────────────────

function FunnelChart({ data, fmt }: {
  data: { label: string; count: number; monto: number; color: string }[]
  fmt: (v: number) => string
}) {
  const maxMonto = Math.max(...data.map(d => d.monto), 1)
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{d.label}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 dark:text-gray-500">{d.count} op.</span>
              <span className="text-sm font-semibold" style={{ color: d.color }}>{fmt(d.monto)}</span>
            </div>
          </div>
          <div className="h-8 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
            <div
              className="h-full rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
              style={{
                width: `${Math.max(4, (d.monto / maxMonto) * 100)}%`,
                backgroundColor: d.color,
                opacity: 1 - i * 0.2,
              }}
            >
              {(d.monto / maxMonto) > 0.25 && (
                <span className="text-white text-xs font-medium">
                  {maxMonto > 0 ? Math.round((d.monto / maxMonto) * 100) : 0}%
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Pie custom tooltip ───────────────────────────────────────────────────────

function PieTooltipCustom({ active, payload, fmt }: any) {
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

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashVentasArea() {
  const { tenant } = useAuthStore()
  const { cotizacion } = useCotizacion()

  // Filtros internos
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodo, setPeriodo] = useState<VentasPeriodo>('mes')
  const [moneda, setMoneda] = useState<Moneda>('ARS')
  const [iva, setIva] = useState<IVAMode>('incluido')
  const [customDesde, setCustomDesde] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
  const [customHasta, setCustomHasta] = useState(() => new Date().toISOString())
  const [canal, setCanal] = useState('')

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
  const fmtPct = (v: number) => `${v.toFixed(1)}%`

  const customRange = { desde: customDesde, hasta: customHasta }
  const { desde, hasta } = getVentasFechas(periodo, customRange)
  const { desde: desdePrev, hasta: hastaPrev } = getVentasFechasPrev(periodo, customRange)

  const activeFilters = [canal].filter(Boolean).length
  const hoy = new Date().toISOString().split('T')[0]

  // ─── Data query ──────────────────────────────────────────────────────────────
  const { data: vData, isLoading } = useQuery({
    queryKey: ['dash-ventas-area', tenant?.id, desde, hasta, desdePrev, hastaPrev, canal, moneda, iva],
    queryFn: async () => {
      // Ventas del período
      let q = supabase.from('ventas')
        .select('id, total, monto_pagado, estado, origen, created_at, cliente_id')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .neq('estado', 'cancelada')
      if (canal) q = q.eq('origen', canal)
      const { data: ventasRaw = [] } = await q

      // Ventas del período anterior (solo confirmadas)
      const { data: ventasPrev = [] } = await supabase.from('ventas')
        .select('total')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', desdePrev).lte('created_at', hastaPrev)
        .in('estado', ['despachada', 'facturada'])

      const ventas = ventasRaw ?? []
      const ventasConf = ventas.filter((v: any) => ['despachada', 'facturada'].includes(v.estado))

      // ── KPI 1: Total Vendido ──────────────────────────────────────────────────
      const totalVendido = ventasConf.reduce((a: number, v: any) => a + (v.total ?? 0), 0)
      const totalVendidoPrev = (ventasPrev ?? []).reduce((a: number, v: any) => a + (v.total ?? 0), 0)

      // ── KPI 2: Gasto promedio por cliente ────────────────────────────────────
      const clientesSet = new Set(ventasConf.map((v: any) => v.cliente_id).filter(Boolean))
      const gastoPromCliente = clientesSet.size > 0 ? totalVendido / clientesSet.size : 0

      // ── KPI 3: Efectividad de presupuestos ───────────────────────────────────
      const totalEmitidas = ventas.length
      const totalConfirmadas = ventasConf.length
      const efectividad = totalEmitidas >= 3 ? (totalConfirmadas / totalEmitidas) * 100 : null

      // ── KPI 4: Nuevos vs Frecuentes ──────────────────────────────────────────
      let pctFrecuentes = 0, pctNuevos = 0, cantNuevos = 0, cantFrecuentes = 0
      const clienteIds = Array.from(clientesSet) as string[]
      if (clienteIds.length > 0 && clienteIds.length <= 200) {
        const { data: historial = [] } = await supabase.from('ventas')
          .select('cliente_id')
          .eq('tenant_id', tenant!.id)
          .in('cliente_id', clienteIds)
          .in('estado', ['despachada', 'facturada'])
          .lt('created_at', desde)
          .limit(500)
        const frecuentesSet = new Set((historial ?? []).map((v: any) => v.cliente_id))
        cantFrecuentes = clienteIds.filter(id => frecuentesSet.has(id)).length
        cantNuevos = clienteIds.length - cantFrecuentes
        pctFrecuentes = clienteIds.length > 0 ? Math.round((cantFrecuentes / clienteIds.length) * 100) : 0
        pctNuevos = 100 - pctFrecuentes
      }

      // ── Chart 1: Funnel ───────────────────────────────────────────────────────
      const montoPresupuestado = ventas.reduce((a: number, v: any) => a + (v.total ?? 0), 0)
      const ventasPendCobro = ventasConf.filter((v: any) => (v.monto_pagado ?? 0) < (v.total ?? 0) - 0.5)
      const ventasPagadas = ventasConf.filter((v: any) => (v.monto_pagado ?? 0) >= (v.total ?? 0) - 0.5)
      const montoPendCobro = ventasPendCobro.reduce((a: number, v: any) => a + ((v.total ?? 0) - (v.monto_pagado ?? 0)), 0)
      const montoPagado = ventasPagadas.reduce((a: number, v: any) => a + (v.total ?? 0), 0)

      // ── Chart 2: Heatmap ──────────────────────────────────────────────────────
      const heatmap = buildHeatmapMatrix(ventasConf)

      // ── Chart 3: Canal (Pie) ──────────────────────────────────────────────────
      const canalMap: Record<string, { total: number; count: number }> = {}
      for (const v of ventasConf) {
        const raw = v.origen ?? 'Presencial'
        const key = CANAL_DISPLAY[raw] ?? raw
        if (!canalMap[key]) canalMap[key] = { total: 0, count: 0 }
        canalMap[key].total += v.total ?? 0
        canalMap[key].count++
      }
      const canalTotal = Object.values(canalMap).reduce((a, b) => a + b.total, 0)
      const canalData = Object.entries(canalMap)
        .map(([nombre, { total, count }]) => ({
          nombre,
          total,
          count,
          pct: canalTotal > 0 ? Math.round((total / canalTotal) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total)

      // ── Canales disponibles (para filtro) ────────────────────────────────────
      const { data: canalOpts } = await supabase.from('ventas')
        .select('origen')
        .eq('tenant_id', tenant!.id)
        .not('origen', 'is', null)
        .limit(200)
      const canalesDisp = [...new Set((canalOpts ?? []).map((v: any) => v.origen).filter(Boolean))]

      return {
        totalVendido, totalVendidoPrev,
        gastoPromCliente,
        efectividad, totalEmitidas, totalConfirmadas,
        pctFrecuentes, pctNuevos, cantNuevos, cantFrecuentes,
        funnelData: {
          presupuestado: { count: ventas.length, monto: montoPresupuestado },
          pendienteCobro: { count: ventasPendCobro.length, monto: montoPendCobro },
          pagado: { count: ventasPagadas.length, monto: montoPagado },
        },
        heatmap,
        canalData,
        canalesDisp,
        ventasConf,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  // ─── Insights ────────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    if (!vData) return []
    const list: { tipo: 'danger' | 'warning' | 'success' | 'info'; titulo: string; impacto: string; accion: string; link: string }[] = []

    // Tendencia ventas
    if (vData.totalVendidoPrev > 0 && vData.totalVendido > 0) {
      const pct = ((vData.totalVendido - vData.totalVendidoPrev) / vData.totalVendidoPrev) * 100
      if (pct <= -15) {
        list.push({
          tipo: 'warning', titulo: `Las ventas cayeron ${Math.abs(pct).toFixed(0)}% vs el período anterior`,
          impacto: `Facturaste ${fmt(Math.abs(vData.totalVendido - vData.totalVendidoPrev))} menos.`,
          accion: 'Analizar métricas', link: '/historial',
        })
      } else if (pct >= 15) {
        list.push({
          tipo: 'success', titulo: `Las ventas crecieron ${pct.toFixed(0)}% vs el período anterior 🎉`,
          impacto: `Facturaste ${fmt(vData.totalVendido - vData.totalVendidoPrev)} más.`,
          accion: 'Ver ventas', link: '/ventas',
        })
      }
    }

    // Pendiente de cobro
    if (vData.funnelData.pendienteCobro.monto > 0) {
      list.push({
        tipo: 'danger',
        titulo: `${fmt(vData.funnelData.pendienteCobro.monto)} pendientes de cobro`,
        impacto: `${vData.funnelData.pendienteCobro.count} venta${vData.funnelData.pendienteCobro.count !== 1 ? 's' : ''} confirmada${vData.funnelData.pendienteCobro.count !== 1 ? 's' : ''} con saldo sin cobrar.`,
        accion: 'Ver ventas', link: '/ventas',
      })
    }

    // Efectividad presupuestos baja
    if (vData.efectividad !== null && vData.efectividad < 50 && vData.totalEmitidas >= 5) {
      list.push({
        tipo: 'warning',
        titulo: `Efectividad baja: ${vData.efectividad.toFixed(0)}% de las ventas se confirman`,
        impacto: `De ${vData.totalEmitidas} ventas iniciadas, solo ${vData.totalConfirmadas} se cerraron. Los presupuestos se están enfriando.`,
        accion: 'Ver historial', link: '/historial',
      })
    }

    // Fidelidad: recurrentes
    if (vData.cantFrecuentes + vData.cantNuevos >= 5) {
      if (vData.pctFrecuentes >= 60) {
        list.push({
          tipo: 'success',
          titulo: `Alta fidelidad: el ${vData.pctFrecuentes}% de tus compradores son recurrentes`,
          impacto: `${vData.cantFrecuentes} clientes que ya compraron antes volvieron en este período.`,
          accion: 'Ver clientes', link: '/clientes',
        })
      } else if (vData.pctNuevos >= 70) {
        list.push({
          tipo: 'info',
          titulo: `${vData.pctNuevos}% de compradores son nuevos — excelente captación`,
          impacto: 'Alta adquisición. El desafío ahora es retenerlos y lograr su segunda compra.',
          accion: 'Ver clientes', link: '/clientes',
        })
      }
    }

    // Canal dominante
    if (vData.canalData.length > 1 && vData.canalData[0].pct >= 70) {
      list.push({
        tipo: 'info',
        titulo: `El ${vData.canalData[0].pct}% de tus ventas vienen de ${vData.canalData[0].nombre}`,
        impacto: `Alta concentración en un solo canal. Diversificar puede dar más estabilidad.`,
        accion: 'Ver envíos', link: '/envios',
      })
    }

    // Heatmap: detectar peak day
    if (vData.heatmap) {
      let maxDi = 0, maxHi = 0, maxVal = 0
      for (let di = 0; di < 7; di++) {
        for (let hi = 0; hi < vData.heatmap[di].length; hi++) {
          if (vData.heatmap[di][hi] > maxVal) { maxVal = vData.heatmap[di][hi]; maxDi = di; maxHi = hi }
        }
      }
      if (maxVal >= 3) {
        list.push({
          tipo: 'info',
          titulo: `Pico de ventas los ${DAY_LABELS[maxDi]} a las ${HOUR_START + maxHi}hs`,
          impacto: `Tus momentos de mayor actividad coinciden con ${DAY_LABELS[maxDi]} ${HOUR_START + maxHi}:00. Priorizá atención y stock en esa franja.`,
          accion: 'Ver inventario', link: '/inventario',
        })
      }
    }

    return list.slice(0, 4)
  }, [vData, fmt])

  // ─── Helpers badge ────────────────────────────────────────────────────────────
  const badgeVs = (actual: number | null, prev: number | null, invertido = false) => {
    if (!actual || !prev || prev === 0) return undefined
    const pct = ((actual - prev) / Math.abs(prev)) * 100
    const positivo = invertido ? pct < 0 : pct > 0
    const color = Math.abs(pct) < 1 ? 'neutral' : positivo ? 'success' : 'danger'
    return { label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs período ant.`, color } as const
  }

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Barra: label período + botón filtros ──────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Mostrando <span className="font-medium text-primary">{PERIODO_LABELS[periodo].toLowerCase()}</span>
          {moneda === 'USD' && <span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">USD</span>}
          {iva === 'excluido' && <span className="ml-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">s/IVA</span>}
          {canal && <span className="ml-1 text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">Canal: {CANAL_DISPLAY[canal] ?? canal}</span>}
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

              {/* ─ Finanzas y Tiempo ─ */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Finanzas y tiempo</p>

                <div className="mb-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Período</p>
                  <div className="flex flex-wrap gap-1">
                    {(['hoy', '7d', '15d', '30d', 'mes', 'año', 'custom'] as VentasPeriodo[]).map(p => (
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

                <div className="flex gap-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Moneda</p>
                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
                      {(['ARS', 'USD'] as Moneda[]).map(m => (
                        <button key={m} onClick={() => setMoneda(m)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${moneda === m ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Importe</p>
                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
                      {[{ key: 'incluido' as IVAMode, label: 'c/IVA' }, { key: 'excluido' as IVAMode, label: 's/IVA' }].map(opt => (
                        <button key={opt.key} onClick={() => setIva(opt.key)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${iva === opt.key ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ─ Contexto de negocio ─ */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Contexto</p>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Canal de venta</p>
                  <select value={canal} onChange={e => setCanal(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-primary focus:outline-none focus:border-accent">
                    <option value="">Todos los canales</option>
                    {(vData?.canalesDisp ?? []).map((c: string) => (
                      <option key={c} value={c}>{CANAL_DISPLAY[c] ?? c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {activeFilters > 0 && (
                <button onClick={() => { setCanal('') }}
                  className="w-full text-xs text-gray-400 hover:text-accent transition-colors">
                  Limpiar filtros de contexto
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Capa 1: 4 KPI cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* KPI 1: Total Vendido */}
        <KPICard
          title="Total Vendido"
          value={isLoading ? '—' : fmt(vData?.totalVendido ?? 0)}
          badge={badgeVs(vData?.totalVendido ?? null, vData?.totalVendidoPrev ?? null)}
          sub="Dinero total generado antes de gastos."
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent">
              <ShoppingCart size={20} />
            </div>
          }
        />

        {/* KPI 2: Gasto promedio por cliente */}
        <KPICard
          title="Gasto Prom. por Cliente"
          value={isLoading ? '—' : (vData?.gastoPromCliente ?? 0) > 0 ? fmt(vData!.gastoPromCliente) : '—'}
          sub={vData && vData.gastoPromCliente > 0
            ? `${[...new Set((vData.ventasConf ?? []).map((v: any) => v.cliente_id).filter(Boolean))].length} clientes únicos en el período.`
            : 'Sin ventas con cliente asignado.'}
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <Users size={20} />
            </div>
          }
        />

        {/* KPI 3: Efectividad de presupuestos */}
        <KPICard
          title="Efectividad"
          value={isLoading ? '—' : vData?.efectividad != null ? fmtPct(vData.efectividad) : '—'}
          badge={vData?.efectividad != null ? {
            label: vData.efectividad >= 70 ? 'Alta conversión' : vData.efectividad >= 40 ? 'Conversión media' : 'Baja conversión',
            color: vData.efectividad >= 70 ? 'success' : vData.efectividad >= 40 ? 'warning' : 'danger',
          } : undefined}
          sub={vData?.efectividad != null
            ? `De cada 10 operaciones, confirmás ${Math.round(vData.efectividad / 10)}.`
            : 'Mínimo 3 ventas para calcular.'}
          icon={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
              <TrendingUp size={20} />
            </div>
          }
        />

        {/* KPI 4: Clientes nuevos vs frecuentes */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
              <Users size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted leading-snug">Nuevos vs Recurrentes</p>
          {isLoading || (vData?.cantFrecuentes === 0 && vData?.cantNuevos === 0) ? (
            <p className="text-3xl font-semibold text-primary mt-1">—</p>
          ) : (
            <>
              <p className="text-3xl font-semibold text-primary mt-1">{vData?.pctFrecuentes ?? 0}% recurrentes</p>
              {/* Mini progress bar */}
              <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
                <div className="h-full bg-accent rounded-l-full transition-all" style={{ width: `${vData?.pctFrecuentes ?? 0}%` }} />
                <div className="h-full bg-gray-300 dark:bg-gray-600 rounded-r-full transition-all" style={{ width: `${vData?.pctNuevos ?? 0}%` }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <p className="text-xs text-muted">{vData?.cantFrecuentes ?? 0} frecuentes</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                  <p className="text-xs text-muted">{vData?.cantNuevos ?? 0} nuevos</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Capa 2: Gráficos ─────────────────────────────────────────────────── */}

      {/* Fila 1: Funnel + Pie (canales) */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Gráfico 1: El Camino de la Venta (Funnel) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">El Camino de la Venta</h3>
            <span className="ml-auto text-xs text-muted">Embudo · {PERIODO_LABELS[periodo]}</span>
          </div>
          {isLoading ? (
            <div className="h-32 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : vData && vData.funnelData.presupuestado.count > 0 ? (
            <FunnelChart
              fmt={fmt}
              data={[
                { label: 'Presupuestado / Iniciado', count: vData.funnelData.presupuestado.count, monto: vData.funnelData.presupuestado.monto, color: '#7B00FF' },
                { label: 'Pendiente de Cobro', count: vData.funnelData.pendienteCobro.count, monto: vData.funnelData.pendienteCobro.monto, color: '#F59E0B' },
                { label: 'Pagado / Cerrado', count: vData.funnelData.pagado.count, monto: vData.funnelData.pagado.monto, color: '#22C55E' },
              ]}
            />
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin ventas en el período</p>
          )}
        </div>

        {/* Gráfico 3: Por dónde compran (Pie canales) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">¿Por dónde compran?</h3>
            <span className="ml-auto text-xs text-muted">Canales · {PERIODO_LABELS[periodo]}</span>
          </div>
          {isLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : vData && vData.canalData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={vData.canalData} cx="50%" cy="50%" innerRadius={35} outerRadius={60}
                    dataKey="total" paddingAngle={2} strokeWidth={0}>
                    {vData.canalData.map((_: any, i: number) => (
                      <Cell key={i} fill={CANAL_COLORS[i % CANAL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltipCustom fmt={fmt} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {vData.canalData.map((c: any, i: number) => (
                  <div key={c.nombre} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CANAL_COLORS[i % CANAL_COLORS.length] }} />
                      <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{c.nombre}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-semibold text-primary">{c.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin datos de canal</p>
          )}
        </div>
      </div>

      {/* Gráfico 2: Heatmap "Tus mejores momentos" */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tus mejores momentos</h3>
          <span className="ml-auto text-xs text-muted">Días × Horarios · {PERIODO_LABELS[periodo]}</span>
        </div>
        {isLoading ? (
          <div className="h-36 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
        ) : vData && vData.ventasConf.length > 0 ? (
          <HeatmapChart matrix={vData.heatmap} />
        ) : (
          <p className="text-sm text-muted text-center py-8">Sin ventas confirmadas en el período</p>
        )}
      </div>

      {/* ── Capa 3: Insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lo que nos dicen los datos</h3>
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

      {!isLoading && vData && vData.totalVendido === 0 && (
        <div className="text-center py-12 text-muted">
          <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin ventas confirmadas en este período</p>
          <p className="text-xs mt-1">Probá cambiando el período en Filtros</p>
        </div>
      )}
    </div>
  )
}
