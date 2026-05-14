import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid,
} from 'recharts'
import { SlidersHorizontal, X, Shield, AlertTriangle, CheckCircle, Clock, BarChart2, Zap, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { InsightCard } from '@/components/InsightCard'

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const IVA_COLORS: Record<string, string> = { '21': '#06B6D4', '10.5': '#F59E0B', '27': '#7B00FF', '0': '#9CA3AF' }

function fmt(v: number) { return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` }
function fmtCorto(v: number) {
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v/1_000).toFixed(0)}K`
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

// Límites aproximados de Monotributo por categoría (simplificado, 2024)
const MONOTRIB_LIMITES = [
  { cat: 'A', limite: 2_024_291 },
  { cat: 'B', limite: 3_035_069 },
  { cat: 'C', limite: 4_053_760 },
  { cat: 'D', limite: 5_059_073 },
  { cat: 'E', limite: 6_090_386 },
  { cat: 'F', limite: 7_605_412 },
  { cat: 'G', limite: 9_114_790 },
  { cat: 'H', limite: 11_393_551 },
  { cat: 'I', limite: 14_246_924 },
  { cat: 'J', limite: 17_804_982 },
  { cat: 'K', limite: 22_256_184 },
]

export function DashFacturacionArea() {
  const { tenant } = useAuthStore()
  const { sucursalId } = useSucursalFilter()

  const dashFilter = (q: any) => {
    if (!sucursalId) return q
    return q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
  }

  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  const hoy = new Date()
  const inicioAnio = new Date(hoy.getFullYear(), 0, 1).toISOString()
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
  const seisMAtras = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1).toISOString()

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const { data: fData, isLoading } = useQuery({
    queryKey: ['dash-facturacion-area', tenant?.id, sucursalId],
    queryFn: async () => {
      // 1. venta_items del mes (IVA Débito) — filtrado por sucursal via ventas
      // venta_items no tiene sucursal_id: primero obtenemos IDs de ventas filtradas
      let qVentasMes = supabase.from('ventas').select('id')
        .eq('tenant_id', tenant!.id).gte('created_at', inicioMes)
      qVentasMes = dashFilter(qVentasMes)
      const { data: ventasMesRaw = [] } = await qVentasMes
      const ventaIdsMes = (ventasMesRaw ?? []).map((v: any) => v.id)
      let itemsMes: any[] = []
      if (ventaIdsMes.length > 0) {
        const { data } = await supabase.from('venta_items')
          .select('cantidad, precio_unitario, iva_monto, created_at')
          .in('venta_id', ventaIdsMes)
        itemsMes = data ?? []
      }
      const ivaDebito = itemsMes.reduce((a: number, vi: any) => a + (vi.iva_monto ?? 0), 0)
      const netoVentas = itemsMes.reduce((a: number, vi: any) => a + ((vi.precio_unitario ?? 0) - (vi.iva_monto ?? 0)), 0)

      // 2. IVA Crédito desde gastos del mes (iva_deducible=true)
      const iniciomesDate = inicioMes.split('T')[0]
      let qGastosMes = supabase.from('gastos')
        .select('iva_monto, iva_deducible').eq('tenant_id', tenant!.id)
        .eq('iva_deducible', true).gte('fecha', iniciomesDate)
      qGastosMes = dashFilter(qGastosMes)
      const { data: gastosMes = [] } = await qGastosMes
      const ivaCredito = (gastosMes ?? []).reduce((a: number, g: any) => a + (g.iva_monto ?? 0), 0)

      // 3. Posición
      const posicion = ivaDebito - ivaCredito

      // 4. Facturación del año (para topes)
      let qVentasAnio = supabase.from('ventas')
        .select('total').eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada']).gte('created_at', inicioAnio)
      qVentasAnio = dashFilter(qVentasAnio)
      const { data: ventasAnio = [] } = await qVentasAnio
      const totalAnio = (ventasAnio ?? []).reduce((a: number, v: any) => a + (v.total ?? 0), 0)

      // Encontrar categoría de monotributo
      const catMonotrib = MONOTRIB_LIMITES.find(c => totalAnio <= c.limite) ?? MONOTRIB_LIMITES[MONOTRIB_LIMITES.length - 1]
      const pctLimite = Math.round((totalAnio / catMonotrib.limite) * 100)

      // 5. Facturas con error (sin CAE o pendientes)
      const { data: ventasSinCAE = [] } = await supabase.from('ventas')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'facturada')
        .is('cae', null)
      const sinCAE = (ventasSinCAE as any)?.count ?? 0

      // 6. Evolución mensual IVA (últimos 6 meses) — filtrado por sucursal via ventas
      let qVentasHist6m = supabase.from('ventas').select('id')
        .eq('tenant_id', tenant!.id).gte('created_at', seisMAtras)
      qVentasHist6m = dashFilter(qVentasHist6m)
      const { data: ventasHist6mRaw = [] } = await qVentasHist6m
      const ventaIdsHist6m = (ventasHist6mRaw ?? []).map((v: any) => v.id)
      let itemsHist: any[] = []
      if (ventaIdsHist6m.length > 0) {
        const { data } = await supabase.from('venta_items')
          .select('iva_monto, precio_unitario, created_at').in('venta_id', ventaIdsHist6m)
        itemsHist = data ?? []
      }
      const monthlyIVA: Record<string, { neto: number; iva: number }> = {}
      for (const vi of itemsHist ?? []) {
        const mes = (vi as any).created_at.slice(0, 7)
        if (!monthlyIVA[mes]) monthlyIVA[mes] = { neto: 0, iva: 0 }
        monthlyIVA[mes].neto += (vi.precio_unitario ?? 0)
        monthlyIVA[mes].iva += (vi.iva_monto ?? 0)
      }
      const evolData = Object.entries(monthlyIVA).sort(([a],[b]) => a.localeCompare(b)).map(([mes, d]) => {
        const [y, m] = mes.split('-')
        return { label: `${MESES_ES[parseInt(m,10)-1]} ${y.slice(2)}`, neto: d.neto - d.iva, iva: d.iva }
      })

      // 7. Distribución alícuotas (del mes)
      // Proxy: desde venta_items.iva_monto vs precio_unitario calcular alícuota estimada
      const alicMap: Record<string, number> = {}
      for (const vi of itemsMes ?? []) {
        const pu = vi.precio_unitario ?? 0
        const ivm = vi.iva_monto ?? 0
        if (pu <= 0) continue
        const pct = Math.round((ivm / pu) * 100)
        const key = pct <= 0 ? '0' : pct <= 12 ? '10.5' : pct <= 22 ? '21' : '27'
        alicMap[key] = (alicMap[key] ?? 0) + ivm
      }
      const alicTotal = Object.values(alicMap).reduce((a, b) => a + b, 0)
      const alicData = Object.entries(alicMap).map(([tasa, total]) => ({ tasa: `${tasa}%`, total, pct: alicTotal > 0 ? Math.round((total/alicTotal)*100) : 0 }))

      // 8. Saldo a favor histórico (acumulado en gastos)
      const { data: gastosTotal = [] } = await supabase.from('gastos')
        .select('iva_monto').eq('tenant_id', tenant!.id).eq('iva_deducible', true)
      const { data: viTotal = [] } = await supabase.from('venta_items').select('iva_monto').eq('tenant_id', tenant!.id)
      const totalDebitoHist = (viTotal ?? []).reduce((a: number, vi: any) => a + (vi.iva_monto ?? 0), 0)
      const totalCreditoHist = (gastosTotal ?? []).reduce((a: number, g: any) => a + (g.iva_monto ?? 0), 0)
      const saldoFavor = Math.max(0, totalCreditoHist - totalDebitoHist)

      return {
        ivaDebito, ivaCredito, posicion, netoVentas,
        totalAnio, pctLimite, catMonotrib, sinCAE,
        evolData, alicData, saldoFavor,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  const insights = useMemo(() => {
    if (!fData) return []
    const list: { tipo: 'danger'|'warning'|'success'|'info'; titulo: string; impacto: string; accion: string; link: string }[] = []
    if ((fData.sinCAE ?? 0) > 0) list.push({ tipo: 'danger', titulo: `${fData.sinCAE} factura${fData.sinCAE!==1?'s':''} sin CAE registrado`, impacto: 'Comprobantes que podrían no haberse autorizado en ARCA. Verificá el estado con tu contador.', accion: 'Ver facturación', link: '/facturacion' })
    if (fData.pctLimite >= 90) list.push({ tipo: 'danger', titulo: `Estás al ${fData.pctLimite}% del límite estimado de categoría ${fData.catMonotrib.cat}`, impacto: `Según los comprobantes emitidos, estarías cerca del tope. Consultá con tu contador una posible recategorización.`, accion: 'Ver ventas', link: '/ventas' })
    else if (fData.pctLimite >= 75) list.push({ tipo: 'warning', titulo: `Al ${fData.pctLimite}% del tope estimado (Cat. ${fData.catMonotrib.cat})`, impacto: 'Estimación administrativa. Verificá con tu estudio contable antes de actuar.', accion: 'Ver ventas', link: '/ventas' })
    if (fData.posicion > 0) list.push({ tipo: 'info', titulo: `Posición estimada a pagar: ${fmt(fData.posicion)}`, impacto: 'El IVA Débito supera al Crédito. Calculá la liquidación exacta con tu contador antes del vencimiento.', accion: 'Ver gastos', link: '/gastos' })
    if (fData.ivaCredito === 0 && fData.ivaDebito > 0) list.push({ tipo: 'warning', titulo: 'Sin gastos con IVA Crédito registrados este mes', impacto: 'No detectamos facturas de proveedores con IVA deducible. ¿Se olvidaron de cargar?', accion: 'Ver gastos', link: '/gastos' })
    return list.slice(0, 4)
  }, [fData])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  return (
    <div className="space-y-5">
      {/* Banner legal */}
      <div className="flex items-start gap-3 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3">
        <Shield size={16} className="text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          <strong className="text-gray-600 dark:text-gray-300">Estimaciones administrativas.</strong> Los datos mostrados son cálculos basados en los comprobantes cargados en el sistema y <strong>no reemplazan la liquidación oficial de tu Estudio Contable.</strong> Consultá siempre con un Contador Público Matriculado antes de tomar decisiones fiscales.
        </p>
      </div>

      {/* Filtro */}
      <div className="flex items-center justify-end">
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all ${filterOpen ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} /> Filtros
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3><button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button></div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Los filtros avanzados están disponibles en el módulo de Facturación.</p>
              <a href="/facturacion" className="block mt-3 text-center text-xs font-medium text-accent hover:underline">Ir a Facturación →</a>
            </div>
          )}
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(fData?.posicion ?? 0) > 0 ? 'border-orange-300 dark:border-orange-800' : 'border-blue-300 dark:border-blue-800'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(fData?.posicion ?? 0) > 0 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}><FileText size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Posición Estimada</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(fData?.posicion ?? 0) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'}`}>{isLoading ? '—' : (fData?.posicion ?? 0) >= 0 ? `A pagar: ${fmtCorto(fData!.posicion)}` : `A favor: ${fmtCorto(Math.abs(fData!.posicion))}`}</p>
          <p className="text-xs text-muted mt-1.5">Estimación no vinculante. Confirmá con tu contador.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent"><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">IVA Débito Calculado</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(fData?.ivaDebito ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">IVA en los comprobantes emitidos este mes.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400"><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">IVA Crédito Teórico</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(fData?.ivaCredito ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">IVA en gastos con comprobante deducible.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"><CheckCircle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Saldo a Favor Histórico</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(fData?.saldoFavor ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Acumulado. No sincronizado con ARCA.</p>
        </div>

        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(fData?.pctLimite ?? 0) >= 85 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}><AlertTriangle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Proyección vs Tope Cat. {fData?.catMonotrib?.cat}</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(fData?.pctLimite ?? 0) >= 85 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : `${fData?.pctLimite ?? 0}%`}</p>
          <div className="mt-2 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, fData?.pctLimite ?? 0)}%`, backgroundColor: (fData?.pctLimite ?? 0) >= 90 ? '#EF4444' : (fData?.pctLimite ?? 0) >= 75 ? '#F59E0B' : '#22C55E' }} /></div>
          <p className="text-xs text-muted mt-1">Tope estimado: {fmtCorto(fData?.catMonotrib?.limite ?? 0)}/año</p>
        </div>

        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(fData?.sinCAE ?? 0) > 0 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(fData?.sinCAE ?? 0) > 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><Clock size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Comprobantes Observados</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(fData?.sinCAE ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : fData?.sinCAE ?? 0}</p>
          <p className="text-xs text-muted mt-1.5">Facturas sin CAE registrado en el sistema.</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Barras apiladas Neto + IVA */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><BarChart2 size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Peso Impositivo Estimado</h3><span className="ml-auto text-xs text-muted">Últimos 6 meses</span></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (fData?.evolData ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={fData!.evolData} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
                <Bar dataKey="neto" name="Neto" fill="#4B5563" fillOpacity={0.7} stackId="a" radius={[0,0,0,0]} maxBarSize={40} />
                <Bar dataKey="iva" name="IVA" fill="#7B00FF" fillOpacity={0.85} stackId="a" radius={[4,4,0,0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted text-center py-8">Sin datos históricos</p>}
        </div>

        {/* Donut alícuotas */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><FileText size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Distribución de Alícuotas</h3><span className="ml-auto text-xs text-muted">Este mes</span></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (fData?.alicData ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}><PieChart><Pie data={fData!.alicData} cx="50%" cy="50%" innerRadius={32} outerRadius={55} dataKey="total" paddingAngle={2} strokeWidth={0}>{fData!.alicData.map((d: any) => <Cell key={d.tasa} fill={IVA_COLORS[d.tasa.replace('%','')] ?? '#6B7280'} />)}</Pie><Tooltip formatter={(v: any) => fmt(Number(v))} /></PieChart></ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {fData!.alicData.map((d: any) => (
                  <div key={d.tasa} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: IVA_COLORS[d.tasa.replace('%','')] ?? '#6B7280' }} /><span className="text-xs text-gray-600 dark:text-gray-400">IVA {d.tasa}</span></div>
                    <span className="text-xs font-semibold">{d.pct}%</span>
                  </div>
                ))}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Distribución estimada basada en comprobantes del sistema.</p>
              </div>
            </div>
          ) : <p className="text-sm text-muted text-center py-8">Sin IVA registrado este mes</p>}
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3"><Zap size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Referencias Administrativas</h3><span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span></div>
          <div className="grid sm:grid-cols-2 gap-3">{insights.map((ins, i) => { const Icon = INSIGHT_ICONS[ins.tipo]; return <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />} title={ins.titulo} description={ins.impacto} action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }} /> })}</div>
        </div>
      )}

      {/* Footer legal */}
      <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center">Estimaciones de gestión interna. Este reporte carece de validez legal y fiscal. Las estimaciones de impuestos no reemplazan el trabajo de un Contador Público Matriculado.</p>
    </div>
  )
}
