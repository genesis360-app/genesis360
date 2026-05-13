import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import {
  SlidersHorizontal, X, Package, Wrench, Zap, Clock,
  AlertTriangle, CheckCircle, BarChart2, Layers, TrendingUp,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { InsightCard } from '@/components/InsightCard'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Vista = 'todo' | 'mercaderia' | 'recursos'

const VISTA_LABELS: Record<Vista, string> = { todo: 'Todo el Patrimonio', mercaderia: 'Solo Mercadería', recursos: 'Solo Recursos' }

// ─── Colores semánticos ───────────────────────────────────────────────────────

const C_ACCENT  = '#7B00FF'  // mercadería (morado)
const C_CYAN    = '#06B6D4'  // recursos (turquesa)
const C_GREEN   = '#22C55E'
const C_YELLOW  = '#F59E0B'
const C_ORANGE  = '#F97316'
const C_RED     = '#EF4444'

const ESTADO_REC_COLORS: Record<string, string> = {
  activo: C_GREEN,
  en_reparacion: C_ORANGE,
  dado_de_baja: C_RED,
  pendiente_adquisicion: C_YELLOW,
}

const AGING_COLORS = ['#7B00FF', '#F59E0B', '#EF4444']  // 0-30, 31-90, +90

// ─── Gauge SVG ────────────────────────────────────────────────────────────────

function GaugeChart({ score, label, sublabel }: { score: number; label: string; sublabel: string }) {
  // score 0-100 (100 = óptimo)
  const clamp = Math.max(0, Math.min(100, score))
  const angle = 180 - (clamp / 100) * 180 // 180° = izq (crítico), 0° = der (óptimo)
  const rad = (angle * Math.PI) / 180
  const cx = 100, cy = 95, r = 68

  const nx = cx + r * Math.cos(rad)
  const ny = cy - r * Math.sin(rad)

  function arc(startDeg: number, endDeg: number) {
    const s = (startDeg * Math.PI) / 180
    const e = (endDeg * Math.PI) / 180
    const x1 = cx + r * Math.cos(s), y1 = cy - r * Math.sin(s)
    const x2 = cx + r * Math.cos(e), y2 = cy - r * Math.sin(e)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }

  const color = score >= 75 ? C_GREEN : score >= 50 ? C_YELLOW : score >= 25 ? C_ORANGE : C_RED
  const levelLabel = score >= 75 ? 'Óptimo' : score >= 50 ? 'Leve' : score >= 25 ? 'Riesgo' : 'Crítico'

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" width="180" height="100">
        {/* Zone arcs (stroke width 14) */}
        <path d={arc(180, 135)} fill="none" stroke={C_RED}    strokeWidth={14} strokeLinecap="round" />
        <path d={arc(135, 90)}  fill="none" stroke={C_ORANGE} strokeWidth={14} strokeLinecap="round" />
        <path d={arc(90, 45)}   fill="none" stroke={C_YELLOW} strokeWidth={14} strokeLinecap="round" />
        <path d={arc(45, 0)}    fill="none" stroke={C_GREEN}  strokeWidth={14} strokeLinecap="round" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="#111827" />
        {/* Zone labels */}
        <text x="12"  y="102" fontSize="8" fill={C_RED}    textAnchor="middle">Crítico</text>
        <text x="50"  y="108" fontSize="8" fill={C_ORANGE} textAnchor="middle">Riesgo</text>
        <text x="148" y="108" fontSize="8" fill={C_YELLOW} textAnchor="middle">Excedente</text>
        <text x="185" y="102" fontSize="8" fill={C_GREEN}  textAnchor="middle">Óptimo</text>
      </svg>
      <p className="text-lg font-bold tabular-nums" style={{ color }}>{label}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 text-center">{sublabel}</p>
      <span className="mt-1 text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: color + '20', color }}>
        {levelLabel}
      </span>
    </div>
  )
}

// ─── Tooltips custom ──────────────────────────────────────────────────────────

function AgingTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill }} className="font-semibold">{p.name}: {fmt(p.value)}</p>
      ))}
    </div>
  )
}

function RecursosTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill }} className="mt-0.5">{p.name}: <span className="font-semibold">{p.value}</span></p>
      ))}
    </div>
  )
}

// Combos bloqueados como barras horizontales (reemplaza Treemap para compatibilidad recharts v3)
function CombosBloqueadosChart({ data, fmt }: { data: { name: string; kits_bloqueados: number; ingreso_retenido: number; componente: string }[]; fmt: (v: number) => string }) {
  const maxIngreso = Math.max(...data.map(d => d.ingreso_retenido), 1)
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.name}>
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{d.name}</p>
              {d.componente && <p className="text-[10px] text-gray-400 dark:text-gray-500">Falta: {d.componente}</p>}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs text-gray-400 dark:text-gray-500">{d.kits_bloqueados} bloq.</span>
              <span className="text-xs font-semibold text-orange-500 dark:text-orange-400">{fmt(d.ingreso_retenido)}</span>
            </div>
          </div>
          <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
            <div className="h-full rounded-lg transition-all flex items-center"
              style={{ width: `${Math.max(4, (d.ingreso_retenido / maxIngreso) * 100)}%`, backgroundColor: C_ORANGE, opacity: 0.8 - i * 0.08 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashInventarioArea() {
  const { tenant } = useAuthStore()

  const [vista, setVista] = useState<Vista>('todo')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  const fmt = (v: number) => `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  const fmtCorto = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
    return `$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  }

  // ─── Query: mercadería (inventario_lineas + productos) ────────────────────
  const { data: iData, isLoading: iLoading } = useQuery({
    queryKey: ['dash-inv-area', tenant?.id],
    queryFn: async () => {
      // 1. Todos los productos activos
      const { data: productos = [] } = await supabase.from('productos')
        .select('id, nombre, sku, categoria, precio_costo, precio_venta, stock_actual, stock_minimo, es_kit')
        .eq('tenant_id', tenant!.id).eq('activo', true)

      // 2. Inventario_lineas activas con ubicacion + estado
      const { data: lineas = [] } = await supabase.from('inventario_lineas')
        .select('id, producto_id, cantidad, cantidad_reservada, estado_id, ubicacion_id, created_at, sucursal_id, productos(precio_costo, nombre)')
        .eq('tenant_id', tenant!.id).eq('activo', true).gt('cantidad', 0)

      // 3. Recursos
      const { data: recursos = [] } = await supabase.from('recursos')
        .select('id, nombre, categoria, estado, valor, ubicacion')
        .eq('tenant_id', tenant!.id)
        .neq('estado', 'pendiente_adquisicion')

      // 4. Movimientos últimos 30 días (rebajes para rotación y runway)
      const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
      const { data: movs30 = [] } = await supabase.from('movimientos_stock')
        .select('tipo, cantidad, producto_id, created_at')
        .eq('tenant_id', tenant!.id)
        .in('tipo', ['rebaje', 'kitting', 'des_kitting'])
        .gte('created_at', hace30)

      // 5. Movimientos últimos 365 días (para rotación anual)
      const hace365 = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]
      const { data: movs365 = [] } = await supabase.from('movimientos_stock')
        .select('cantidad, tipo')
        .eq('tenant_id', tenant!.id)
        .eq('tipo', 'rebaje')
        .gte('created_at', hace365)

      // 6. Movimientos tipo ajuste_rebaje del mes (mermas)
      const iniciomes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
      const { data: mermas = [] } = await supabase.from('movimientos_stock')
        .select('cantidad, productos(precio_costo)')
        .eq('tenant_id', tenant!.id)
        .eq('tipo', 'ajuste_rebaje')
        .gte('created_at', iniciomes)

      // 7. Kit recetas
      const { data: recetas = [] } = await supabase.from('kit_recetas')
        .select('kit_producto_id, comp_producto_id, cantidad')
        .eq('tenant_id', tenant!.id)

      // ── KPI 1: Capital de Trabajo ─────────────────────────────────────────
      const capitalTrabajo = (productos ?? [])
        .filter((p: any) => !p.es_kit)
        .reduce((a: number, p: any) => a + (p.precio_costo ?? 0) * (p.stock_actual ?? 0), 0)

      // ── KPI 2: Patrimonio Operativo ───────────────────────────────────────
      const patrimonioRec = (recursos ?? [])
        .filter((r: any) => r.estado === 'activo' || r.estado === 'en_reparacion')
        .reduce((a: number, r: any) => a + (r.valor ?? 0), 0)

      // ── KPI 3: Índice de Rotación (anual) ─────────────────────────────────
      const totalCostoVendido365 = (movs365 ?? []).reduce((a: number, m: any) => a + (m.cantidad ?? 0), 0)
      const rotacion = capitalTrabajo > 0 ? totalCostoVendido365 / (capitalTrabajo / (productos ?? []).filter((p: any) => !p.es_kit && (p.precio_costo ?? 0) > 0).length || 1) : null

      // Simpler rotation: turns = ventas_unidades_año / stock_promedio_unidades
      const stockTotal = (productos ?? []).filter((p: any) => !p.es_kit).reduce((a: number, p: any) => a + (p.stock_actual ?? 0), 0)
      const rotacionSimple = stockTotal > 0 ? (totalCostoVendido365 / 365 * 365) / stockTotal : null

      // ── KPI 4: Runway (días de supervivencia) ─────────────────────────────
      const salidas30 = (movs30 ?? []).reduce((a: number, m: any) => a + (m.cantidad ?? 0), 0)
      const salidasDiarias = salidas30 / 30
      const runway = salidasDiarias > 0 ? Math.round(stockTotal / salidasDiarias) : null

      // ── KPI 5: Potencial de Armado (Kits) ────────────────────────────────
      const prodMap: Record<string, number> = {}
      for (const p of productos ?? []) prodMap[p.id] = p.stock_actual ?? 0

      const kitsMap: Record<string, { nombre: string; precio_venta: number; posibles: number }> = {}
      for (const kit of (productos ?? []).filter((p: any) => p.es_kit)) {
        const componentes = (recetas ?? []).filter((r: any) => r.kit_producto_id === kit.id)
        if (componentes.length === 0) continue
        const posibles = Math.floor(Math.min(...componentes.map((r: any) => {
          const stock = prodMap[r.comp_producto_id] ?? 0
          return stock / (r.cantidad ?? 1)
        })))
        kitsMap[kit.id] = { nombre: kit.nombre, precio_venta: kit.precio_venta ?? 0, posibles }
      }
      const totalKitsPosibles = Object.values(kitsMap).reduce((a, k) => a + k.posibles, 0)

      // ── KPI 6: Recursos comprometidos ────────────────────────────────────
      const recursosEnRep = (recursos ?? []).filter((r: any) => r.estado === 'en_reparacion').length

      // ── KPI 7: Nivel de Reservas ──────────────────────────────────────────
      const reservas = (lineas ?? []).reduce((a: number, l: any) => {
        const pc = (l as any).productos?.precio_costo ?? 0
        return a + (l.cantidad_reservada ?? 0) * pc
      }, 0)

      // ── KPI 8: Mermas ────────────────────────────────────────────────────
      const costoMermas = (mermas ?? []).reduce((a: number, m: any) => {
        const pc = (m as any).productos?.precio_costo ?? 0
        return a + (m.cantidad ?? 0) * pc
      }, 0)

      // ── Gauge Salud del Depósito ─────────────────────────────────────────
      const totalProds = (productos ?? []).filter((p: any) => !p.es_kit).length
      const prodsCriticos = (productos ?? []).filter((p: any) => !p.es_kit && (p.stock_actual ?? 0) <= (p.stock_minimo ?? 0)).length
      const pctCriticos = totalProds > 0 ? (prodsCriticos / totalProds) * 100 : 0
      const healthScore = 100 - pctCriticos // mayor = mejor

      // ── Dona Patrimonio ───────────────────────────────────────────────────
      const donaData = [
        { name: 'Mercadería', value: capitalTrabajo, fill: C_ACCENT },
        { name: 'Recursos', value: patrimonioRec, fill: C_CYAN },
      ].filter(d => d.value > 0)

      // ── Aging (envejecimiento) del capital en lineas ───────────────────────
      const now = Date.now()
      const agingBuckets = [
        { label: '0-30 días', min: 0,   max: 30,  valor: 0, color: AGING_COLORS[0] },
        { label: '31-90 días', min: 31,  max: 90,  valor: 0, color: AGING_COLORS[1] },
        { label: '+90 días',   min: 91,  max: 9999, valor: 0, color: AGING_COLORS[2] },
      ]
      for (const l of lineas ?? []) {
        const dias = Math.floor((now - new Date((l as any).created_at).getTime()) / 86400000)
        const pc = (l as any).productos?.precio_costo ?? 0
        const v = (l as any).cantidad * pc
        for (const b of agingBuckets) {
          if (dias >= b.min && dias <= b.max) { b.valor += v; break }
        }
      }
      const agingData = agingBuckets.map(b => ({ label: b.label, valor: b.valor, color: b.color }))

      // ── Recursos por categoría y estado ───────────────────────────────────
      const recCatMap: Record<string, Record<string, number>> = {}
      for (const r of recursos ?? []) {
        const cat = r.categoria || 'Sin categoría'
        if (!recCatMap[cat]) recCatMap[cat] = { activo: 0, en_reparacion: 0, dado_de_baja: 0 }
        recCatMap[cat][r.estado] = (recCatMap[cat][r.estado] ?? 0) + 1
      }
      const recCatData: { cat: string; activo: number; en_reparacion: number; dado_de_baja: number }[] =
        Object.entries(recCatMap)
          .map(([cat, estados]) => ({ cat, activo: estados.activo ?? 0, en_reparacion: estados.en_reparacion ?? 0, dado_de_baja: estados.dado_de_baja ?? 0 }))
          .sort((a, b) => (b.activo + b.en_reparacion) - (a.activo + a.en_reparacion))
          .slice(0, 8)

      // ── Treemap: Cuello de Botella de Combos ─────────────────────────────
      const treemapData = Object.entries(kitsMap)
        .filter(([, k]) => k.posibles === 0)
        .map(([kitId, k]) => {
          const componentes = (recetas ?? []).filter((r: any) => r.kit_producto_id === kitId)
          const constraining = componentes.find((r: any) => (prodMap[r.comp_producto_id] ?? 0) === 0)
          const compNombre = constraining
            ? (productos ?? []).find((p: any) => p.id === constraining.comp_producto_id)?.nombre
            : undefined
          // Estimate how many kits could be made if not blocked (use max demand proxy)
          const bloqueados = Math.max(1, Math.round((salidas30 / 30) * 7)) // 1 week demand estimate
          return {
            name: k.nombre,
            kits_bloqueados: bloqueados,
            ingreso_retenido: bloqueados * k.precio_venta,
            componente: compNombre ?? 'desconocido',
            fill: C_ORANGE,
          }
        })
        .sort((a, b) => b.ingreso_retenido - a.ingreso_retenido)
        .slice(0, 10)

      return {
        capitalTrabajo, patrimonioRec, rotacionSimple,
        runway, totalKitsPosibles, recursosEnRep, reservas, costoMermas,
        healthScore, prodsCriticos, totalProds,
        donaData, agingData, recCatData, treemapData,
        productos, recursos,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
    retry: 1,
  })

  // ─── Insights ────────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    if (!iData) return []
    const list: { tipo: 'danger' | 'warning' | 'success' | 'info'; titulo: string; impacto: string; accion: string; link: string }[] = []

    // Recursos en reparación
    if (iData.recursosEnRep > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${iData.recursosEnRep} recurso${iData.recursosEnRep !== 1 ? 's' : ''} en reparación`,
        impacto: 'Equipamiento fuera de servicio puede estar limitando la capacidad operativa.',
        accion: 'Ver recursos', link: '/recursos',
      })
    }

    // Capital dormido (aging +90)
    const viejo = iData.agingData.find(b => b.label.includes('+90'))
    if (viejo && viejo.valor > 0) {
      const pct = iData.capitalTrabajo > 0 ? Math.round((viejo.valor / iData.capitalTrabajo) * 100) : 0
      list.push({
        tipo: 'warning',
        titulo: `${fmt(viejo.valor)} en stock con más de 90 días sin movimiento`,
        impacto: `El ${pct}% del capital invertido en mercadería está inmovilizado. Considerá una liquidación.`,
        accion: 'Ver inventario', link: '/inventario',
      })
    }

    // Combos bloqueados
    if (iData.treemapData.length > 0) {
      const totalBloqueado = iData.treemapData.reduce((a, d) => a + d.ingreso_retenido, 0)
      list.push({
        tipo: 'danger',
        titulo: `${iData.treemapData.length} kit${iData.treemapData.length !== 1 ? 's' : ''} bloqueado${iData.treemapData.length !== 1 ? 's' : ''} por falta de componentes`,
        impacto: `${fmt(totalBloqueado)} en ingresos retenidos. Reponé los insumos faltantes para desbloquear la venta.`,
        accion: 'Ver inventario', link: '/inventario',
      })
    }

    // Runway corto
    if (iData.runway !== null && iData.runway < 15) {
      list.push({
        tipo: 'danger',
        titulo: `Solo ${iData.runway} días de stock restante al ritmo actual de ventas`,
        impacto: 'Si no reponés mercadería, quedarás sin stock antes de fin de mes.',
        accion: 'Ver alertas', link: '/alertas',
      })
    } else if (iData.runway !== null && iData.runway > 120) {
      list.push({
        tipo: 'info',
        titulo: `Runway de ${iData.runway} días — posible exceso de stock`,
        impacto: 'Tenés más de 4 meses de mercadería. Considerá reducir las próximas compras.',
        accion: 'Ver inventario', link: '/inventario',
      })
    }

    // Stock crítico alto
    if (iData.prodsCriticos > 0) {
      list.push({
        tipo: iData.prodsCriticos > iData.totalProds * 0.15 ? 'danger' : 'warning',
        titulo: `${iData.prodsCriticos} producto${iData.prodsCriticos !== 1 ? 's' : ''} por debajo del stock mínimo`,
        impacto: `El ${Math.round((iData.prodsCriticos / iData.totalProds) * 100)}% del catálogo está en zona crítica. Generá órdenes de compra.`,
        accion: 'Ver alertas', link: '/alertas',
      })
    }

    // Mermas
    if (iData.costoMermas > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${fmt(iData.costoMermas)} en mermas / ajustes negativos este mes`,
        impacto: 'Revisá si hay patrones por ubicación, turno o proveedor para reducir las pérdidas.',
        accion: 'Ver historial', link: '/historial',
      })
    }

    return list.slice(0, 4)
  }, [iData, fmt])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Toggle Vista + Filtros ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">

        {/* Vista toggle */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          {(['todo', 'mercaderia', 'recursos'] as Vista[]).map(v => (
            <button key={v} onClick={() => setVista(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${vista === v ? 'bg-white dark:bg-gray-800 text-primary shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              {VISTA_LABELS[v]}
            </button>
          ))}
        </div>

        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all
              ${filterOpen
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} />
            Filtros
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3>
                <button onClick={() => setFilterOpen(false)}><X size={14} className="text-gray-400" /></button>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Estado logístico</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Los filtros por LPN/ubicación se aplican directamente en el módulo Inventario.</p>
              </div>
              <a href="/inventario" className="block w-full text-center text-xs font-medium text-accent hover:underline">
                Ir a Inventario →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Capa 1: 8 KPIs ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* KPI 1: Capital de Trabajo — solo si vista != recursos */}
        {vista !== 'recursos' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent">
                <Package size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Capital de Trabajo</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">
              {iLoading ? '—' : fmtCorto(iData?.capitalTrabajo ?? 0)}
            </p>
            <p className="text-xs text-muted mt-1.5">Dinero invertido en productos para la venta.</p>
          </div>
        )}

        {/* KPI 2: Patrimonio Operativo — solo si vista != mercaderia */}
        {vista !== 'mercaderia' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400">
                <Wrench size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Patrimonio Operativo</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">
              {iLoading ? '—' : fmtCorto(iData?.patrimonioRec ?? 0)}
            </p>
            <p className="text-xs text-muted mt-1.5">Valor de activos fijos activos y en reparación.</p>
          </div>
        )}

        {/* KPI 3: Rotación — solo mercadería */}
        {vista !== 'recursos' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                <TrendingUp size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Índice de Rotación</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">
              {iLoading ? '—' : iData?.rotacionSimple != null ? `${iData.rotacionSimple.toFixed(1)}x` : '—'}
            </p>
            <p className="text-xs text-muted mt-1.5">Tu mercadería se renueva X veces al año.</p>
          </div>
        )}

        {/* KPI 4: Runway */}
        {vista !== 'recursos' && (
          <div className={`bg-surface border rounded-xl p-5 shadow-sm ${iData?.runway !== null && iData!.runway < 15 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
            <div className="mb-3">
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${iData?.runway !== null && iData!.runway < 15 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                <Clock size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Días de Supervivencia</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${iData?.runway !== null && iData!.runway < 15 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
              {iLoading ? '—' : iData?.runway != null ? `${iData.runway}d` : '—'}
            </p>
            <p className="text-xs text-muted mt-1.5">Stock actual vs. ritmo de ventas diario.</p>
          </div>
        )}

        {/* KPI 5: Kits posibles */}
        {vista !== 'recursos' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                <Layers size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Potencial de Armado</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">
              {iLoading ? '—' : `${iData?.totalKitsPosibles ?? 0}`}
            </p>
            <p className="text-xs text-muted mt-1.5">Kits ensamblables hoy según stock de componentes.</p>
          </div>
        )}

        {/* KPI 6: Recursos en reparación */}
        {vista !== 'mercaderia' && (
          <div className={`bg-surface border rounded-xl p-5 shadow-sm ${(iData?.recursosEnRep ?? 0) > 0 ? 'border-orange-300 dark:border-orange-800' : 'border-border-ds'}`}>
            <div className="mb-3">
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${(iData?.recursosEnRep ?? 0) > 0 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                <Wrench size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Recursos Comprometidos</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${(iData?.recursosEnRep ?? 0) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-primary'}`}>
              {iLoading ? '—' : iData?.recursosEnRep ?? 0}
            </p>
            <p className="text-xs text-muted mt-1.5">Equipos en reparación o fuera de servicio.</p>
          </div>
        )}

        {/* KPI 7: Reservas */}
        {vista !== 'recursos' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-accent">
                <BarChart2 size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Nivel de Reservas</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">
              {iLoading ? '—' : fmtCorto(iData?.reservas ?? 0)}
            </p>
            <p className="text-xs text-muted mt-1.5">Stock bloqueado en LPNs asignados a pedidos pendientes.</p>
          </div>
        )}

        {/* KPI 8: Mermas */}
        {vista !== 'recursos' && (
          <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                <AlertTriangle size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-muted">Costo de Mermas (mes)</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${(iData?.costoMermas ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
              {iLoading ? '—' : (iData?.costoMermas ?? 0) > 0 ? `-${fmtCorto(iData!.costoMermas)}` : '$0'}
            </p>
            <p className="text-xs text-muted mt-1.5">Pérdidas por ajustes negativos de stock este mes.</p>
          </div>
        )}
      </div>

      {/* ── Capa 2: Gráficos ─────────────────────────────────────────────────── */}

      {/* Fila 1: Dona Patrimonio + Gauge Salud */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Gráfico 1: Dona Patrimonio */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Package size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Composición del Patrimonio</h3>
          </div>
          {iLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (iData?.donaData ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={iData!.donaData} cx="50%" cy="50%" innerRadius={36} outerRadius={58} dataKey="value" paddingAngle={3} strokeWidth={0}>
                    {iData!.donaData.map((d: any) => <Cell key={d.name} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3 flex-1">
                {iData!.donaData.map((d: any) => {
                  const total = iData!.donaData.reduce((a: number, x: any) => a + x.value, 0)
                  const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
                  return (
                    <div key={d.name}>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.fill }} />
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{d.name}</span>
                        </div>
                        <span className="text-xs font-bold text-primary">{pct}%</span>
                      </div>
                      <p className="text-xs text-muted pl-4.5">{fmt(d.value)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin datos de patrimonio</p>
          )}
        </div>

        {/* Gráfico 2: Gauge Salud del Depósito */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <BarChart2 size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Salud del Depósito</h3>
          </div>
          {iLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (
            <div className="flex flex-col items-center pt-2">
              <GaugeChart
                score={iData?.healthScore ?? 100}
                label={iData?.prodsCriticos != null ? `${iData.prodsCriticos} críticos` : '—'}
                sublabel={`De ${iData?.totalProds ?? 0} productos activos`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Gráfico 3: Envejecimiento del Capital */}
      {vista !== 'recursos' && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Envejecimiento del Capital</h3>
            <span className="ml-auto text-xs text-muted">Por antigüedad de LPN</span>
          </div>
          {iLoading ? (
            <div className="h-32 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (iData?.agingData ?? []).some((b: any) => b.valor > 0) ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={iData!.agingData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtCorto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<AgingTooltip fmt={fmt} />} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
                <Bar dataKey="valor" name="Valor" radius={[4, 4, 0, 0]} maxBarSize={80}>
                  {(iData?.agingData ?? []).map((b: any, i: number) => (
                    <Cell key={i} fill={b.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin datos de envejecimiento</p>
          )}
          <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
            {(iData?.agingData ?? []).map((b: any) => (
              <div key={b.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                <span className="text-xs text-muted">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gráfico 4: Recursos por categoría (Barras apiladas horizontales) */}
      {vista !== 'mercaderia' && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={15} className="text-cyan-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Estado de Recursos por Categoría</h3>
          </div>
          {iLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (iData?.recCatData ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(120, (iData?.recCatData ?? []).length * 36)}>
              <BarChart data={iData!.recCatData} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="cat" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={100} />
                <Tooltip content={<RecursosTooltip />} cursor={{ fill: 'rgba(123,0,255,0.05)' }} />
                <Legend formatter={(v: string) => ({ activo: 'Activo', en_reparacion: 'En Reparación', dado_de_baja: 'Dado de Baja' }[v] ?? v)} />
                <Bar dataKey="activo" name="activo" fill={C_GREEN} stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="en_reparacion" name="en_reparacion" fill={C_ORANGE} stackId="a" />
                <Bar dataKey="dado_de_baja" name="dado_de_baja" fill={C_RED} stackId="a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted text-center py-8">Sin recursos registrados</p>
          )}
        </div>
      )}

      {/* Gráfico 5: Cuello de Botella de Combos */}
      {vista !== 'recursos' && (
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Layers size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cuello de Botella de Combos</h3>
            <span className="ml-auto text-xs text-muted">Kits bloqueados por falta de componentes</span>
          </div>
          <p className="text-xs text-muted mb-4 ml-5">Tamaño de barra proporcional al ingreso retenido estimado.</p>
          {iLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (iData?.treemapData ?? []).length > 0 ? (
            <CombosBloqueadosChart data={iData!.treemapData} fmt={fmt} />
          ) : (
            <div className="flex flex-col items-center justify-center py-10">
              <CheckCircle size={32} className="text-green-500 mb-2" />
              <p className="text-sm font-medium text-green-600 dark:text-green-400">Todos los kits tienen componentes disponibles</p>
            </div>
          )}
        </div>
      )}

      {/* ── Capa 3: Insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu Director de Operaciones</h3>
            <span className="text-xs text-muted bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{insights.length}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {insights.map((ins, i) => {
              const Icon = INSIGHT_ICONS[ins.tipo]
              return (
                <InsightCard key={i} variant={ins.tipo} icon={<Icon size={15} />}
                  title={ins.titulo} description={ins.impacto}
                  action={{ label: ins.accion, onClick: () => { window.location.href = ins.link } }}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
