// MixCajaChart — "El Mix de Caja": donut por método de pago
import { useQuery } from '@tanstack/react-query'
import {
  PieChart, Pie, Cell, Tooltip,
  ResponsiveContainer, Legend,
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

const COLORS: Record<string, string> = {
  Efectivo:       '#7c3aed', // accent violet
  Transferencia:  '#3b82f6', // blue
  Tarjeta:        '#10b981', // green
  MercadoPago:    '#06b6d4', // cyan
  Otro:           '#94a3b8', // slate
}

function getColor(tipo: string): string {
  return COLORS[tipo] ?? COLORS.Otro
}

const CustomTooltip = ({ active, payload, moneda, cotizacion }: any) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const sym = moneda === 'USD' ? 'U$D ' : '$'
  const conv = moneda === 'USD' ? cotizacion : 1
  const total = payload[0]?.payload?.total ?? 0

  return (
    <div className="bg-gray-900 text-white rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold mb-1" style={{ color: item.payload.fill }}>{item.name}</p>
      <p className="text-gray-300">{sym}{(item.value / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
      <p className="text-gray-500">{total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}% del total</p>
    </div>
  )
}

const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.07) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {(percent * 100).toFixed(0)}%
    </text>
  )
}

export function MixCajaChart({ periodo, moneda, cotizacion }: Props) {
  const { tenant } = useAuthStore()

  const { data: mixData = [], isLoading } = useQuery({
    queryKey: ['mix-caja', tenant?.id, periodo],
    queryFn: async () => {
      const { desde, hasta } = getFechasDashboard(periodo)
      const { data: ventas } = await supabase.from('ventas')
        .select('medio_pago, total')
        .eq('tenant_id', tenant!.id)
        .in('estado', ['despachada', 'facturada'])
        .gte('created_at', desde)
        .lte('created_at', hasta)

      const metodos: Record<string, number> = {}
      ventas?.forEach(v => {
        try {
          const medios = JSON.parse(v.medio_pago || '[]')
          if (Array.isArray(medios)) {
            medios.forEach((m: any) => {
              if (m?.tipo && m?.monto > 0) {
                metodos[m.tipo] = (metodos[m.tipo] ?? 0) + m.monto
              }
            })
          }
        } catch {}
      })

      const total = Object.values(metodos).reduce((a, b) => a + b, 0)
      return Object.entries(metodos)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value, total, fill: getColor(name) }))
    },
    enabled: !!tenant,
  })

  const sym = moneda === 'USD' ? 'U$D ' : '$'
  const conv = moneda === 'USD' ? cotizacion : 1
  const totalGeneral = mixData.reduce((a, d) => a + d.value, 0)

  if (isLoading) {
    return <div className="h-48 flex items-center justify-center text-muted text-sm">Cargando...</div>
  }

  if (!mixData.length) {
    return <div className="h-48 flex items-center justify-center text-muted text-sm">Sin ventas en el período</div>
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={mixData}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            labelLine={false}
            label={renderLabel}
          >
            {mixData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip moneda={moneda} cotizacion={cotizacion} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Centro del donut */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-lg font-bold text-primary leading-tight">
          {sym}{(totalGeneral / conv).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </p>
        <p className="text-[10px] text-muted">total</p>
      </div>
    </div>
  )
}
