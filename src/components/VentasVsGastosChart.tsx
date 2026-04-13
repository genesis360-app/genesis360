// VentasVsGastosChart — "La Balanza": ventas vs gastos por día
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { PeriodoDash, Moneda } from './FilterBar'
import { getFechasDashboard } from './FilterBar'

interface Props {
  periodo: PeriodoDash
  moneda: Moneda
  cotizacion: number
}

function formatK(v: number, moneda: Moneda) {
  const val = moneda === 'USD' ? v : v
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`
  return `${val.toFixed(0)}`
}

function formatFecha(fecha: string, periodo: PeriodoDash) {
  const [, m, d] = fecha.split('-')
  if (periodo === 'año') return `${d}/${m}`
  return `${d}/${m}`
}

const CustomTooltip = ({ active, payload, label, moneda, cotizacion }: any) => {
  if (!active || !payload?.length) return null
  const sym = moneda === 'USD' ? 'U$D' : '$'
  const conv = moneda === 'USD' ? cotizacion : 1
  return (
    <div className="bg-gray-900 text-white rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold mb-1 text-gray-300">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold">{sym}{(p.value / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
        </div>
      ))}
      {payload.length === 2 && (
        <div className="border-t border-gray-700 mt-1 pt-1 flex justify-between gap-4">
          <span className="text-gray-400">Diferencia</span>
          <span className={`font-semibold ${(payload[0].value - payload[1].value) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {sym}{Math.abs((payload[0].value - payload[1].value) / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </div>
  )
}

export function VentasVsGastosChart({ periodo, moneda, cotizacion }: Props) {
  const { tenant } = useAuthStore()

  const { data: chartData = [], isLoading } = useQuery({
    queryKey: ['ventas-gastos-chart', tenant?.id, periodo],
    queryFn: async () => {
      const { desde, hasta } = getFechasDashboard(periodo)
      const desdeDate = desde.split('T')[0]
      const hastaDate = hasta.split('T')[0]

      const [{ data: ventas }, { data: gastos }] = await Promise.all([
        supabase.from('ventas')
          .select('created_at, total')
          .eq('tenant_id', tenant!.id)
          .in('estado', ['despachada', 'facturada'])
          .gte('created_at', desde)
          .lte('created_at', hasta),
        supabase.from('gastos')
          .select('fecha, monto')
          .eq('tenant_id', tenant!.id)
          .gte('fecha', desdeDate)
          .lte('fecha', hastaDate),
      ])

      // Agregar por día
      const ventasMap: Record<string, number> = {}
      const gastosMap: Record<string, number> = {}

      ventas?.forEach(v => {
        const d = v.created_at.split('T')[0]
        ventasMap[d] = (ventasMap[d] ?? 0) + (v.total ?? 0)
      })
      gastos?.forEach(g => {
        gastosMap[g.fecha] = (gastosMap[g.fecha] ?? 0) + (g.monto ?? 0)
      })

      // Generar rango de fechas
      const dates: string[] = []
      const cur = new Date(desdeDate + 'T00:00:00')
      const end = new Date(hastaDate + 'T23:59:59')
      while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0])
        cur.setDate(cur.getDate() + 1)
      }

      return dates.map(d => ({
        fecha: formatFecha(d, periodo),
        Ventas: ventasMap[d] ?? 0,
        Gastos: gastosMap[d] ?? 0,
      }))
    },
    enabled: !!tenant,
  })

  const sym = moneda === 'USD' ? 'U$D ' : '$'
  const conv = moneda === 'USD' ? cotizacion : 1

  if (isLoading) {
    return <div className="h-48 flex items-center justify-center text-muted text-sm">Cargando...</div>
  }

  const hasData = chartData.some(d => d.Ventas > 0 || d.Gastos > 0)
  if (!hasData) {
    return <div className="h-48 flex items-center justify-center text-muted text-sm">Sin datos para el período</div>
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--color-accent)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" vertical={false} />
        <XAxis
          dataKey="fecha"
          tick={{ fontSize: 10, fill: 'currentColor' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          className="text-muted"
        />
        <YAxis
          tickFormatter={v => sym + formatK(v / conv, moneda)}
          tick={{ fontSize: 10, fill: 'currentColor' }}
          tickLine={false}
          axisLine={false}
          width={56}
          className="text-muted"
        />
        <Tooltip
          content={<CustomTooltip moneda={moneda} cotizacion={cotizacion} />}
          cursor={{ stroke: 'rgba(128,128,128,0.2)', strokeWidth: 1 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        <Area
          type="monotone"
          dataKey="Ventas"
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#gradVentas)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          type="monotone"
          dataKey="Gastos"
          stroke="#ef4444"
          strokeWidth={1.5}
          fill="none"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
