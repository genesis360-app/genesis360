import type { LucideIcon } from 'lucide-react'
import { useDragScroll } from '@/hooks/useDragScroll'

export interface PageTabItem {
  id: string
  label: string
  icon?: LucideIcon
  /** Contador opcional (pill ámbar a la derecha de la etiqueta). Se oculta si es 0/undefined. */
  badge?: number
}

/**
 * Tabs de página unificadas para todo Genesis360.
 * Formato único: subrayado (estilo Clientes) con el activo remarcado en el
 * DEGRADÉ DE MARCA (violeta → cian) — texto con `text-gradient-brand` + barra
 * inferior `bg-brand-gradient`. El ícono del activo queda en violeta sólido
 * (`text-accent`): NO se le puede aplicar el degradé de texto o se vuelve transparente.
 *
 * Incluye **drag-scroll** (arrastrar con el mouse) vía `useDragScroll`: las páginas
 * con muchas pestañas se pueden desplazar manteniendo apretado, sin perderse fuera
 * de pantalla. El scrollbar queda oculto.
 *
 * Único lugar donde vive el estilo de las pestañas → cambiarlo acá lo cambia en toda la app.
 */
export function PageTabs({
  tabs, active, onChange, size = 'md', className = '',
}: {
  tabs: PageTabItem[]
  active: string
  onChange: (id: string) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  const tabsRef = useDragScroll<HTMLDivElement>()
  const pad = size === 'sm' ? 'px-4 py-2 text-xs gap-1.5' : 'px-4 py-2.5 text-sm gap-2'
  return (
    <div
      ref={tabsRef}
      className={`flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto [&::-webkit-scrollbar]:hidden cursor-grab select-none ${className}`}
      style={{ scrollbarWidth: 'none' } as any}
    >
      {tabs.map(({ id, label, icon: Icon, badge }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative flex items-center font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${pad}
              ${isActive
                ? 'border-transparent'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 nav-grad-hover'}`}
          >
            {Icon && <Icon size={15} className={isActive ? 'text-accent' : 'nav-grad-icon'} />}
            <span className={isActive ? 'text-gradient-brand' : 'nav-grad-text'}>{label}</span>
            {badge ? (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {badge}
              </span>
            ) : null}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-gradient rounded-full" />}
          </button>
        )
      })}
    </div>
  )
}
