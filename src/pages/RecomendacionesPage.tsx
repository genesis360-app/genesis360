import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Zap, AlertTriangle, CheckCircle, Clock, BarChart2,
  ChevronRight, Package, TrendingUp, Users, Database, ShoppingCart
} from 'lucide-react'
import { useRecomendaciones, type Recomendacion, type RecomendacionTipo, type RecomendacionCategoria } from '@/hooks/useRecomendaciones'

// ─── Estilos ─────────────────────────────────────────────────────────────────

const TIPO_STYLES: Record<RecomendacionTipo, {
  border: string; bg: string; iconColor: string; iconBg: string; badge: string
}> = {
  danger:  { border: 'border-l-red-500',   bg: 'bg-red-50 dark:bg-red-900/20/50',   iconColor: 'text-red-500',   iconBg: 'bg-red-100 dark:bg-red-900/30',   badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  warning: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20/50', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-900/30', badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  success: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-green-900/20/50', iconColor: 'text-green-600 dark:text-green-400', iconBg: 'bg-green-100 dark:bg-green-900/30', badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50 dark:bg-blue-900/20/50',  iconColor: 'text-blue-600 dark:text-blue-400',  iconBg: 'bg-blue-100 dark:bg-blue-900/30',  badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
}

const TIPO_ICONS: Record<RecomendacionTipo, React.ElementType> = {
  danger:  AlertTriangle,
  warning: Clock,
  success: CheckCircle,
  info:    BarChart2,
}

const CAT_LABELS: Record<RecomendacionCategoria, { label: string; icon: React.ElementType }> = {
  stock:        { label: 'Stock',        icon: Package },
  ventas:       { label: 'Ventas',       icon: ShoppingCart },
  rentabilidad: { label: 'Rentabilidad', icon: TrendingUp },
  clientes:     { label: 'Clientes',     icon: Users },
  datos:        { label: 'Datos',        icon: Database },
  operaciones:  { label: 'Operaciones',  icon: Zap },
}

type FiltroTipo = 'todas' | RecomendacionTipo
type FiltroCat  = 'todas' | RecomendacionCategoria

function RecomendacionCard({ r }: { r: Recomendacion }) {
  const style = TIPO_STYLES[r.tipo]
  const Icon  = TIPO_ICONS[r.tipo]
  const cat   = CAT_LABELS[r.categoria]
  const CatIcon = cat.icon

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 border-l-4 ${style.border} shadow-sm overflow-hidden`}>
      <div className={`p-5 ${style.bg}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${style.iconBg}`}>
              <Icon size={17} className={style.iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-tight">{r.titulo}</p>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
                  <CatIcon size={10} /> {cat.label}
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{r.descripcion}</p>
              {r.impacto && (
                <p className={`text-xs font-semibold mt-2 ${style.iconColor}`}>{r.impacto}</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
        <Link
          to={r.link}
          className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-primary transition-colors"
        >
          {r.accion} <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  )
}

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'
  const label = score >= 70 ? 'Saludable' : score >= 40 ? 'Regular' : 'Necesita atención'
  const radius = 40
  const circ   = 2 * Math.PI * radius
  const offset = circ - (score / 100) * circ

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={radius}
            fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-gray-800 dark:text-gray-100">{score}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">/ 100</span>
        </div>
      </div>
      <span className="text-sm font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

export default function RecomendacionesPage() {
  const { recomendaciones, score, isLoading } = useRecomendaciones()
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todas')
  const [filtroCat, setFiltroCat]   = useState<FiltroCat>('todas')

  const filtradas = recomendaciones.filter(r =>
    (filtroTipo === 'todas' || r.tipo === filtroTipo) &&
    (filtroCat  === 'todas' || r.categoria === filtroCat)
  )

  const conteo: Record<RecomendacionTipo, number> = { danger: 0, warning: 0, success: 0, info: 0 }
  recomendaciones.forEach(r => conteo[r.tipo]++)

  const TIPO_FILTROS: { key: FiltroTipo; label: string; color: string }[] = [
    { key: 'todas',   label: 'Todas',    color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
    { key: 'danger',  label: 'Urgente',  color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
    { key: 'warning', label: 'Atención', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
    { key: 'success', label: 'Positivo', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
    { key: 'info',    label: 'Info',     color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  ]

  const dimensiones = score ? [
    { label: 'Rotación de stock',  valor: score.rotacion,     max: 20 },
    { label: 'Rentabilidad',       valor: score.rentabilidad, max: 25 },
    { label: 'Gestión reservas',   valor: score.reservas,     max: 20 },
    { label: 'Crecimiento ventas', valor: score.crecimiento,  max: 20 },
    { label: 'Calidad de datos',   valor: score.datos,        max: 15 },
  ] : []

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
          <Zap size={20} className="text-purple-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Motor de Recomendaciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Lo que Stokio detectó en tu negocio</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center text-gray-400 dark:text-gray-500 py-16">Analizando tu negocio...</p>
      ) : (
        <>
          {/* Score + dimensiones */}
          {score && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
              <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-5">Score de Salud del Negocio</h2>
              <div className="flex flex-col md:flex-row items-center gap-8">
                <ScoreCircle score={score.total} />
                <div className="flex-1 w-full space-y-3">
                  {dimensiones.map(d => {
                    const pct  = (d.valor / d.max) * 100
                    const color = pct >= 70 ? 'bg-green-50 dark:bg-green-900/200' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                    return (
                      <div key={d.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-gray-400">{d.label}</span>
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{d.valor}/{d.max}</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${color} transition-all duration-700`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap gap-2 mb-4">
            {TIPO_FILTROS.map(f => (
              <button
                key={f.key}
                onClick={() => setFiltroTipo(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border
                  ${filtroTipo === f.key
                    ? `${f.color} border-transparent shadow-sm`
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:border-gray-600'
                  }`}
              >
                {f.label}
                {f.key !== 'todas' && conteo[f.key] > 0 && (
                  <span className="ml-1.5 font-bold">{conteo[f.key]}</span>
                )}
              </button>
            ))}
            <div className="ml-auto">
              <select
                value={filtroCat}
                onChange={e => setFiltroCat(e.target.value as FiltroCat)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="todas">Todas las categorías</option>
                {(Object.entries(CAT_LABELS) as [RecomendacionCategoria, { label: string }][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lista de recomendaciones */}
          {filtradas.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin recomendaciones para este filtro</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtradas.map(r => <RecomendacionCard key={r.id} r={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
