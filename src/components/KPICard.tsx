// KPICard — DS Sprint 3: tarjeta KPI reutilizable
import { TrendingUp, TrendingDown } from 'lucide-react'

export type BadgeColor = 'success' | 'warning' | 'danger' | 'neutral'

export interface KPICardProps {
  title: string
  value: string
  badge?: { label: string; color: BadgeColor }
  sub?: string
  icon?: React.ReactNode
  onClick?: () => void
}

const BADGE_STYLES: Record<BadgeColor, string> = {
  success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  danger:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  neutral: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
}

export function KPICard({ title, value, badge, sub, icon, onClick }: KPICardProps) {
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`bg-surface border border-border-ds rounded-xl p-5 shadow-sm text-left w-full
        ${onClick ? 'hover:shadow-md cursor-pointer transition-all' : ''}`}
    >
      {icon && (
        <div className="mb-3">{icon}</div>
      )}
      <p className="text-sm font-medium text-muted leading-snug">{title}</p>
      <p className="text-3xl font-semibold text-primary mt-1 leading-tight">{value}</p>
      {badge && (
        <span className={`inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${BADGE_STYLES[badge.color]}`}>
          {badge.color === 'success' && <TrendingUp size={10} />}
          {badge.color === 'danger'  && <TrendingDown size={10} />}
          {badge.label}
        </span>
      )}
      {sub && (
        <p className="text-xs text-muted mt-1.5 leading-relaxed">{sub}</p>
      )}
    </Tag>
  )
}
