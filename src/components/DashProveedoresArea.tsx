import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LineChart, Line, CartesianGrid,
} from 'recharts'
import {
  SlidersHorizontal, X, Truck, AlertTriangle, CheckCircle, Clock,
  BarChart2, Zap, DollarSign, Flame,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { InsightCard } from '@/components/InsightCard'

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const COLORS = ['#7B00FF','#06B6D4','#F59E0B','#22C55E','#EF4444','#EC4899','#6B7280','#F97316']

function fmt(v: number) { return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` }
function fmtCorto(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

type Vista = 'consolidado' | 'mercaderia' | 'servicios'

export function DashProveedoresArea() {
  const { tenant } = useAuthStore()
  const { sucursalId } = useSucursalFilter()

  const dashFilter = (q: any) => {
    if (!sucursalId) return q
    return q.eq('sucursal_id', sucursalId)
  }

  const [vista, setVista] = useState<Vista>('consolidado')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const { data: pData, isLoading } = useQuery({
    queryKey: ['dash-proveedores-area', tenant?.id, sucursalId],
    queryFn: async () => {
      const hoy = new Date()
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]
      const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString().split('T')[0]
      const finMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0).toISOString().split('T')[0]
      const en48h = new Date(Date.now() + 48 * 3600000).toISOString().split('T')[0]
      const seisMesesAtras = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1).toISOString().split('T')[0]

      // 1. OC pendientes de pago
      let qOcPendientes = supabase.from('ordenes_compra')
        .select('id, monto_total, monto_pagado, estado_pago, fecha_vencimiento_pago, proveedor_id, created_at, proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .in('estado_pago', ['pendiente_pago', 'pago_parcial', 'cuenta_corriente'])
      qOcPendientes = dashFilter(qOcPendientes)
      const { data: ocPendientes = [] } = await qOcPendientes

      // 2. OC próximas 48h
      const ocUrgentes = (ocPendientes ?? []).filter((oc: any) =>
        oc.fecha_vencimiento_pago && oc.fecha_vencimiento_pago <= en48h && oc.fecha_vencimiento_pago >= inicioMes
      )

      // 3. Gastos fijos activos
      const { data: gastosFijos = [] } = await supabase.from('gastos_fijos')
        .select('monto, descripcion, categoria').eq('tenant_id', tenant!.id).eq('activo', true)

      // 4. Gastos por mes (últimos 6)
      let qGastosHist = supabase.from('gastos')
        .select('monto, fecha').eq('tenant_id', tenant!.id).gte('fecha', seisMesesAtras).order('fecha')
      qGastosHist = dashFilter(qGastosHist)
      const { data: gastosHist = [] } = await qGastosHist

      // 5. OC por proveedor (para donut)
      let qOcAll = supabase.from('ordenes_compra')
        .select('monto_total, proveedor_id, proveedores(nombre)')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', new Date(hoy.getFullYear(), 0, 1).toISOString())
      qOcAll = dashFilter(qOcAll)
      const { data: ocAll = [] } = await qOcAll

      // 6. Recepciones (para lead time proxy)
      let qRecepciones = supabase.from('recepciones')
        .select('created_at, oc_id, ordenes_compra!inner(created_at)')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1).toISOString())
        .limit(100)
      qRecepciones = dashFilter(qRecepciones)
      const { data: recepciones = [] } = await qRecepciones

      // KPI 1: Total cuentas por pagar
      const totalPorPagar = (ocPendientes ?? []).reduce((a: number, oc: any) => {
        return a + Math.max(0, (oc.monto_total ?? 0) - (oc.monto_pagado ?? 0))
      }, 0)

      // KPI 2: Vencimiento crítico 48h
      const montoUrgente = ocUrgentes.reduce((a: number, oc: any) => a + Math.max(0, (oc.monto_total ?? 0) - (oc.monto_pagado ?? 0)), 0)

      // KPI 3: Gasto fijo operativo
      const gastoFijoMensual = (gastosFijos ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)

      // KPI 4: Índice de inflación de costos (gastos este mes vs mes ant)
      const gastosMes = (gastosHist ?? []).filter((g: any) => g.fecha >= inicioMes).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)
      const gastosMesAnt = (gastosHist ?? []).filter((g: any) => g.fecha >= inicioMesAnt && g.fecha <= finMesAnt).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)
      const inflacionCostos = gastosMesAnt > 0 ? ((gastosMes - gastosMesAnt) / gastosMesAnt) * 100 : null

      // KPI 5: Lead time (días entre OC y recepción)
      let leadTimeDias: number | null = null
      if ((recepciones ?? []).length > 0) {
        const diffs = (recepciones ?? []).map((r: any) => {
          const oc = (r as any).ordenes_compra
          if (!oc?.created_at) return null
          return Math.round((new Date(r.created_at).getTime() - new Date(oc.created_at).getTime()) / 86400000)
        }).filter((d): d is number => d !== null && d >= 0 && d <= 60)
        if (diffs.length > 0) leadTimeDias = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
      }

      // KPI 6: Tasa de cumplimiento (recepciones vs OC cerradas - proxy)
      const { count: ocCerradasCount } = await supabase.from('ordenes_compra')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'recibida')
      const totalRecepciones = (recepciones ?? []).length
      const tasaCumplimiento = totalRecepciones > 0 && (ocCerradasCount ?? 0) > 0
        ? Math.min(100, Math.round((totalRecepciones / (ocCerradasCount ?? 1)) * 100))
        : null

      // KPI 7: Suscripciones zombi (gastos_fijos sin gastos recientes)
      let qGastosRecientes30 = supabase.from('gastos')
        .select('descripcion').eq('tenant_id', tenant!.id)
        .gte('fecha', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
      qGastosRecientes30 = dashFilter(qGastosRecientes30)
      const { data: gastosRecientes30 = [] } = await qGastosRecientes30
      const descRecientes = new Set((gastosRecientes30 ?? []).map((g: any) => g.descripcion?.toLowerCase().slice(0, 20)))
      const zombis = (gastosFijos ?? []).filter((gf: any) => !descRecientes.has(gf.descripcion?.toLowerCase().slice(0, 20))).length

      // KPI 8: Ahorro (comparar gastosMes vs promedio histórico)
      const monthlyMap: Record<string, number> = {}
      for (const g of gastosHist ?? []) {
        const mes = (g as any).fecha.slice(0, 7)
        monthlyMap[mes] = (monthlyMap[mes] ?? 0) + (g.monto ?? 0)
      }
      const monthlyVals = Object.values(monthlyMap)
      const promHistorico = monthlyVals.length > 1 ? monthlyVals.slice(0, -1).reduce((a, b) => a + b, 0) / (monthlyVals.length - 1) : 0
      const ahorro = promHistorico > gastosMes ? promHistorico - gastosMes : 0

      // Chart 1: Donut top 5 proveedores
      const provMap: Record<string, number> = {}
      for (const oc of ocAll ?? []) {
        const nombre = (oc as any).proveedores?.nombre || 'Sin proveedor'
        provMap[nombre] = (provMap[nombre] ?? 0) + (oc.monto_total ?? 0)
      }
      const provTotal = Object.values(provMap).reduce((a, b) => a + b, 0)
      const donutProveedores = Object.entries(provMap)
        .sort(([,a],[,b]) => b-a).slice(0, 5)
        .map(([nombre, total]) => ({ nombre, total, pct: provTotal > 0 ? Math.round((total/provTotal)*100) : 0 }))

      // Chart 2: Evolución gastos mensual
      const evolData = Object.entries(monthlyMap).sort(([a],[b]) => a.localeCompare(b)).map(([mes, total]) => {
        const [y, m] = mes.split('-')
        return { label: `${MESES_ES[parseInt(m,10)-1]} ${y.slice(2)}`, total }
      })

      // Chart 3: Aging OC
      const agingOC = [
        { label: 'Vigentes', monto: 0, count: 0, color: '#22C55E' },
        { label: 'Vence prox 7d', monto: 0, count: 0, color: '#F59E0B' },
        { label: 'Vencidas', monto: 0, count: 0, color: '#EF4444' },
      ]
      for (const oc of ocPendientes ?? []) {
        const saldo = Math.max(0, (oc.monto_total ?? 0) - (oc.monto_pagado ?? 0))
        if (saldo < 0.5) continue
        if (!oc.fecha_vencimiento_pago) { agingOC[0].monto += saldo; agingOC[0].count++; continue }
        const hoyStr = hoy.toISOString().split('T')[0]
        const en7 = new Date(Date.now() + 7*86400000).toISOString().split('T')[0]
        if (oc.fecha_vencimiento_pago < hoyStr) { agingOC[2].monto += saldo; agingOC[2].count++ }
        else if (oc.fecha_vencimiento_pago <= en7) { agingOC[1].monto += saldo; agingOC[1].count++ }
        else { agingOC[0].monto += saldo; agingOC[0].count++ }
      }

      const catDisp = [...new Set((gastosFijos ?? []).map((g: any) => g.categoria).filter(Boolean))]

      return {
        totalPorPagar, montoUrgente, cantUrgentes: ocUrgentes.length,
        gastoFijoMensual, inflacionCostos, leadTimeDias,
        tasaCumplimiento, zombis, ahorro,
        donutProveedores, provTotal, evolData, agingOC, catDisp,
        ocVencidas: agingOC[2].count,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  const insights = useMemo(() => {
    if (!pData) return []
    const list: { tipo: 'danger'|'warning'|'success'|'info'; titulo: string; impacto: string; accion: string; link: string }[] = []
    if (pData.ocVencidas > 0) list.push({ tipo: 'danger', titulo: `${pData.ocVencidas} OC vencidas sin pagar`, impacto: `${fmt(pData.agingOC[2].monto)} en deuda vencida con proveedores. Podrías estar acumulando intereses moratorios.`, accion: 'Ver proveedores', link: '/proveedores' })
    if (pData.cantUrgentes > 0) list.push({ tipo: 'warning', titulo: `${fmt(pData.montoUrgente)} vencen en las próximas 48 horas`, impacto: `${pData.cantUrgentes} OC con vencimiento inminente. Asegurate de tener liquidez en caja.`, accion: 'Ver proveedores', link: '/proveedores' })
    if (pData.zombis > 0) list.push({ tipo: 'warning', titulo: `${pData.zombis} suscripci${pData.zombis!==1?'ones':'ón'} fija${pData.zombis!==1?'s':''} sin uso reciente (Zombi)`, impacto: 'Gastos recurrentes sin factura o actividad en los últimos 30 días. Considerá cancelarlos.', accion: 'Ver gastos', link: '/gastos' })
    if (pData.inflacionCostos !== null && pData.inflacionCostos > 10) list.push({ tipo: 'warning', titulo: `Los gastos subieron ${pData.inflacionCostos.toFixed(0)}% vs el mes anterior`, impacto: 'Este aumento puede estar comprimiendo tu margen operativo. Revisá contratos y tarifas.', accion: 'Ver gastos', link: '/gastos' })
    if (pData.ahorro > 0) list.push({ tipo: 'success', titulo: `${fmt(pData.ahorro)} por debajo del promedio histórico de gastos`, impacto: 'Excelente control de costos este mes. Tus gastos están por debajo del promedio mensual.', accion: 'Ver gastos', link: '/gastos' })
    return list.slice(0, 4)
  }, [pData])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  return (
    <div className="space-y-5">
      {/* Toggle Vista + Filtros */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          {([['consolidado','Consolidado'],['mercaderia','Mercadería'],['servicios','Servicios']] as [Vista,string][]).map(([v,l]) => (
            <button key={v} onClick={() => setVista(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${vista === v ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>{l}</button>
          ))}
        </div>
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all ${filterOpen ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} /> Filtros
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3><button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button></div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Los filtros avanzados por estado y categoría están disponibles en el módulo Proveedores.</p>
              <a href="/proveedores" className="block mt-3 text-center text-xs font-medium text-accent hover:underline">Ir a Proveedores →</a>
            </div>
          )}
        </div>
      </div>

      {/* 8 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(pData?.totalPorPagar ?? 0) > 0 ? 'border-orange-300 dark:border-orange-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"><DollarSign size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Cuentas por Pagar</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(pData?.totalPorPagar ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Saldo total con proveedores pendientes.</p>
        </div>

        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(pData?.cantUrgentes ?? 0) > 0 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(pData?.cantUrgentes ?? 0) > 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><AlertTriangle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Vencimiento Crítico (48h)</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(pData?.cantUrgentes ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : fmtCorto(pData?.montoUrgente ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">{pData?.cantUrgentes ?? 0} OC vencen en menos de 48 horas.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent"><Flame size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Gasto Fijo Mensual</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(pData?.gastoFijoMensual ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Suscripciones y servicios recurrentes activos.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(pData?.inflacionCostos ?? 0) > 10 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}`}><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Inflación de Costos</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(pData?.inflacionCostos ?? 0) > 10 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : pData?.inflacionCostos != null ? `${pData.inflacionCostos > 0 ? '+' : ''}${pData.inflacionCostos.toFixed(1)}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">Variación gastos vs mes anterior.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Clock size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Lead Time Promedio</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : pData?.leadTimeDias != null ? `${pData.leadTimeDias}d` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">Días promedio entre OC y recepción.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"><CheckCircle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Tasa de Cumplimiento</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : pData?.tasaCumplimiento != null ? `${pData.tasaCumplimiento}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">Recepciones exitosas vs OC cerradas.</p>
        </div>

        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(pData?.zombis ?? 0) > 0 ? 'border-yellow-300 dark:border-yellow-700' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(pData?.zombis ?? 0) > 0 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><Truck size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Suscripciones Zombi</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(pData?.zombis ?? 0) > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-primary'}`}>{isLoading ? '—' : pData?.zombis ?? 0}</p>
          <p className="text-xs text-muted mt-1.5">Gastos fijos sin uso o factura reciente.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"><CheckCircle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Ahorro vs Promedio</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(pData?.ahorro ?? 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-primary'}`}>{isLoading ? '—' : (pData?.ahorro ?? 0) > 0 ? fmtCorto(pData!.ahorro) : '$0'}</p>
          <p className="text-xs text-muted mt-1.5">Gasto inferior al promedio histórico mensual.</p>
        </div>
      </div>

      {/* Charts fila 1 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Donut Top proveedores */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><DollarSign size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Concentración de Gasto</h3><span className="ml-auto text-xs text-muted">Top 5 proveedores</span></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (pData?.donutProveedores ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}><PieChart><Pie data={pData!.donutProveedores} cx="50%" cy="50%" innerRadius={32} outerRadius={55} dataKey="total" paddingAngle={2} strokeWidth={0}>{pData!.donutProveedores.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v: any) => fmt(Number(v))} /></PieChart></ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {pData!.donutProveedores.map((d: any, i: number) => (
                  <div key={d.nombre} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0"><div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} /><span className="text-xs text-gray-600 dark:text-gray-400 truncate">{d.nombre}</span></div>
                    <span className="text-xs font-semibold flex-shrink-0">{d.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-muted text-center py-8">Sin OC en el año</p>}
        </div>

        {/* Aging OC */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><AlertTriangle size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Muro de Vencimientos</h3><span className="ml-auto text-xs text-muted">OC pendientes</span></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <div className="space-y-3">
              {(pData?.agingOC ?? []).map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} /><span className="text-xs font-medium text-gray-600 dark:text-gray-400">{b.label}</span></div><div className="flex items-center gap-3"><span className="text-xs text-gray-400 dark:text-gray-500">{b.count} OC</span><span className="text-xs font-semibold">{fmtCorto(b.monto)}</span></div></div>
                  <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden"><div className="h-full rounded-lg transition-all" style={{ width: `${Math.max(3, (b.monto / Math.max(1, ...(pData?.agingOC ?? []).map(x => x.monto))) * 100)}%`, backgroundColor: b.color, opacity: 0.8 }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Evolución gastos */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4"><BarChart2 size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Evolución de Gastos</h3><span className="ml-auto text-xs text-muted">Últimos 6 meses</span></div>
        {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (pData?.evolData ?? []).length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={pData!.evolData} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
              <Bar dataKey="total" fill="#7B00FF" fillOpacity={0.7} radius={[4,4,0,0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-muted text-center py-8">Sin datos históricos</p>}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3"><Zap size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu Auditor Financiero</h3><span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span></div>
          <div className="grid sm:grid-cols-2 gap-3">{insights.map((ins, i) => { const Icon = INSIGHT_ICONS[ins.tipo]; return <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />} title={ins.titulo} description={ins.impacto} action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }} /> })}</div>
        </div>
      )}
    </div>
  )
}
