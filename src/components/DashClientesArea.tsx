import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, ComposedChart, Line,
} from 'recharts'
import {
  SlidersHorizontal, X, Users, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, BarChart2, Zap, Heart,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { InsightCard } from '@/components/InsightCard'

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const CANAL_COLORS = ['#7B00FF','#06B6D4','#F59E0B','#22C55E','#EF4444','#EC4899','#6B7280']
const CANAL_DISPLAY: Record<string, string> = { POS: 'Presencial', pos: 'Presencial', tiendanube: 'TiendaNube', mercadolibre: 'MercadoLibre', whatsapp: 'WhatsApp' }

function fmt(v: number) { return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` }
function fmtCorto(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function CohortTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-100">{label}</p>
      <p className="text-accent">{payload[0]?.value ?? 0}% retención</p>
    </div>
  )
}

export function DashClientesArea() {
  const { tenant } = useAuthStore()
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const { data: cData, isLoading } = useQuery({
    queryKey: ['dash-clientes-area', tenant?.id],
    queryFn: async () => {
      const hoy = new Date()
      const hace90  = new Date(Date.now() - 90  * 86400000).toISOString()
      const hace180 = new Date(Date.now() - 180 * 86400000).toISOString()
      const hace365 = new Date(Date.now() - 365 * 86400000).toISOString()
      const hace12m_start = new Date(hoy.getFullYear() - 1, hoy.getMonth(), 1).toISOString()
      const hace6m_start  = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1).toISOString()

      // 1. Ventas últimos 12 meses (base de cálculo)
      const { data: ventas12m = [] } = await supabase.from('ventas')
        .select('id, total, monto_pagado, estado, created_at, cliente_id, origen, es_cuenta_corriente')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', hace365)
      const ventasConf = ventas12m ?? []

      // 2. Deuda CC (toda la historia)
      const { data: ventasCC = [] } = await supabase.from('ventas')
        .select('total, monto_pagado, created_at, cliente_id, clientes(plazo_pago_dias)')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .eq('es_cuenta_corriente', true)

      // ── KPI 1: Cartera Activa ─────────────────────────────────────────────
      const clientesActivos90 = new Set(ventasConf.filter((v: any) => v.created_at >= hace90 && v.cliente_id).map((v: any) => v.cliente_id))
      const cartaActiva = clientesActivos90.size

      // ── KPI 2: LTV Promedio (12m) ─────────────────────────────────────────
      const gstMap: Record<string, number> = {}
      for (const v of ventasConf) {
        if (!v.cliente_id) continue
        gstMap[v.cliente_id] = (gstMap[v.cliente_id] ?? 0) + (v.total ?? 0)
      }
      const ltvsArr = Object.values(gstMap)
      const ltvPromedio = ltvsArr.length > 0 ? ltvsArr.reduce((a, b) => a + b, 0) / ltvsArr.length : 0

      // ── KPI 3: Tasa de Recurrencia (12m) ─────────────────────────────────
      const comprasMap: Record<string, number> = {}
      for (const v of ventasConf) { if (v.cliente_id) comprasMap[v.cliente_id] = (comprasMap[v.cliente_id] ?? 0) + 1 }
      const totalClientes12m = Object.keys(comprasMap).length
      const clientesRecurrentes = Object.values(comprasMap).filter(c => c >= 2).length
      const tasaRecurrencia = totalClientes12m > 0 ? (clientesRecurrentes / totalClientes12m) * 100 : null

      // ── KPI 4: CAC (approx = gastos marketing / clientes nuevos) ─────────
      const hace90Date = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
      const { data: gastosMarketing = [] } = await supabase.from('gastos')
        .select('monto').eq('tenant_id', tenant!.id)
        .ilike('categoria', '%marketing%').gte('fecha', hace90Date)
      const totalMarketing = (gastosMarketing ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)
      // New clients = those who bought in last 90d but NOT before
      const clientesNuevos90 = [...clientesActivos90].filter(id => !ventasConf.some((v: any) => v.cliente_id === id && v.created_at < hace90)).length
      const cac = clientesNuevos90 > 0 && totalMarketing > 0 ? totalMarketing / clientesNuevos90 : null

      // ── KPI 5: Churn Rate ─────────────────────────────────────────────────
      const clientes6_12m = new Set(ventasConf.filter((v: any) => v.created_at >= hace12m_start && v.created_at < hace6m_start && v.cliente_id).map((v: any) => v.cliente_id))
      const retuvimos = [...clientes6_12m].filter(id => ventasConf.some((v: any) => v.cliente_id === id && v.created_at >= hace6m_start)).length
      const churnRate = clientes6_12m.size > 0 ? ((clientes6_12m.size - retuvimos) / clientes6_12m.size) * 100 : null

      // ── KPI 6: Deuda CC ───────────────────────────────────────────────────
      let deudaTotal = 0
      for (const v of ventasCC ?? []) {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        deudaTotal += saldo
      }

      // ── Pirámide de Rentabilidad ──────────────────────────────────────────
      const sortedLtv = Object.entries(gstMap).sort(([,a],[,b]) => b - a)
      const n = sortedLtv.length
      const vipCut = Math.max(1, Math.ceil(n * 0.1))
      const recCut = Math.ceil(n * 0.4)
      const vipClients = sortedLtv.slice(0, vipCut)
      const recClients = sortedLtv.slice(vipCut, recCut)
      const ocaClients = sortedLtv.slice(recCut)
      const totalIngresos = sortedLtv.reduce((a,[,v]) => a + v, 0)
      const piramide = [
        { tier: 'VIP / Campeones', count: vipClients.length, ingresos: vipClients.reduce((a,[,v]) => a+v, 0), color: '#7B00FF', pct: totalIngresos > 0 ? Math.round(vipClients.reduce((a,[,v])=>a+v,0)/totalIngresos*100) : 0 },
        { tier: 'Recurrentes', count: recClients.length, ingresos: recClients.reduce((a,[,v]) => a+v, 0), color: '#06B6D4', pct: totalIngresos > 0 ? Math.round(recClients.reduce((a,[,v])=>a+v,0)/totalIngresos*100) : 0 },
        { tier: 'Ocasionales', count: ocaClients.length, ingresos: ocaClients.reduce((a,[,v]) => a+v, 0), color: '#9CA3AF', pct: totalIngresos > 0 ? Math.round(ocaClients.reduce((a,[,v])=>a+v,0)/totalIngresos*100) : 0 },
      ]

      // ── Cohort Analysis (simplified: 4 cohorts × 3 months) ───────────────
      // Get first purchase month for each client
      const allVentas = [...ventasConf].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
      const primeraCompra: Record<string, string> = {}
      for (const v of allVentas) {
        if (v.cliente_id && !primeraCompra[v.cliente_id]) primeraCompra[v.cliente_id] = v.created_at.slice(0, 7)
      }
      // Build cohorts: last 5 months
      const cohortData: { mes: string; label: string; m1: number; m2: number; m3: number; total: number }[] = []
      for (let i = 4; i >= 0; i--) {
        const d = new Date(hoy); d.setMonth(d.getMonth() - i)
        const mesKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
        const cohortClients = Object.entries(primeraCompra).filter(([, m]) => m === mesKey).map(([id]) => id)
        if (cohortClients.length === 0) continue
        const checkReturn = (offsetMonths: number) => {
          const td = new Date(d); td.setMonth(td.getMonth() + offsetMonths)
          const targetMes = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2,'0')}`
          const returned = cohortClients.filter(id => allVentas.some((v: any) => v.cliente_id === id && v.created_at.slice(0,7) === targetMes)).length
          return cohortClients.length > 0 ? Math.round((returned / cohortClients.length) * 100) : 0
        }
        cohortData.push({ mes: mesKey, label: `${MESES_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, m1: checkReturn(1), m2: checkReturn(2), m3: checkReturn(3), total: cohortClients.length })
      }

      // ── Origen de clientes (por canal) ────────────────────────────────────
      const canalMap: Record<string, { clientes: Set<string>; total: number; count: number }> = {}
      for (const v of ventasConf) {
        const canal = CANAL_DISPLAY[v.origen ?? 'POS'] ?? (v.origen || 'Presencial')
        if (!canalMap[canal]) canalMap[canal] = { clientes: new Set(), total: 0, count: 0 }
        if (v.cliente_id) canalMap[canal].clientes.add(v.cliente_id)
        canalMap[canal].total += v.total ?? 0
        canalMap[canal].count++
      }
      const canalData = Object.entries(canalMap).map(([canal, d]) => ({
        canal, clientes: d.clientes.size, ticketProm: d.count > 0 ? Math.round(d.total / d.count) : 0, total: d.total,
      })).sort((a, b) => b.total - a.total)

      // ── Aging de Cobranzas CC ─────────────────────────────────────────────
      const ahora = new Date()
      const agingCC = [
        { label: 'Al día', monto: 0, count: 0, color: '#22C55E' },
        { label: '1-30 días', monto: 0, count: 0, color: '#F59E0B' },
        { label: '31-60 días', monto: 0, count: 0, color: '#F97316' },
        { label: '+60 días', monto: 0, count: 0, color: '#EF4444' },
      ]
      for (const v of ventasCC ?? []) {
        const saldo = Math.max(0, (v.total ?? 0) - (v.monto_pagado ?? 0))
        if (saldo < 0.5) continue
        const plazo = (v as any).clientes?.plazo_pago_dias ?? 30
        const fechaVenc = new Date(v.created_at); fechaVenc.setDate(fechaVenc.getDate() + plazo)
        const diasMora = Math.floor((ahora.getTime() - fechaVenc.getTime()) / 86400000)
        if (diasMora <= 0) { agingCC[0].monto += saldo; agingCC[0].count++ }
        else if (diasMora <= 30) { agingCC[1].monto += saldo; agingCC[1].count++ }
        else if (diasMora <= 60) { agingCC[2].monto += saldo; agingCC[2].count++ }
        else { agingCC[3].monto += saldo; agingCC[3].count++ }
      }

      return {
        cartaActiva, ltvPromedio, tasaRecurrencia, cac, churnRate, deudaTotal,
        piramide, cohortData, canalData, agingCC,
        clientesNuevos90, clientesRecurrentes, totalClientes12m,
        vipCount: vipClients.length, deudaVencida: agingCC[3].monto,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  const insights = useMemo(() => {
    if (!cData) return []
    const list: { tipo: 'danger'|'warning'|'success'|'info'; titulo: string; impacto: string; accion: string; link: string }[] = []
    if (cData.churnRate !== null && cData.churnRate > 20) {
      list.push({ tipo: 'danger', titulo: `Churn del ${cData.churnRate.toFixed(0)}% — alta fuga de clientes`, impacto: `El ${cData.churnRate.toFixed(0)}% de tus clientes no volvió a comprar en los últimos 6 meses.`, accion: 'Ver clientes', link: '/clientes' })
    }
    if (cData.deudaVencida > 0) {
      list.push({ tipo: 'danger', titulo: `${fmt(cData.deudaVencida)} en cuentas corrientes vencidas (+60 días)`, impacto: 'Deudas con más de 60 días de mora. Accioná la cobranza antes de que se vuelvan incobrables.', accion: 'Ver clientes', link: '/clientes' })
    }
    if (cData.deudaTotal > 0 && cData.deudaVencida < cData.deudaTotal) {
      list.push({ tipo: 'warning', titulo: `${fmt(cData.deudaTotal)} en deuda total de cuentas corrientes`, impacto: `Dinero que tus clientes te deben actualmente. El ${Math.round((cData.deudaTotal-cData.deudaVencida)/cData.deudaTotal*100)}% está dentro del plazo.`, accion: 'Ver clientes', link: '/clientes' })
    }
    if (cData.tasaRecurrencia !== null && cData.tasaRecurrencia < 30) {
      list.push({ tipo: 'warning', titulo: `Solo el ${cData.tasaRecurrencia.toFixed(0)}% de los clientes son recurrentes`, impacto: 'Baja tasa de recompra. Implementá una estrategia de segunda compra (email, cupón, WhatsApp).', accion: 'Ver historial', link: '/historial' })
    }
    if (cData.tasaRecurrencia !== null && cData.tasaRecurrencia >= 60) {
      list.push({ tipo: 'success', titulo: `Alta fidelidad: el ${cData.tasaRecurrencia.toFixed(0)}% de clientes son recurrentes`, impacto: `${cData.clientesRecurrentes} de ${cData.totalClientes12m} clientes compraron más de una vez en el año.`, accion: 'Ver clientes', link: '/clientes' })
    }
    if (cData.vipCount > 0) {
      list.push({ tipo: 'info', titulo: `Tenés ${cData.vipCount} cliente${cData.vipCount!==1?'s':''} VIP que generan la mayoría de tus ingresos`, impacto: 'Cuidalos especialmente. Un cliente VIP perdido impacta más que 10 ocasionales.', accion: 'Ver clientes', link: '/clientes' })
    }
    return list.slice(0, 4)
  }, [cData])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Últimos 12 meses · Todos los clientes</p>
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all
              ${filterOpen ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} /> Filtros
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3>
                <button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Los filtros avanzados por segmento y zona se aplican directamente en el módulo Clientes.</p>
              <a href="/clientes" className="block mt-3 text-center text-xs font-medium text-accent hover:underline">Ir a Clientes →</a>
            </div>
          )}
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent"><Users size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Cartera Activa</p>
          <p className="text-3xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : cData?.cartaActiva ?? 0}</p>
          <p className="text-xs text-muted mt-1.5">Compraron al menos una vez en los últimos 90 días.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"><TrendingUp size={20} /></div></div>
          <p className="text-sm font-medium text-muted">LTV Promedio (12m)</p>
          <p className="text-3xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(cData?.ltvPromedio ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Gasto promedio por cliente activo en el año.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Heart size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Tasa de Recurrencia</p>
          <p className="text-3xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : cData?.tasaRecurrencia != null ? `${cData.tasaRecurrencia.toFixed(0)}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">De cada 10 clientes, {cData?.tasaRecurrencia != null ? Math.round(cData.tasaRecurrencia/10) : '?'} volvieron a comprar.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">CAC Estimado</p>
          <p className="text-3xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : cData?.cac != null ? fmtCorto(cData.cac) : 'Sin datos'}</p>
          <p className="text-xs text-muted mt-1.5">Gastos en marketing / clientes nuevos (90d).</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(cData?.churnRate ?? 0) > 20 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(cData?.churnRate ?? 0) > 20 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}><TrendingDown size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Riesgo de Fuga (Churn)</p>
          <p className={`text-3xl font-semibold mt-1 tabular-nums ${(cData?.churnRate ?? 0) > 20 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : cData?.churnRate != null ? `${cData.churnRate.toFixed(0)}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">No regresaron en los últimos 6 meses.</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(cData?.deudaTotal ?? 0) > 0 ? 'border-orange-300 dark:border-orange-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(cData?.deudaTotal ?? 0) > 0 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}><AlertTriangle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Deuda en la Calle (CC)</p>
          <p className={`text-3xl font-semibold mt-1 tabular-nums ${(cData?.deudaTotal ?? 0) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-primary'}`}>{isLoading ? '—' : fmtCorto(cData?.deudaTotal ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Saldo total pendiente en cuentas corrientes.</p>
        </div>
      </div>

      {/* Fila gráficos 1-2 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Pirámide de Rentabilidad */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><Users size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Pirámide de Rentabilidad</h3></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <div className="space-y-3">
              {(cData?.piramide ?? []).map((tier, i) => (
                <div key={tier.tier}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: tier.color }} /><span className="text-xs font-medium text-gray-600 dark:text-gray-400">{tier.tier}</span></div>
                    <div className="flex items-center gap-3"><span className="text-xs text-gray-400 dark:text-gray-500">{tier.count} clientes</span><span className="text-xs font-semibold text-primary">{tier.pct}% ingresos</span></div>
                  </div>
                  <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden"><div className="h-full rounded-lg transition-all" style={{ width: `${Math.max(3, tier.pct)}%`, backgroundColor: tier.color, opacity: 1 - i * 0.2 }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Origen de clientes */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><BarChart2 size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Origen de los Mejores Clientes</h3></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (cData?.canalData ?? []).length > 0 ? (
            <div className="space-y-3">
              {(cData?.canalData ?? []).slice(0, 5).map((c, i) => (
                <div key={c.canal}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CANAL_COLORS[i % CANAL_COLORS.length] }} /><span className="text-xs font-medium text-gray-600 dark:text-gray-400">{c.canal}</span></div>
                    <div className="flex items-center gap-3"><span className="text-xs text-gray-400 dark:text-gray-500">{c.clientes} clientes</span><span className="text-xs font-semibold">{fmt(c.ticketProm)} /ticket</span></div>
                  </div>
                  <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded-md overflow-hidden"><div className="h-full rounded-md" style={{ width: `${Math.max(3, (c.total / ((cData?.canalData ?? [])[0]?.total || 1)) * 100)}%`, backgroundColor: CANAL_COLORS[i % CANAL_COLORS.length], opacity: 0.8 }} /></div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted text-center py-8">Sin datos de canal</p>}
        </div>
      </div>

      {/* Cohort Analysis */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1"><Heart size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Fidelidad en el Tiempo (Análisis de Cohortes)</h3></div>
        <p className="text-xs text-muted mb-4 ml-5">% de clientes que volvieron a comprar en los meses siguientes a su primera compra.</p>
        {isLoading ? <div className="h-36 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (cData?.cohortData ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 dark:text-gray-500"><th className="text-left py-1 pr-4 font-medium">Cohorte</th><th className="text-center px-3 font-medium">Base</th><th className="text-center px-3 font-medium">Mes 1</th><th className="text-center px-3 font-medium">Mes 2</th><th className="text-center px-3 font-medium">Mes 3</th></tr></thead>
              <tbody>
                {(cData?.cohortData ?? []).map((row) => (
                  <tr key={row.mes} className="border-t border-gray-50 dark:border-gray-700">
                    <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300">{row.label}</td>
                    <td className="text-center px-3 text-gray-500 dark:text-gray-400">{row.total}</td>
                    {[row.m1, row.m2, row.m3].map((pct, i) => (
                      <td key={i} className="text-center px-3">
                        <span className="inline-block px-2 py-1 rounded-lg text-white text-[10px] font-semibold" style={{ backgroundColor: `rgba(123,0,255,${Math.max(0.1, pct/100)})`, minWidth: 36 }}>{pct}%</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted text-center py-8">Se necesitan más datos para el análisis de cohortes</p>}
      </div>

      {/* Aging CC */}
      {(cData?.deudaTotal ?? 0) > 0 && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><AlertTriangle size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Salud de Cobranzas (Aging de Deuda)</h3></div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={cData?.agingCC ?? []} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtCorto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
              <Bar dataKey="monto" radius={[4,4,0,0]} maxBarSize={60}>
                {(cData?.agingCC ?? []).map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3"><Zap size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu Ejecutivo de Cuentas</h3><span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span></div>
          <div className="grid sm:grid-cols-2 gap-3">
            {insights.map((ins, i) => { const Icon = INSIGHT_ICONS[ins.tipo]; return <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />} title={ins.titulo} description={ins.impacto} action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }} /> })}
          </div>
        </div>
      )}
    </div>
  )
}
