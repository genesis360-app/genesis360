import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, ScatterChart, Scatter, CartesianGrid, ReferenceLine,
} from 'recharts'
import { SlidersHorizontal, X, Send, AlertTriangle, CheckCircle, Clock, BarChart2, Zap, TrendingDown, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { InsightCard } from '@/components/InsightCard'

const COURIER_COLORS = ['#7B00FF','#06B6D4','#F59E0B','#22C55E','#EF4444','#6B7280']
const ESTADO_COLORS: Record<string, string> = {
  entregado: '#22C55E', en_camino: '#7B00FF', despachado: '#06B6D4',
  pendiente: '#9CA3AF', devolucion: '#EF4444', cancelado: '#6B7280',
}

function fmt(v: number) { return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` }
function fmtCorto(v: number) {
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v/1_000).toFixed(0)}K`
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function EnvioTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-100">Envío #{d?.numero}</p>
      <p className="text-accent">Costo envío: {fmt(d?.costoEnvio ?? 0)}</p>
      <p className="text-gray-500">Ganancia neta: {fmt(d?.gananciaNeta ?? 0)}</p>
      {d?.deficit && <p className="text-red-500 font-semibold">⚠ Pérdida por flete</p>}
    </div>
  )
}

export function DashEnviosArea() {
  const { tenant } = useAuthStore()
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: eData, isLoading } = useQuery({
    queryKey: ['dash-envios-area', tenant?.id],
    queryFn: async () => {
      // 1. Todos los envíos del mes
      const { data: envios = [] } = await supabase.from('envios')
        .select('id, numero, estado, courier, costo_cotizado, venta_id, created_at')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', inicioMes)
        .order('created_at', { ascending: false })

      // 2. Ventas vinculadas con costo_envio
      const ventaIds = (envios ?? []).filter((e: any) => e.venta_id).map((e: any) => e.venta_id)
      let ventasEnvio: any[] = []
      if (ventaIds.length > 0) {
        const CHUNK = 100
        for (let i = 0; i < ventaIds.length; i += CHUNK) {
          const { data } = await supabase.from('ventas')
            .select('id, total, costo_envio')
            .in('id', ventaIds.slice(i, i + CHUNK))
          ventasEnvio = ventasEnvio.concat(data ?? [])
        }
      }
      const ventasMap: Record<string, { total: number; costo_envio: number }> = {}
      for (const v of ventasEnvio) ventasMap[v.id] = { total: v.total ?? 0, costo_envio: v.costo_envio ?? 0 }

      // 3. venta_items para costo de producto (para ganancia neta)
      let itemsData: any[] = []
      if (ventaIds.length > 0) {
        const CHUNK = 100
        for (let i = 0; i < ventaIds.length; i += CHUNK) {
          const { data } = await supabase.from('venta_items')
            .select('venta_id, cantidad, precio_unitario, precio_costo_historico')
            .in('venta_id', ventaIds.slice(i, i + CHUNK))
          itemsData = itemsData.concat(data ?? [])
        }
      }
      const costoMap: Record<string, number> = {}
      for (const vi of itemsData) {
        costoMap[vi.venta_id] = (costoMap[vi.venta_id] ?? 0) + (vi.precio_costo_historico ?? 0) * (vi.cantidad ?? 0)
      }

      // ── KPI 1: Costo Medio por Envío ─────────────────────────────────────
      const enviosConCosto = (envios ?? []).filter((e: any) => e.costo_cotizado > 0)
      const costoMedio = enviosConCosto.length > 0 ? enviosConCosto.reduce((a: number, e: any) => a + (e.costo_cotizado ?? 0), 0) / enviosConCosto.length : 0

      // ── KPI 2: Subsidio Logístico ─────────────────────────────────────────
      // subsidio = sum(costo_cotizado courier - costo_envio cobrado al cliente)
      let subsidioTotal = 0
      for (const e of envios ?? []) {
        if (!e.venta_id) continue
        const venta = ventasMap[e.venta_id]
        if (!venta) continue
        const cobradoAlCliente = venta.costo_envio ?? 0
        const costoReal = e.costo_cotizado ?? 0
        subsidioTotal += Math.max(0, costoReal - cobradoAlCliente)
      }

      // ── KPI 3: OTIF (entregados sin problemas) ────────────────────────────
      const totalEnvios = (envios ?? []).length
      const entregados = (envios ?? []).filter((e: any) => e.estado === 'entregado').length
      const otif = totalEnvios > 0 ? (entregados / totalEnvios) * 100 : null

      // ── KPI 4: Devoluciones ───────────────────────────────────────────────
      const devueltos = (envios ?? []).filter((e: any) => e.estado === 'devolucion').length
      const tasaDev = totalEnvios > 0 ? (devueltos / totalEnvios) * 100 : null

      // ── KPI 5: Tiempo medio estimado (días desde creación a entregado) ────
      // No tenemos fecha_entrega_real en schema, approximation: use fecha_entrega_acordada
      const entregadosArr = (envios ?? []).filter((e: any) => e.estado === 'entregado')
      // No direct fecha_entrega_real - use proxy days from created to "now" for pending
      const tiempoMedioHs: number | null = null // would need delivery timestamp field

      // ── KPI 6: En Tránsito ────────────────────────────────────────────────
      const enTransito = (envios ?? []).filter((e: any) => ['en_camino','despachado'].includes(e.estado)).length

      // ── Funnel Pipeline ───────────────────────────────────────────────────
      const funnelData = [
        { label: 'Para armar', count: (envios ?? []).filter((e: any) => e.estado === 'pendiente').length, color: '#9CA3AF' },
        { label: 'Despachado', count: (envios ?? []).filter((e: any) => e.estado === 'despachado').length, color: '#06B6D4' },
        { label: 'En camino', count: (envios ?? []).filter((e: any) => e.estado === 'en_camino').length, color: '#7B00FF' },
        { label: 'Entregado', count: entregados, color: '#22C55E' },
      ]
      const maxFunnel = Math.max(...funnelData.map(f => f.count), 1)

      // ── Por courier ───────────────────────────────────────────────────────
      const courierMap: Record<string, { count: number; entregados: number; costo: number }> = {}
      for (const e of envios ?? []) {
        const c = e.courier || 'Sin courier'
        if (!courierMap[c]) courierMap[c] = { count: 0, entregados: 0, costo: 0 }
        courierMap[c].count++
        if (e.estado === 'entregado') courierMap[c].entregados++
        courierMap[c].costo += e.costo_cotizado ?? 0
      }
      const courierData = Object.entries(courierMap).map(([nombre, d]) => ({
        nombre, count: d.count, otif: d.count > 0 ? Math.round((d.entregados/d.count)*100) : 0,
        noOtif: d.count > 0 ? 100 - Math.round((d.entregados/d.count)*100) : 100,
        costoMedio: d.count > 0 ? d.costo/d.count : 0,
      })).sort((a, b) => b.count - a.count).slice(0, 5)

      // ── Scatter subsidio vs ganancia ──────────────────────────────────────
      const scatterData = (envios ?? []).slice(0, 50).map((e: any) => {
        if (!e.venta_id) return null
        const venta = ventasMap[e.venta_id]
        if (!venta) return null
        const costo = costoMap[e.venta_id] ?? 0
        const costoEnvio = e.costo_cotizado ?? 0
        const cobradoAlCliente = venta.costo_envio ?? 0
        const gananciaNeta = venta.total - costo - (costoEnvio - cobradoAlCliente)
        const subsidio = Math.max(0, costoEnvio - cobradoAlCliente)
        return { numero: e.numero, gananciaNeta: Math.round(gananciaNeta), costoEnvio: Math.round(subsidio), deficit: subsidio > gananciaNeta }
      }).filter(Boolean)

      // ── Envíos sin update en +72h ─────────────────────────────────────────
      const hace72h = new Date(Date.now() - 72 * 3600000).toISOString()
      const sinUpdate72h = (envios ?? []).filter((e: any) =>
        ['en_camino','despachado'].includes(e.estado) && e.created_at < hace72h
      ).length

      return {
        totalEnvios, costoMedio, subsidioTotal, otif, tasaDev, enTransito,
        funnelData, maxFunnel, courierData, scatterData,
        entregados, devueltos, sinUpdate72h,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  const insights = useMemo(() => {
    if (!eData) return []
    const list: { tipo: 'danger'|'warning'|'success'|'info'; titulo: string; impacto: string; accion: string; link: string }[] = []
    if (eData.sinUpdate72h > 0) list.push({ tipo: 'danger', titulo: `${eData.sinUpdate72h} envío${eData.sinUpdate72h!==1?'s':''} sin actualización de tracking en +72hs`, impacto: 'Podrían estar extraviados o el courier no actualizó su estado. Iniciá el reclamo.', accion: 'Ver envíos', link: '/envios' })
    if (eData.subsidioTotal > 0) {
      const sTotal = eData.subsidioTotal
      if (sTotal > 0) list.push({ tipo: 'warning', titulo: `${fmtCorto(sTotal)} de subsidio logístico absorbido este mes`, impacto: 'Estás pagando la diferencia entre el costo del courier y lo que cobraste al cliente por envío.', accion: 'Ver envíos', link: '/envios' })
    }
    if (eData.tasaDev !== null && eData.tasaDev > 5) list.push({ tipo: 'danger', titulo: `Tasa de devoluciones del ${eData.tasaDev.toFixed(1)}%`, impacto: `${eData.devueltos} envíos regresaron. Revisá embalaje y fiabilidad del courier.`, accion: 'Ver envíos', link: '/envios' })
    if (eData.otif !== null && eData.otif >= 95) list.push({ tipo: 'success', titulo: `OTIF del ${eData.otif.toFixed(1)}% — Excelente tasa de entrega`, impacto: `${eData.entregados} de ${eData.totalEnvios} envíos entregados exitosamente este mes.`, accion: 'Ver envíos', link: '/envios' })
    if (eData.enTransito > 20) list.push({ tipo: 'info', titulo: `${eData.enTransito} paquetes actualmente en la calle`, impacto: 'Alto volumen en tránsito. Asegurate de tener capacidad para gestionar posibles reclamos.', accion: 'Ver envíos', link: '/envios' })
    return list.slice(0, 4)
  }, [eData, fmt])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Envíos del mes actual · {eData?.totalEnvios ?? 0} operaciones</p>
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all ${filterOpen ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} /> Filtros
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3><button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button></div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Los filtros por courier y zona están en el módulo Envíos.</p>
              <a href="/envios" className="block mt-3 text-center text-xs font-medium text-accent hover:underline">Ir a Envíos →</a>
            </div>
          )}
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent"><Send size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Costo Medio por Envío</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(eData?.costoMedio ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Promedio cobrado por los couriers este mes.</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(eData?.subsidioTotal ?? 0) > 0 ? 'border-orange-300 dark:border-orange-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(eData?.subsidioTotal ?? 0) > 0 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><TrendingDown size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Subsidio Logístico</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(eData?.subsidioTotal ?? 0) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-primary'}`}>{isLoading ? '—' : fmtCorto(eData?.subsidioTotal ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">De tu bolsillo por cubrir envíos gratis o subsidiados.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(eData?.otif ?? 100) >= 95 ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}`}><CheckCircle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">OTIF (Entregas Exitosas)</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(eData?.otif ?? 100) >= 95 ? 'text-green-600 dark:text-green-400' : 'text-primary'}`}>{isLoading ? '—' : eData?.otif != null ? `${eData.otif.toFixed(1)}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">{eData?.entregados ?? 0} de {eData?.totalEnvios ?? 0} entregados exitosamente.</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(eData?.tasaDev ?? 0) > 5 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(eData?.tasaDev ?? 0) > 5 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><AlertTriangle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Logística Inversa</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(eData?.tasaDev ?? 0) > 5 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : eData?.tasaDev != null ? `${eData.tasaDev.toFixed(1)}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">{eData?.devueltos ?? 0} envíos devueltos al depósito.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Clock size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Velocidad (Tiempo Medio)</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">—</p>
          <p className="text-xs text-muted mt-1.5">Disponible cuando se integre tracking en tiempo real.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent"><Package size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Volumen en Tránsito</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : eData?.enTransito ?? 0}</p>
          <p className="text-xs text-muted mt-1.5">Paquetes actualmente en camino o despachados.</p>
        </div>
      </div>

      {/* Funnel + Courier */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><Send size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cuello de Botella Operativo</h3></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <div className="space-y-3">
              {(eData?.funnelData ?? []).map((step) => (
                <div key={step.label}>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs font-medium text-gray-600 dark:text-gray-400">{step.label}</span><span className="text-xs font-semibold text-primary">{step.count} envíos</span></div>
                  <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden"><div className="h-full rounded-lg flex items-center justify-center text-white text-[10px] font-semibold transition-all" style={{ width: `${Math.max(4, (step.count / eData!.maxFunnel) * 100)}%`, backgroundColor: step.color }}>{step.count > 0 ? step.count : ''}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rendimiento por courier */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><BarChart2 size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Rendimiento por Courier</h3></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (eData?.courierData ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={eData!.courierData} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                <XAxis type="number" domain={[0,100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v: any, name: any) => [`${v}%`, name === 'otif' ? 'Entregados' : 'Retrasos']} />
                <Bar dataKey="otif" name="Entregados" fill="#22C55E" fillOpacity={0.8} stackId="a" />
                <Bar dataKey="noOtif" name="No entregados" fill="#EF4444" fillOpacity={0.6} stackId="a" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted text-center py-8">Sin datos de courier</p>}
        </div>
      </div>

      {/* Scatter subsidio vs ganancia */}
      {(eData?.scatterData ?? []).length > 0 && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Subsidio Logístico vs Ganancia Neta</h3></div>
          <p className="text-xs text-muted mb-4 ml-5">Cada punto = una venta. Puntos por encima de la línea roja = pérdida real por el flete.</p>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" />
              <XAxis type="number" dataKey="gananciaNeta" name="Ganancia neta" tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} label={{ value: 'Ganancia neta →', position: 'insideRight', fontSize: 9, fill: '#9CA3AF' }} />
              <YAxis type="number" dataKey="costoEnvio" name="Subsidio" tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} label={{ value: '↑ Subsidio flete', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#9CA3AF' }} />
              <Tooltip content={<EnvioTooltip />} />
              <ReferenceLine y={0} stroke="#EF4444" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'Punto de equilibrio', position: 'right', fontSize: 9, fill: '#EF4444' }} />
              <Scatter data={eData!.scatterData}>
                {(eData!.scatterData as any[]).map((d, i) => (
                  <Cell key={i} fill={d.deficit ? '#EF4444' : '#7B00FF'} fillOpacity={0.7} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-accent" /><span className="text-xs text-muted">Con ganancia</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-red-500" /><span className="text-xs text-muted">A pérdida</span></div>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3"><Zap size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu Gerente de Tráfico</h3><span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span></div>
          <div className="grid sm:grid-cols-2 gap-3">{insights.map((ins, i) => { const Icon = INSIGHT_ICONS[ins.tipo]; return <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />} title={ins.titulo} description={ins.impacto} action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }} /> })}</div>
        </div>
      )}
    </div>
  )
}
