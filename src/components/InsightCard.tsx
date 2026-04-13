// InsightCard — DS Sprint 3: tarjeta de insight automático
import { ChevronRight } from 'lucide-react'

export type InsightVariant = 'danger' | 'warning' | 'success' | 'info'

export interface InsightCardProps {
  variant: InsightVariant
  icon: React.ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

const STYLES: Record<InsightVariant, { border: string; bg: string; iconBg: string; iconColor: string }> = {
  danger:  { border: 'border-l-red-500',   bg: 'bg-red-50 dark:bg-gray-800',   iconBg: 'bg-red-100 dark:bg-red-900/30',   iconColor: 'text-red-500 dark:text-red-400' },
  warning: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-gray-800', iconBg: 'bg-amber-100 dark:bg-amber-900/30', iconColor: 'text-amber-600 dark:text-amber-400' },
  success: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-gray-800', iconBg: 'bg-green-100 dark:bg-green-900/30', iconColor: 'text-green-600 dark:text-green-400' },
  info:    { border: 'border-l-blue-500',  bg: 'bg-blue-50 dark:bg-gray-800',  iconBg: 'bg-blue-100 dark:bg-blue-900/30',  iconColor: 'text-blue-600 dark:text-blue-400' },
}

export function InsightCard({ variant, icon, title, description, action }: InsightCardProps) {
  const s = STYLES[variant]

  return (
    <div className={`rounded-xl border-l-4 ${s.border} ${s.bg} p-4 shadow-sm flex items-start gap-3`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${s.iconBg}`}>
        <span className={s.iconColor}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-snug">{title}</p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{description}</p>
        )}
        {action && (
          <button
            onClick={action.onClick}
            className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-accent hover:text-primary transition-colors"
          >
            {action.label} <ChevronRight size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
