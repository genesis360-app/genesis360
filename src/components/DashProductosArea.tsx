import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, PieChart, Pie, ScatterChart, Scatter,
  CartesianGrid, LineChart, Legend,
} from 'recharts'
import {
  SlidersHorizontal, X, Package, TrendingUp, TrendingDown, Zap,
  AlertTriangle, CheckCircle, Clock, BarChart2, Star, Target,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useSucursalFilter } from '@/hooks/useSucursalFilter'
import { InsightCard } from '@/components/InsightCard'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ProductosPeriodo = 'mes' | 'trimestre' | 'año' | 'custom'
const PERIODO_LABELS: Record<ProductosPeriodo, string> = {
  mes: 'Este mes', trimestre: 'Trimestre', año: 'Año', custom: 'Custom',
}

function getProducFechas(p: ProductosPeriodo, custom?: { desde: string; hasta: string }): { desde: string; hasta: string } {
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

// ─── Colores ──────────────────────────────────────────────────────────────────

const CAT_COLORS = ['#7B00FF','#3B82F6','#06B6D4','#F59E0B','#10B981','#EF4444','#EC4899','#8B5CF6','#F97316','#6B7280']

const SCATTER_COLORS = {
  estrella: '#22C55E',   // sup-der: alta venta, alto margen
  trafico:  '#3B82F6',   // inf-der: alta venta, bajo margen
  nicho:    '#F59E0B',   // sup-izq: baja venta, alto margen
  perro:    '#EF4444',   // inf-izq: baja venta, bajo margen
}

function getQuadrante(x: number, y: number, medX: number, medY: number): keyof typeof SCATTER_COLORS {
  if (x >= medX && y >= medY) return 'estrella'
  if (x >= medX && y < medY)  return 'trafico'
  if (x < medX  && y >= medY) return 'nicho'
  return 'perro'
}

// ─── Tooltips custom ──────────────────────────────────────────────────────────

function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const quad = { estrella: 'Estrella 🟢', trafico: 'Tráfico 🔵', nicho: 'Nicho 🟡', perro: 'Perro 🔴' }
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs max-w-[180px]">
      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{d.nombre}</p>
      <p className="text-gray-400 dark:text-gray-500">{d.sku}</p>
      <p className="text-gray-600 dark:text-gray-300 mt-1">{d.total_cantidad} u. vendidas</p>
      <p className="text-accent font-semibold">{d.avg_margen?.toFixed(1)}% margen</p>
      <p className="text-gray-400 mt-0.5">{quad[d.quadrant as keyof typeof quad]}</p>
    </div>
  )
}

function ParetoTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs max-w-[200px]">
      <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="mt-0.5">
          {p.dataKey === 'pct_acum' ? `${p.value?.toFixed(1)}% acumulado` : fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

function TijeraTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">{p.name}: {fmt(p.value)}</p>
      ))}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashProductosArea() {
  const { tenant } = useAuthStore()
  const { sucursalId } = useSucursalFilter()

  const dashFilter = (q: any) => {
    if (!sucursalId) return q
    return q.eq('sucursal_id', sucursalId)
  }

  // Filtros locales
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodo, setPeriodo] = useState<ProductosPeriodo>('trimestre')
  const [customDesde, setCustomDesde] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
  const [customHasta, setCustomHasta] = useState(() => new Date().toISOString())
  const [categoriaFiltro, setCategoriaFiltro] = useState('')
  const [margenMin, setMargenMin] = useState(0)
  const [cicloVida, setCicloVida] = useState('')

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

  const customRange = { desde: customDesde, hasta: customHasta }
  const { desde, hasta } = getProducFechas(periodo, customRange)
  const hoy = new Date().toISOString().split('T')[0]

  const activeFilters = [categoriaFiltro, cicloVida, margenMin > 0 ? 'margen' : ''].filter(Boolean).length

  // ─── Query principal ──────────────────────────────────────────────────────
  const { data: pData, isLoading } = useQuery({
    queryKey: ['dash-productos-area', tenant?.id, desde, hasta, categoriaFiltro, sucursalId],
    queryFn: async () => {

      // 1. Ventas confirmadas del período → IDs
      let qVentasConf = supabase.from('ventas')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', desde).lte('created_at', hasta)
      qVentasConf = dashFilter(qVentasConf)
      const { data: ventasConf = [] } = await qVentasConf
      const ventaIds = (ventasConf ?? []).map((v: any) => v.id)

      // 2. venta_items del período con producto
      let itemsData: any[] = []
      if (ventaIds.length > 0) {
        const CHUNK = 200
        for (let i = 0; i < ventaIds.length; i += CHUNK) {
          let q = supabase.from('venta_items')
            .select('producto_id, cantidad, precio_unitario, precio_costo_historico, venta_id, productos(nombre, sku, categoria, precio_costo, precio_venta, stock_actual, stock_minimo)')
            .in('venta_id', ventaIds.slice(i, i + CHUNK))
          if (categoriaFiltro) q = q.eq('productos.categoria', categoriaFiltro)
          const { data } = await q
          itemsData = itemsData.concat(data ?? [])
        }
      }

      // 3. Todos los productos activos (para capital dormido)
      let qProds = supabase.from('productos')
        .select('id, nombre, sku, categoria, precio_costo, precio_venta, stock_actual, stock_minimo, activo')
        .eq('tenant_id', tenant!.id).eq('activo', true)
      if (categoriaFiltro) qProds = qProds.eq('categoria', categoriaFiltro)
      const { data: todosProductos = [] } = await qProds

      // 4. Productos con ventas en los últimos 90 días (para dormancy)
      const hace90 = new Date(Date.now() - 90 * 86400000).toISOString()
      let qVentasRecientes90 = supabase.from('ventas')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', hace90)
      qVentasRecientes90 = dashFilter(qVentasRecientes90)
      const { data: ventasRecientes90 = [] } = await qVentasRecientes90
      const ventaIds90 = (ventasRecientes90 ?? []).map((v: any) => v.id)
      let conVentas90 = new Set<string>()
      if (ventaIds90.length > 0) {
        const { data: items90 } = await supabase.from('venta_items')
          .select('producto_id')
          .in('venta_id', ventaIds90.slice(0, 500))
        ;(items90 ?? []).forEach((i: any) => conVentas90.add(i.producto_id))
      }

      // 5. Devoluciones del período → tasa de devolución
      // Primero obtenemos las devoluciones del período, luego sus items
      const { data: devsDelPeriodo = [] } = await supabase.from('devoluciones')
        .select('id')
        .eq('tenant_id', tenant!.id)
        .gte('created_at', desde).lte('created_at', hasta)
      const devIds = (devsDelPeriodo ?? []).map((d: any) => d.id)
      let devItems: any[] = []
      if (devIds.length > 0) {
        const { data } = await supabase.from('devolucion_items')
          .select('cantidad').in('devolucion_id', devIds)
        devItems = data ?? []
      }

      // 6. Histórico mensual de venta_items (últimos 6 meses) para La Tijera
      const seisMesesAtras = new Date()
      seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 5); seisMesesAtras.setDate(1)
      let qVentasHist = supabase.from('ventas')
        .select('id, created_at')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', seisMesesAtras.toISOString())
      qVentasHist = dashFilter(qVentasHist)
      const { data: ventasHist = [] } = await qVentasHist
      const ventaIdsHist = (ventasHist ?? []).map((v: any) => ({ id: v.id, mes: v.created_at.slice(0, 7) }))
      const mesMap: Record<string, string> = {}
      ventaIdsHist.forEach((v: any) => { mesMap[v.id] = v.mes })
      let itemsHist: any[] = []
      if (ventaIdsHist.length > 0) {
        const histIds = ventaIdsHist.map(v => v.id)
        const { data } = await supabase.from('venta_items')
          .select('venta_id, precio_unitario, precio_costo_historico, cantidad')
          .in('venta_id', histIds.slice(0, 500))
        itemsHist = data ?? []
      }

      // ── Aggregate venta_items by producto ────────────────────────────────
      const prodMap: Record<string, {
        nombre: string; sku: string; categoria: string
        total_cantidad: number; total_ingresos: number
        sum_margen_pon: number; sum_cantidad_margen: number
        precio_costo_actual: number; precio_venta_actual: number
      }> = {}

      for (const item of itemsData) {
        const pid = item.producto_id
        const prod = item.productos ?? {}
        const cant = item.cantidad ?? 0
        const pu = item.precio_unitario ?? 0
        const pc = item.precio_costo_historico ?? prod.precio_costo ?? 0
        const margen = pu > 0 ? ((pu - pc) / pu) * 100 : 0

        if (!prodMap[pid]) prodMap[pid] = {
          nombre: prod.nombre ?? 'Sin nombre', sku: prod.sku ?? '',
          categoria: prod.categoria ?? 'Sin categoría',
          total_cantidad: 0, total_ingresos: 0,
          sum_margen_pon: 0, sum_cantidad_margen: 0,
          precio_costo_actual: prod.precio_costo ?? 0,
          precio_venta_actual: prod.precio_venta ?? 0,
        }
        prodMap[pid].total_cantidad += cant
        prodMap[pid].total_ingresos += pu * cant
        prodMap[pid].sum_margen_pon += margen * cant
        prodMap[pid].sum_cantidad_margen += cant
      }

      const productosConVentas = Object.entries(prodMap).map(([id, d]) => ({
        id,
        nombre: d.nombre, sku: d.sku, categoria: d.categoria,
        total_cantidad: d.total_cantidad,
        total_ingresos: d.total_ingresos,
        avg_margen: d.sum_cantidad_margen > 0 ? d.sum_margen_pon / d.sum_cantidad_margen : 0,
        precio_costo_actual: d.precio_costo_actual,
        precio_venta_actual: d.precio_venta_actual,
      }))

      // ── KPI 1: Rentabilidad Promedio ──────────────────────────────────────
      let totalPondIngresos = 0, totalPondMargen = 0
      for (const item of itemsData) {
        const pu = item.precio_unitario ?? 0
        const pc = item.precio_costo_historico ?? item.productos?.precio_costo ?? 0
        const cant = item.cantidad ?? 0
        if (pu > 0) {
          totalPondIngresos += pu * cant
          totalPondMargen += ((pu - pc) / pu) * 100 * (pu * cant)
        }
      }
      const margenGlobal = totalPondIngresos > 0 ? totalPondMargen / totalPondIngresos : null

      // ── KPI 2: El Motor (Top Ingresos) ───────────────────────────────────
      const topMotor = productosConVentas.sort((a, b) => b.total_ingresos - a.total_ingresos)[0] ?? null

      // ── KPI 3: La Mina de Oro (Top Margen, min 3 unidades) ───────────────
      const topMina = productosConVentas
        .filter(p => p.total_cantidad >= 3 && p.avg_margen > 0)
        .sort((a, b) => b.avg_margen - a.avg_margen)[0] ?? null

      // ── KPI 4: Capital Dormido ────────────────────────────────────────────
      const totalProductos = (todosProductos ?? []).length
      const dormidos = (todosProductos ?? []).filter((p: any) => !conVentas90.has(p.id))
      const pctDormido = totalProductos > 0 ? Math.round((dormidos.length / totalProductos) * 100) : 0

      // ── KPI 5: Tasa de devolución ─────────────────────────────────────────
      const totalUnidadesVendidas = itemsData.reduce((a: number, i: any) => a + (i.cantidad ?? 0), 0)
      const totalUnidadesDevueltas = (devItems ?? []).reduce((a: number, d: any) => a + (d.cantidad ?? 0), 0)
      const tasaDev = totalUnidadesVendidas > 0 ? (totalUnidadesDevueltas / totalUnidadesVendidas) * 100 : null

      // ── KPI 6: Quiebre de stock (ventas estimadas perdidas) ───────────────
      const prodsEnQuiebre = (todosProductos ?? []).filter((p: any) => p.stock_actual <= p.stock_minimo)
      // Usar velocidad media global como proxy: total_vendido / días_período
      const diasPeriodo = Math.max(1, Math.ceil((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000))
      const ventasPorDia = totalUnidadesVendidas / diasPeriodo
      const ventasPerdidas = prodsEnQuiebre.reduce((a: number, p: any) => {
        // días estimados de quiebre = min(diasPeriodo, 7) × precio_venta × velocidad estimada
        const diasQuiebre = Math.min(diasPeriodo, 14)
        return a + diasQuiebre * ventasPorDia * (p.precio_venta ?? 0) / Math.max(1, (todosProductos ?? []).length)
      }, 0)

      // ── Scatter data (Cuadrante Mágico) ───────────────────────────────────
      const scatterRaw = productosConVentas.slice().sort((a, b) => b.total_ingresos - a.total_ingresos).slice(0, 60)
      const medX = scatterRaw.length > 0 ? scatterRaw[Math.floor(scatterRaw.length / 2)].total_cantidad : 1
      const medY = scatterRaw.length > 0
        ? [...scatterRaw].sort((a, b) => a.avg_margen - b.avg_margen)[Math.floor(scatterRaw.length / 2)].avg_margen
        : 0
      const scatterData = scatterRaw.map(p => ({
        ...p,
        quadrant: getQuadrante(p.total_cantidad, p.avg_margen, medX, medY),
      }))

      // ── Pareto (Concentración de Ingresos) ───────────────────────────────
      const sortedByIngresos = productosConVentas.slice().sort((a, b) => b.total_ingresos - a.total_ingresos).slice(0, 20)
      const totalIngresosProd = sortedByIngresos.reduce((a, p) => a + p.total_ingresos, 0)
      let acum = 0
      const paretoData = sortedByIngresos.map(p => {
        acum += p.total_ingresos
        return {
          nombre: p.nombre.length > 15 ? p.nombre.slice(0, 14) + '…' : p.nombre,
          total_ingresos: p.total_ingresos,
          pct_acum: totalIngresosProd > 0 ? Math.round((acum / totalIngresosProd) * 100) : 0,
        }
      })
      // índice del último producto que llega al 80%
      const paretoCorte80 = paretoData.findIndex(p => p.pct_acum >= 80)

      // ── Participación por categoría ───────────────────────────────────────
      const catMap: Record<string, number> = {}
      for (const p of productosConVentas) {
        catMap[p.categoria] = (catMap[p.categoria] ?? 0) + p.total_ingresos
      }
      const catTotal = Object.values(catMap).reduce((a, b) => a + b, 0)
      const catData = Object.entries(catMap)
        .map(([nombre, total]) => ({ nombre, total, pct: catTotal > 0 ? Math.round((total / catTotal) * 100) : 0 }))
        .sort((a, b) => b.total - a.total)

      // ── La Tijera de Precios (evolución mensual) ──────────────────────────
      const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
      const tijeraMap: Record<string, { sumPrecio: number; sumCosto: number; n: number }> = {}
      for (const item of itemsHist) {
        const mes = mesMap[item.venta_id]
        if (!mes) continue
        const pu = item.precio_unitario ?? 0
        const pc = item.precio_costo_historico ?? 0
        if (!tijeraMap[mes]) tijeraMap[mes] = { sumPrecio: 0, sumCosto: 0, n: 0 }
        tijeraMap[mes].sumPrecio += pu * (item.cantidad ?? 1)
        tijeraMap[mes].sumCosto  += pc * (item.cantidad ?? 1)
        tijeraMap[mes].n         += item.cantidad ?? 1
      }
      const tijeraData = Object.entries(tijeraMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, d]) => {
          const [y, m] = mes.split('-')
          return {
            label: `${MESES_ES[parseInt(m, 10) - 1]} ${y.slice(2)}`,
            precio_prom: d.n > 0 ? d.sumPrecio / d.n : 0,
            costo_prom:  d.n > 0 ? d.sumCosto  / d.n : 0,
          }
        })

      // ── Capital dormido con mayor valor ──────────────────────────────────
      const dormidoMayorValor = dormidos
        .sort((a: any, b: any) => (b.precio_costo * b.stock_actual) - (a.precio_costo * a.stock_actual))[0] ?? null

      // ── Categorías disponibles ────────────────────────────────────────────
      const cats = [...new Set((todosProductos ?? []).map((p: any) => p.categoria).filter(Boolean))]

      // ── Producto con mayor caída de margen ────────────────────────────────
      // Comparo precio_costo_actual vs precio_venta_actual con lo histórico
      const margenActualBajo = productosConVentas
        .filter(p => p.precio_costo_actual > 0 && p.precio_venta_actual > 0)
        .map(p => ({
          ...p,
          margen_actual: ((p.precio_venta_actual - p.precio_costo_actual) / p.precio_venta_actual) * 100,
          margen_ventas: p.avg_margen,
        }))
        .filter(p => p.margen_actual < 15 && p.total_cantidad >= 3)
        .sort((a, b) => a.margen_actual - b.margen_actual)[0] ?? null

      return {
        margenGlobal,
        topMotor, topMina,
        pctDormido, cantDormidos: dormidos.length, totalProductos,
        tasaDev,
        ventasPerdidas,
        cantQuiebre: prodsEnQuiebre.length,
        scatterData, medX, medY,
        paretoData, paretoCorte80,
        catData, catTotal,
        tijeraData,
        dormidoMayorValor,
        margenActualBajo,
        productosConVentas,
        categoriasDisp: cats,
      }
    },
    enabled: !!tenant,
    staleTime: 0,
  })

  // ─── Filtros locales aplicados post-query ────────────────────────────────────
  const scatterFiltered = useMemo(() => {
    let data = pData?.scatterData ?? []
    if (margenMin > 0) data = data.filter(p => p.avg_margen >= margenMin)
    if (cicloVida === 'estrella') data = data.filter(p => p.quadrant === 'estrella')
    if (cicloVida === 'estancado') data = data.filter(p => p.total_cantidad === 0)
    if (cicloVida === 'sin_stock') data = data // handled at product level
    return data
  }, [pData, margenMin, cicloVida])

  // ─── Insights ────────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    if (!pData) return []
    const list: { tipo: 'danger' | 'warning' | 'success' | 'info'; titulo: string; impacto: string; accion: string; link: string }[] = []

    // Margen global bajo
    if (pData.margenGlobal !== null && pData.margenGlobal < 20) {
      list.push({
        tipo: 'danger',
        titulo: `Margen promedio del catálogo: ${pData.margenGlobal.toFixed(1)}% — muy ajustado`,
        impacto: 'De cada $100 vendidos, quedan menos de $20 de ganancia. Revisá precios y costos.',
        accion: 'Ver productos', link: '/productos',
      })
    }

    // Producto con margen caído (costo > precio)
    if (pData.margenActualBajo) {
      list.push({
        tipo: 'danger',
        titulo: `"${pData.margenActualBajo.nombre}" tiene un margen real del ${pData.margenActualBajo.margen_actual.toFixed(0)}%`,
        impacto: 'El costo subió pero el precio no se actualizó. Ajustá el precio de venta antes de la próxima venta.',
        accion: 'Ajustar precio', link: '/productos',
      })
    }

    // Capital dormido
    if (pData.dormidoMayorValor && pData.pctDormido >= 20) {
      const valor = pData.dormidoMayorValor.precio_costo * pData.dormidoMayorValor.stock_actual
      list.push({
        tipo: 'warning',
        titulo: `${pData.pctDormido}% del catálogo sin ventas en 90 días`,
        impacto: `Mayor capital inmovilizado: "${pData.dormidoMayorValor.nombre}" con ${fmt(valor)} en stock parado.`,
        accion: 'Ver inventario', link: '/inventario',
      })
    }

    // Ventas perdidas por quiebre
    if (pData.cantQuiebre > 0 && pData.ventasPerdidas > 0) {
      list.push({
        tipo: 'warning',
        titulo: `${pData.cantQuiebre} producto${pData.cantQuiebre !== 1 ? 's' : ''} en quiebre de stock`,
        impacto: `Impacto estimado: ${fmt(pData.ventasPerdidas)} en ventas perdidas. Reponelos para no perder más.`,
        accion: 'Ver alertas', link: '/alertas',
      })
    }

    // Concentración de Pareto (si top 3 > 80%)
    if (pData.paretoCorte80 >= 0 && pData.paretoCorte80 <= 2) {
      list.push({
        tipo: 'info',
        titulo: `El 80% de tus ingresos vienen de solo ${pData.paretoCorte80 + 1} producto${pData.paretoCorte80 > 0 ? 's' : ''}`,
        impacto: 'Alta dependencia. Si ese proveedor falla, tu facturación se desploma. Diversificá el catálogo.',
        accion: 'Ver productos', link: '/productos',
      })
    }

    // Tasa de devolución alta
    if (pData.tasaDev !== null && pData.tasaDev > 5) {
      list.push({
        tipo: 'danger',
        titulo: `Tasa de devolución del ${pData.tasaDev.toFixed(1)}% — por encima del límite`,
        impacto: 'Revisá si hay un producto específico que concentre los reclamos. Puede ser calidad, descripción o tallas.',
        accion: 'Ver historial', link: '/historial',
      })
    }

    // La Mina de Oro oculta
    if (pData.topMina && pData.topMina.avg_margen > 50 && pData.topMina.total_cantidad < 10) {
      list.push({
        tipo: 'success',
        titulo: `"${pData.topMina.nombre}" tiene ${pData.topMina.avg_margen.toFixed(0)}% de margen — ¡Potencial oculto!`,
        impacto: 'Alta rentabilidad pero bajo volumen. Invertí en destacarlo para multiplicar la ganancia.',
        accion: 'Ver producto', link: '/productos',
      })
    }

    return list.slice(0, 4)
  }, [pData, fmt])

  const INSIGHT_ICONS = { danger: AlertTriangle, warning: Clock, success: CheckCircle, info: BarChart2 }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Barra de filtros ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Mostrando <span className="font-medium text-primary">{PERIODO_LABELS[periodo].toLowerCase()}</span>
          {categoriaFiltro && <span className="ml-1 text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">Cat: {categoriaFiltro}</span>}
          {margenMin > 0 && <span className="ml-1 text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">Margen ≥ {margenMin}%</span>}
          {cicloVida && <span className="ml-1 text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">{cicloVida}</span>}
        </p>

        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(v => !v)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-all
              ${filterOpen || activeFilters > 0
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'}`}>
            <SlidersHorizontal size={14} />
            Filtros
            {activeFilters > 0 && (
              <span className="w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold">{activeFilters}</span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Filtros</h3>
                <button onClick={() => setFilterOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>

              {/* Período */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Período</p>
                <div className="flex flex-wrap gap-1">
                  {(['mes', 'trimestre', 'año', 'custom'] as ProductosPeriodo[]).map(p => (
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

              {/* Contexto */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Contexto</p>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Categoría</p>
                  <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-primary focus:outline-none focus:border-accent">
                    <option value="">Todas las categorías</option>
                    {(pData?.categoriasDisp ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Ciclo de vida</p>
                  <div className="flex flex-wrap gap-1">
                    {[{ k: '', l: 'Todos' }, { k: 'estrella', l: '🟢 Estrella' }, { k: 'estancado', l: '🔴 Perro' }, { k: 'nicho', l: '🟡 Nicho' }].map(opt => (
                      <button key={opt.k} onClick={() => setCicloVida(opt.k)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                          ${cicloVida === opt.k ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rentabilidad slider */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Rentabilidad</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-20">Margen ≥ {margenMin}%</span>
                  <input type="range" min={0} max={80} step={5} value={margenMin} onChange={e => setMargenMin(Number(e.target.value))}
                    className="flex-1 accent-accent" />
                </div>
              </div>

              {activeFilters > 0 && (
                <button onClick={() => { setCategoriaFiltro(''); setMargenMin(0); setCicloVida('') }}
                  className="w-full text-xs text-gray-400 hover:text-accent transition-colors">Limpiar filtros</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Capa 1: 6 KPIs (2×3) ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">

        {/* KPI 1: Margen Global */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
              <TrendingUp size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">Rentabilidad Promedio</p>
          <p className="text-3xl font-semibold text-primary mt-1 tabular-nums">
            {isLoading ? '—' : pData?.margenGlobal != null ? `${pData.margenGlobal.toFixed(1)}%` : '—'}
          </p>
          {pData?.margenGlobal != null && (
            <span className={`inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded-full font-medium
              ${pData.margenGlobal >= 30 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : pData.margenGlobal >= 15 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
              {pData.margenGlobal >= 30 ? 'Saludable' : pData.margenGlobal >= 15 ? 'Ajustado' : 'Crítico'}
            </span>
          )}
          {pData?.margenGlobal != null && (
            <p className="text-xs text-muted mt-1.5">De cada $100 vendidos, quedan ${pData.margenGlobal.toFixed(0)} de ganancia.</p>
          )}
        </div>

        {/* KPI 2: El Motor */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-accent">
              <Star size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">El Motor</p>
          <p className="text-lg font-semibold text-primary mt-1 truncate">{isLoading ? '—' : pData?.topMotor?.nombre ?? '—'}</p>
          <p className="text-2xl font-bold text-accent mt-0.5 tabular-nums">{isLoading ? '' : pData?.topMotor ? fmt(pData.topMotor.total_ingresos) : ''}</p>
          <p className="text-xs text-muted mt-1">El producto que más dinero hace entrar a tu caja.</p>
        </div>

        {/* KPI 3: La Mina de Oro */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <Target size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">La Mina de Oro</p>
          <p className="text-lg font-semibold text-primary mt-1 truncate">{isLoading ? '—' : pData?.topMina?.nombre ?? '—'}</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-0.5 tabular-nums">{isLoading ? '' : pData?.topMina ? `${pData.topMina.avg_margen.toFixed(0)}% margen` : ''}</p>
          <p className="text-xs text-muted mt-1">No el más vendido, pero el que más ganancia real deja por unidad.</p>
        </div>

        {/* KPI 4: Capital Dormido */}
        <div className={`bg-surface border rounded-xl p-5 shadow-sm ${pData?.pctDormido && pData.pctDormido >= 30 ? 'border-red-300 dark:border-red-800' : 'border-border-ds'}`}>
          <div className="mb-3">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${pData?.pctDormido && pData.pctDormido >= 30 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
              <Package size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">Capital Dormido</p>
          <p className={`text-3xl font-semibold mt-1 tabular-nums ${pData?.pctDormido && pData.pctDormido >= 30 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
            {isLoading ? '—' : `${pData?.pctDormido ?? 0}%`}
          </p>
          <p className="text-xs text-muted mt-1.5">{pData?.cantDormidos ?? 0} de {pData?.totalProductos ?? 0} productos sin venta en 90 días.</p>
        </div>

        {/* KPI 5: Tasa de Devolución */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
              <TrendingDown size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">Tasa de Devolución</p>
          <p className={`text-3xl font-semibold mt-1 tabular-nums ${pData?.tasaDev && pData.tasaDev > 5 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
            {isLoading ? '—' : pData?.tasaDev != null ? `${pData.tasaDev.toFixed(1)}%` : '—'}
          </p>
          {pData?.tasaDev != null && (
            <span className={`inline-flex mt-2 text-xs px-2 py-0.5 rounded-full font-medium
              ${pData.tasaDev > 5 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              : pData.tasaDev > 2 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
              {pData.tasaDev > 5 ? 'Por encima del límite' : pData.tasaDev > 2 ? 'Controlado' : 'Excelente'}
            </span>
          )}
          <p className="text-xs text-muted mt-1.5">Porcentaje de unidades que regresan por fallas o insatisfacción.</p>
        </div>

        {/* KPI 6: Quiebre de stock */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
              <AlertTriangle size={20} />
            </div>
          </div>
          <p className="text-sm font-medium text-muted">Impacto Quiebre de Stock</p>
          <p className="text-3xl font-semibold text-red-600 dark:text-red-400 mt-1 tabular-nums">
            {isLoading ? '—' : pData?.ventasPerdidas && pData.ventasPerdidas > 0 ? `-${fmtCorto(pData.ventasPerdidas)}` : '$0'}
          </p>
          <p className="text-xs text-muted mt-1.5">{pData?.cantQuiebre ?? 0} producto{pData?.cantQuiebre !== 1 ? 's' : ''} en quiebre. Ventas estimadas perdidas.</p>
        </div>
      </div>

      {/* ── Capa 2: Gráficos ─────────────────────────────────────────────────── */}

      {/* Cuadrante Mágico + Categorías (fila 1) */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Gráfico 1: Cuadrante Mágico (Scatter) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Target size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">El Cuadrante Mágico</h3>
            <span className="ml-auto text-xs text-muted">{PERIODO_LABELS[periodo]}</span>
          </div>
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            {Object.entries({ estrella: '🟢 Estrella', trafico: '🔵 Tráfico', nicho: '🟡 Nicho', perro: '🔴 Perro' }).map(([k, l]) => (
              <div key={k} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SCATTER_COLORS[k as keyof typeof SCATTER_COLORS] }} />
                <span className="text-xs text-muted">{l}</span>
              </div>
            ))}
          </div>
          {isLoading ? (
            <div className="h-56 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : scatterFiltered.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.2)" />
                <XAxis type="number" dataKey="total_cantidad" name="Ventas (u.)" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} label={{ value: 'Ventas (u.)', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#9CA3AF' }} />
                <YAxis type="number" dataKey="avg_margen" name="Margen %" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} label={{ value: '% Margen', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine x={pData?.medX} stroke="rgba(156,163,175,0.4)" strokeDasharray="4 2" />
                <ReferenceLine y={pData?.medY} stroke="rgba(156,163,175,0.4)" strokeDasharray="4 2" />
                <Scatter data={scatterFiltered} fill="#7B00FF">
                  {scatterFiltered.map((d, i) => (
                    <Cell key={i} fill={SCATTER_COLORS[d.quadrant as keyof typeof SCATTER_COLORS]} fillOpacity={0.75} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted text-center py-10">Sin datos para el período</p>
          )}
        </div>

        {/* Gráfico 3: Participación por Categoría (Pie) */}
        <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Participación por Categoría</h3>
          </div>
          {isLoading ? (
            <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          ) : (pData?.catData ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={150}>
                <PieChart>
                  <Pie data={pData!.catData} cx="50%" cy="50%" innerRadius={32} outerRadius={58} dataKey="total" paddingAngle={2} strokeWidth={0}>
                    {pData!.catData.map((_: any, i: number) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-40 overflow-y-auto">
                {pData!.catData.slice(0, 8).map((c: any, i: number) => (
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
            <p className="text-sm text-muted text-center py-8">Sin datos categorizados</p>
          )}
        </div>
      </div>

      {/* Pareto (fila 2) */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <BarChart2 size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Concentración de Ingresos (Pareto 80/20)</h3>
          <span className="ml-auto text-xs text-muted">Top 20 productos</span>
        </div>
        {(pData?.paretoCorte80 ?? -1) >= 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 ml-5">
            El 80% de los ingresos viene de los primeros {pData!.paretoCorte80 + 1} producto{pData!.paretoCorte80 > 0 ? 's' : ''}
          </p>
        )}
        {isLoading ? (
          <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
        ) : (pData?.paretoData ?? []).length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={pData!.paretoData} margin={{ top: 5, right: 30, left: 5, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.15)" vertical={false} />
              <XAxis dataKey="nombre" tick={{ fontSize: 9, fill: '#9CA3AF' }} angle={-30} textAnchor="end" interval={0} />
              <YAxis yAxisId="left" tickFormatter={fmtCorto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={48} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ParetoTooltip fmt={fmt} />} />
              <Bar yAxisId="left" dataKey="total_ingresos" fill="#7B00FF" fillOpacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={36} />
              <Line yAxisId="right" type="monotone" dataKey="pct_acum" stroke="#F59E0B" strokeWidth={2} dot={false} name="% acum." />
              <ReferenceLine yAxisId="right" y={80} stroke="#EF4444" strokeDasharray="5 3" strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted text-center py-8">Sin ventas en el período</p>
        )}
      </div>

      {/* Tijera de Precios (fila 3) */}
      <div className="bg-surface border border-border-ds rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">La Tijera de Precios</h3>
          <span className="ml-auto text-xs text-muted">Costo vs Precio promedio · Últimos 6 meses</span>
        </div>
        <p className="text-xs text-muted mb-3 ml-5">Si el costo (rojo) sube más rápido que el precio (morado), tu margen se comprime.</p>
        {isLoading ? (
          <div className="h-40 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
        ) : (pData?.tijeraData ?? []).length > 1 ? (
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={pData!.tijeraData} margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(156,163,175,0.15)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtCorto} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={50} />
              <Tooltip content={<TijeraTooltip fmt={fmt} />} />
              <Legend formatter={(v: string) => v === 'precio_prom' ? 'Precio promedio' : 'Costo promedio'} />
              <Line type="monotone" dataKey="precio_prom" name="precio_prom" stroke="#7B00FF" strokeWidth={2.5} dot={{ r: 3, fill: '#7B00FF' }} />
              <Line type="monotone" dataKey="costo_prom" name="costo_prom" stroke="#EF4444" strokeWidth={2.5} dot={{ r: 3, fill: '#EF4444' }} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted text-center py-8">Se necesitan al menos 2 meses de datos para mostrar la evolución</p>
        )}
      </div>

      {/* ── Capa 3: Insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-accent" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tu consultor de producto</h3>
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

      {!isLoading && (pData?.productosConVentas ?? []).length === 0 && (
        <div className="text-center py-12 text-muted">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500 dark:text-gray-400">Sin ventas de productos en este período</p>
          <p className="text-xs mt-1">Probá cambiando el período en Filtros</p>
        </div>
      )}
    </div>
  )
}
