import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, ComposedChart, Line, ScatterChart, Scatter, CartesianGrid, ReferenceLine,
} from 'recharts'
import { SlidersHorizontal, X, TrendingUp, TrendingDown, Zap, AlertTriangle, CheckCircle, Clock, BarChart2, Target } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { InsightCard } from '@/components/InsightCard'

const CANAL_COLORS = ['#7B00FF','#06B6D4','#F59E0B','#22C55E','#EF4444']
const CANAL_DISPLAY: Record<string, string> = { POS: 'Presencial', pos: 'Presencial', tiendanube: 'TiendaNube', mercadolibre: 'MercadoLibre', whatsapp: 'WhatsApp' }
const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmt(v: number) { return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` }
function fmtCorto(v: number) {
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v/1_000).toFixed(0)}K`
  return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function PoasTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-100">{label}</p>
      {payload.map((p: any) => <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.dataKey.includes('poas') ? `${p.value?.toFixed(1)}x` : fmt(p.value ?? 0)}</p>)}
    </div>
  )
}

export function DashMarketingArea() {
  const { tenant } = useAuthStore()
  const { sucursalId } = useSucursalFilter()

  const dashFilter = (q: any) => {
    if (!sucursalId) return q
    return q.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
  }

  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const hoy = new Date()
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
  const seisMAtras = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1).toISOString()

  const { data: mData, isLoading } = useQuery({
    queryKey: ['dash-marketing-area', tenant?.id, sucursalId],
    queryFn: async () => {
      // 1. Gastos de marketing del mes (por categoría)
      const inicioMesDate = inicioMes.split('T')[0]
      let qGastosMarketing = supabase.from('gastos')
        .select('monto, descripcion, categoria, fecha').eq('tenant_id', tenant!.id)
        .gte('fecha', inicioMesDate)
        .or('categoria.ilike.%marketing%,categoria.ilike.%publicidad%,categoria.ilike.%advertising%,categoria.ilike.%pauta%,descripcion.ilike.%facebook%,descripcion.ilike.%google%,descripcion.ilike.%instagram%,descripcion.ilike.%meta%')
      qGastosMarketing = dashFilter(qGastosMarketing)
      const { data: gastosMarketing = [] } = await qGastosMarketing
      const inversionTotal = (gastosMarketing ?? []).reduce((a: number, g: any) => a + (g.monto ?? 0), 0)

      // 2. Ventas del mes con items (para calcular ganancia neta y POAS)
      let qVentas = supabase.from('ventas')
        .select('id, total, costo_envio, origen').eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes)
      qVentas = dashFilter(qVentas)
      const { data: ventas = [] } = await qVentas
      const ventaIds = (ventas ?? []).map((v: any) => v.id)

      let itemsData: any[] = []
      if (ventaIds.length > 0) {
        const { data } = await supabase.from('venta_items')
          .select('venta_id, cantidad, precio_unitario, precio_costo_historico, iva_monto')
          .in('venta_id', ventaIds.slice(0, 500))
        itemsData = data ?? []
      }

      // Costo por venta
      const costoMap: Record<string, number> = {}
      const netoMap: Record<string, number> = {}
      for (const vi of itemsData) {
        costoMap[vi.venta_id] = (costoMap[vi.venta_id] ?? 0) + (vi.precio_costo_historico ?? 0) * (vi.cantidad ?? 0)
        netoMap[vi.venta_id] = (netoMap[vi.venta_id] ?? 0) + ((vi.precio_unitario ?? 0) - (vi.iva_monto ?? 0)) * (vi.cantidad ?? 0)
      }

      // Ganancia neta total
      let gananciaNeta = 0
      let totalVentas = 0
      let clientesNuevosEstim = 0
      for (const v of ventas ?? []) {
        const neto = netoMap[v.id] ?? (v.total ?? 0)
        const costo = costoMap[v.id] ?? 0
        const flete = v.costo_envio ?? 0
        const gNeta = neto - costo - flete
        gananciaNeta += gNeta
        totalVentas += v.total ?? 0
      }

      // ── KPI POAS ────────────────────────────────────────────────────────
      const poas = inversionTotal > 0 ? gananciaNeta / inversionTotal : null
      const roas = inversionTotal > 0 ? totalVentas / inversionTotal : null

      // ── KPI: Dependencia publicidad ─────────────────────────────────────
      // Ventas totales en el mes
      let qVentasTotales = supabase.from('ventas')
        .select('total').eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada']).gte('created_at', inicioMes)
      qVentasTotales = dashFilter(qVentasTotales)
      const { data: ventasTotales = [] } = await qVentasTotales
      const totalMes = (ventasTotales ?? []).reduce((a: number, v: any) => a + (v.total ?? 0), 0)
      const dependencia = totalMes > 0 && inversionTotal > 0 ? Math.round((totalVentas / totalMes) * 100) : null

      // ── KPI: CAC ────────────────────────────────────────────────────────
      // Nuevos clientes en el mes (primera compra)
      const hace30 = new Date(Date.now() - 30 * 86400000).toISOString()
      const clientesMes = new Set((ventas ?? []).filter((v: any) => v.cliente_id).map((v: any) => v.cliente_id))
      const { data: historial = [] } = await supabase.from('ventas')
        .select('cliente_id').eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .lt('created_at', inicioMes)
      const clientesHistoricos = new Set((historial ?? []).map((v: any) => v.cliente_id))
      const clientesNuevosMes = [...clientesMes].filter(id => !clientesHistoricos.has(id)).length
      const cac = clientesNuevosMes > 0 && inversionTotal > 0 ? Math.round(inversionTotal / clientesNuevosMes) : null

      // ── Chart 1: Evolución Inversión vs Ganancia ─────────────────────────
      let qGastosHist = supabase.from('gastos')
        .select('monto, fecha').eq('tenant_id', tenant!.id)
        .gte('fecha', seisMAtras.split('T')[0])
        .or('categoria.ilike.%marketing%,categoria.ilike.%publicidad%,descripcion.ilike.%facebook%,descripcion.ilike.%google%,descripcion.ilike.%instagram%')
      qGastosHist = dashFilter(qGastosHist)
      const { data: gastosHist = [] } = await qGastosHist
      let qVentasHist = supabase.from('ventas')
        .select('id, total, created_at').eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada']).gte('created_at', seisMAtras)
      qVentasHist = dashFilter(qVentasHist)
      const { data: ventasHist = [] } = await qVentasHist
      const { data: viHist = [] } = await supabase.from('venta_items')
        .select('venta_id, cantidad, precio_unitario, precio_costo_historico, iva_monto')
        .eq('tenant_id', tenant!.id).gte('created_at', seisMAtras).limit(2000)
      const costoHistMap: Record<string, number> = {}
      const netoHistMap: Record<string, number> = {}
      for (const vi of viHist ?? []) {
        costoHistMap[vi.venta_id] = (costoHistMap[vi.venta_id] ?? 0) + (vi.precio_costo_historico ?? 0) * (vi.cantidad ?? 0)
        netoHistMap[vi.venta_id] = (netoHistMap[vi.venta_id] ?? 0) + ((vi.precio_unitario ?? 0) - (vi.iva_monto ?? 0)) * (vi.cantidad ?? 0)
      }
      const monthlyMkt: Record<string, { inversion: number; gananciaNeta: number }> = {}
      for (const g of gastosHist ?? []) {
        const mes = (g as any).fecha.slice(0, 7)
        if (!monthlyMkt[mes]) monthlyMkt[mes] = { inversion: 0, gananciaNeta: 0 }
        monthlyMkt[mes].inversion += g.monto ?? 0
      }
      for (const v of ventasHist ?? []) {
        const mes = (v as any).created_at.slice(0, 7)
        if (!monthlyMkt[mes]) monthlyMkt[mes] = { inversion: 0, gananciaNeta: 0 }
        const neto = netoHistMap[v.id] ?? (v.total ?? 0)
        const costo = costoHistMap[v.id] ?? 0
        monthlyMkt[mes].gananciaNeta += neto - costo
      }
      const evolData = Object.entries(monthlyMkt).sort(([a],[b]) => a.localeCompare(b)).map(([mes, d]) => {
        const [y, m] = mes.split('-')
        return {
          label: `${MESES_ES[parseInt(m,10)-1]} ${y.slice(2)}`,
          inversion: Math.round(d.inversion),
          gananciaNeta: Math.round(d.gananciaNeta),
          poas: d.inversion > 0 ? +(d.gananciaNeta / d.inversion).toFixed(1) : 0,
        }
      })

      // ── Chart 2: Donut por canal ─────────────────────────────────────────
      const canalMap: Record<string, number> = {}
      for (const v of ventas ?? []) {
        const canal = CANAL_DISPLAY[v.origen ?? 'POS'] ?? (v.origen || 'Presencial')
        canalMap[canal] = (canalMap[canal] ?? 0) + (gananciaNeta > 0 ? (gananciaNeta / Math.max(1, (ventas ?? []).length)) : 0)
      }
      const canalTotal = Object.values(canalMap).reduce((a, b) => a + b, 0)
      const canalData = Object.entries(canalMap)
        .map(([nombre, total]) => ({ nombre, total: Math.round(total), pct: canalTotal > 0 ? Math.round((total/canalTotal)*100) : 0 }))
        .sort((a, b) => b.total - a.total)

      // ── Chart 3: Radar de "campañas" (por descripcion de gasto) ─────────
      const campMap: Record<string, number> = {}
      for (const g of gastosMarketing ?? []) {
        const camp = g.descripcion?.slice(0, 25) ?? 'Sin nombre'
        campMap[camp] = (campMap[camp] ?? 0) + (g.monto ?? 0)
      }
      const campData = Object.entries(campMap).map(([nombre, inversion]) => {
        const gProrata = inversionTotal > 0 ? (inversion / inversionTotal) * gananciaNeta : 0
        return { nombre: nombre.length > 20 ? nombre.slice(0, 19) + '…' : nombre, inversion: Math.round(inversion), ganancia: Math.round(gProrata), poas: inversion > 0 ? +(gProrata / inversion).toFixed(1) : 0 }
      }).sort((a, b) => b.inversion - a.inversion).slice(0, 8)

      return {
        inversionTotal, poas, roas, gananciaNeta, cac, dependencia,
        clientesNuevosMes, evolData, canalData, campData,
        totalVentas, totalMes,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  const insights = useMemo(() => {
    if (!mData) return []
    const list: { tipo: 'danger'|'warning'|'success'|'info'; titulo: string; impacto: string; accion: string; link: string }[] = []
    if (mData.poas !== null) {
      if (mData.poas < 1) list.push({ tipo: 'danger', titulo: `POAS de ${mData.poas.toFixed(1)}x — Pérdida real por publicidad`, impacto: `Por cada $1 invertido en publicidad, recuperás ${(mData.poas*100).toFixed(0)} centavos. Revisá costos, fletes y descuentos antes de seguir gastando.`, accion: 'Ver gastos', link: '/gastos' })
      else if (mData.poas >= 2) list.push({ tipo: 'success', titulo: `POAS de ${mData.poas.toFixed(1)}x — Excelente rentabilidad publicitaria`, impacto: `Por cada $1 que invertís, ganás $${mData.poas.toFixed(1)} limpios. Es un buen momento para aumentar el presupuesto.`, accion: 'Ver ventas', link: '/ventas' })
      else list.push({ tipo: 'warning', titulo: `POAS de ${mData.poas.toFixed(1)}x — Margen justo`, impacto: 'Estás cubriendo costos, pero con poco margen. Optimizá antes de escalar.', accion: 'Ver gastos', link: '/gastos' })
    }
    if (mData.inversionTotal === 0) list.push({ tipo: 'info', titulo: 'Sin gastos de marketing detectados este mes', impacto: 'Si tenés campañas activas, cargá los gastos de publicidad con categoría "Marketing" o "Publicidad" para activar el módulo.', accion: 'Cargar gasto', link: '/gastos' })
    if (mData.dependencia !== null && mData.dependencia > 60) list.push({ tipo: 'warning', titulo: `El ${mData.dependencia}% de tus ventas dependen de la publicidad pagada`, impacto: 'Alta dependencia. Si apagás los anuncios, tu facturación cae drásticamente. Invertí en canales propios.', accion: 'Ver clientes', link: '/clientes' })
    if (mData.roas !== null && mData.poas !== null && mData.roas > mData.poas * 3) list.push({ tipo: 'warning', titulo: `ROAS (${mData.roas.toFixed(1)}x) vs POAS real (${mData.poas.toFixed(1)}x)`, impacto: 'Hay una brecha enorme. Tu plataforma reporta mucho "éxito", pero tu ganancia real es bastante menor. Tus costos y fletes se comen el margen.', accion: 'Ver ventas', link: '/ventas' })
    return list.slice(0, 4)
  }, [mData])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  const poasColor = mData?.poas == null ? '#9CA3AF' : mData.poas >= 2 ? '#22C55E' : mData.poas >= 1 ? '#F59E0B' : '#EF4444'
  const poasBg = mData?.poas == null ? 'bg-gray-100 dark:bg-gray-700' : mData.poas >= 2 ? 'bg-green-100 dark:bg-green-900/30' : mData.poas >= 1 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-red-100 dark:bg-red-900/30'

  return (
    <div className="space-y-5">
      {/* Fórmula POAS */}
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl p-4">
        <p className="text-xs font-semibold text-accent mb-1">La fórmula del POAS (Rentabilidad Real)</p>
        <p className="text-xs text-gray-600 dark:text-gray-400">POAS = (Ventas − Costo Productos − Flete − Comisiones) ÷ Inversión en Publicidad</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-green-600 dark:text-green-400">POAS &gt; 1x → Ganás dinero</span>
          <span className="text-amber-600 dark:text-amber-400">POAS = 1x → Empate</span>
          <span className="text-red-500">POAS &lt; 1x → Perdés dinero</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">Este mes · Gastos con categoría "Marketing" o "Publicidad"</p>
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all ${filterOpen ? 'border-accent bg-accent/5 text-accent' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} /> Filtros
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5">
              <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3><button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button></div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Para activar este módulo, cargá los gastos de publicidad con categoría "Marketing" o "Publicidad".</p>
              <a href="/gastos" className="block text-center text-xs font-medium text-accent hover:underline">Cargar gasto de publicidad →</a>
            </div>
          )}
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"><TrendingDown size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Plata en Anuncios</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : fmtCorto(mData?.inversionTotal ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Total pagado a plataformas este mes.</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(mData?.poas ?? 0) < 1 && mData?.poas != null ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${poasBg}`}><Target size={20} style={{ color: poasColor }} /></div></div>
          <p className="text-sm font-medium text-muted">POAS (Rentabilidad Real)</p>
          <p className="text-3xl font-bold mt-1 tabular-nums" style={{ color: poasColor }}>{isLoading ? '—' : mData?.poas != null ? `${mData.poas.toFixed(1)}x` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">{mData?.poas != null ? mData.poas >= 1 ? `Por $1 invertido, ganás $${mData.poas.toFixed(1)} limpios.` : '¡Pérdida real! Revisá campañas urgente.' : 'Sin inversión registrada este mes.'}</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"><TrendingUp size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Ganancia Neta Publicitaria</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(mData?.gananciaNeta ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>{isLoading ? '—' : fmtCorto(mData?.gananciaNeta ?? 0)}</p>
          <p className="text-xs text-muted mt-1.5">Ingresos − costos − fletes − publicidad.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">CAC (Costo por Nuevo Cliente)</p>
          <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{isLoading ? '—' : mData?.cac != null ? fmtCorto(mData.cac) : '—'}</p>
          <p className="text-xs text-muted mt-1.5">{mData?.clientesNuevosMes ?? 0} nuevos clientes este mes.</p>
        </div>
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3"><div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-400"><BarChart2 size={20} /></div></div>
          <p className="text-sm font-medium text-muted">ROAS (Lo que dice la plataforma)</p>
          <p className="text-2xl font-semibold text-gray-400 mt-1 tabular-nums">{isLoading ? '—' : mData?.roas != null ? `${mData.roas.toFixed(1)}x` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">Sin descontar costos. No es la ganancia real.</p>
        </div>
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(mData?.dependencia ?? 0) > 60 ? 'border-amber-300 dark:border-amber-800' : 'border-border-ds'}`}>
          <div className="mb-3"><div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(mData?.dependencia ?? 0) > 60 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}><AlertTriangle size={20} /></div></div>
          <p className="text-sm font-medium text-muted">Dependencia Publicitaria</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${(mData?.dependencia ?? 0) > 60 ? 'text-amber-600 dark:text-amber-400' : 'text-primary'}`}>{isLoading ? '—' : mData?.dependencia != null ? `${mData.dependencia}%` : '—'}</p>
          <p className="text-xs text-muted mt-1.5">De tus ventas totales atribuibles a publicidad.</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Evolución inversión vs ganancia */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><TrendingUp size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Gasto vs Ganancia Real</h3><span className="ml-auto text-xs text-muted">Últimos 6 meses</span></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (mData?.evolData ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={mData!.evolData} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<PoasTooltip />} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
                <Bar yAxisId="left" dataKey="inversion" name="Inversión" fill="#6B7280" fillOpacity={0.5} radius={[4,4,0,0]} maxBarSize={40} />
                <Line yAxisId="left" type="monotone" dataKey="gananciaNeta" name="Ganancia neta" stroke="#7B00FF" strokeWidth={2.5} dot={{ r: 3, fill: '#7B00FF' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted text-center py-8">Sin datos de marketing históricos</p>}
        </div>

        {/* Donut por canal */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4"><BarChart2 size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">¿Dónde rinde más la plata?</h3></div>
          {isLoading ? <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (mData?.canalData ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={130} height={130}><PieChart><Pie data={mData!.canalData} cx="50%" cy="50%" innerRadius={32} outerRadius={55} dataKey="total" paddingAngle={2} strokeWidth={0}>{mData!.canalData.map((_: any, i: number) => <Cell key={i} fill={CANAL_COLORS[i % CANAL_COLORS.length]} />)}</Pie><Tooltip formatter={(v: any) => fmt(Number(v))} /></PieChart></ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {mData!.canalData.map((c: any, i: number) => (
                  <div key={c.nombre} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0"><div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CANAL_COLORS[i % CANAL_COLORS.length] }} /><span className="text-xs text-gray-600 dark:text-gray-400 truncate">{c.nombre}</span></div>
                    <span className="text-xs font-semibold flex-shrink-0">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-muted text-center py-8">Sin datos de canal</p>}
        </div>
      </div>

      {/* Radar de campañas / gastos marketing */}
      {(mData?.campData ?? []).length > 0 && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><Target size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">El Radar de Campañas</h3><span className="ml-auto text-xs text-muted">POAS por destino de gasto</span></div>
          <p className="text-xs text-muted mb-4 ml-5">Cada barra con POAS &lt; 1x = campaña a pérdida.</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={mData!.campData} margin={{ top: 5, right: 10, left: 5, bottom: 30 }}>
              <XAxis dataKey="nombre" tick={{ fontSize: 9, fill: '#9CA3AF' }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tickFormatter={v => `${v}x`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={32} />
              <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}x`, 'POAS']} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
              <ReferenceLine y={1} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1.5} />
              <Bar dataKey="poas" radius={[4,4,0,0]} maxBarSize={36}>
                {(mData?.campData ?? []).map((d: any, i: number) => (
                  <Cell key={i} fill={d.poas >= 2 ? '#22C55E' : d.poas >= 1 ? '#F59E0B' : '#EF4444'} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3"><Zap size={15} className="text-accent" /><h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu Analista de Marketing</h3><span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span></div>
          <div className="grid sm:grid-cols-2 gap-3">{insights.map((ins, i) => { const Icon = INSIGHT_ICONS[ins.tipo]; return <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />} title={ins.titulo} description={ins.impacto} action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }} /> })}</div>
        </div>
      )}

      <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center">Los datos de inversión se basan en gastos cargados manualmente. La ganancia neta es estimada por Génesis360 según los costos del inventario.</p>
    </div>
  )
}
