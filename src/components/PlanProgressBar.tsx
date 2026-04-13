import { Link } from 'react-router-dom'

interface PlanProgressBarProps {
  actual: number
  max: number        // -1 = ilimitado
  label: string      // ej: "productos", "movimientos este mes"
  addonInfo?: string // ej: "(incluye 500 extra)"
  to?: string        // link upgrade, default /suscripcion
  className?: string
}

export function PlanProgressBar({
  actual, max, label, addonInfo, to = '/suscripcion', className = '',
}: PlanProgressBarProps) {
  if (max === -1) return null

  const pct = max > 0 ? Math.round((actual / max) * 100) : 0
  const isOver    = pct >= 100
  const isWarning = pct >= 80 && !isOver

  const wrapCls = isOver
    ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
    : isWarning
    ? 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
    : 'border-border-ds bg-surface'

  const textCls = isOver
    ? 'text-danger'
    : isWarning
    ? 'text-warning'
    : 'text-muted'

  const barCls = isOver ? 'bg-danger' : isWarning ? 'bg-warning' : 'bg-success'

  const linkLabel = isOver ? 'Ampliar límite' : pct >= 80 ? 'Mejorar plan →' : 'Ver plan'

  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border text-sm ${wrapCls} ${className}`}>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className={`font-medium ${textCls}`}>
            {actual.toLocaleString()} / {max.toLocaleString()} {label}
            {addonInfo && <span className="ml-1 opacity-70 font-normal">{addonInfo}</span>}
          </span>
          <span className={textCls}>{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barCls}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
      {pct >= 80 && (
        <Link
          to={to}
          className={`flex-shrink-0 text-xs font-medium hover:underline whitespace-nowrap ${textCls}`}
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
