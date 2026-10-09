import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ActionMenuItem {
  label: string
  icon?: LucideIcon
  onClick: () => void
  disabled?: boolean
  /** Estilo destructivo (rojo) — ej. eliminar */
  danger?: boolean
  /** Si es true, el ítem no se renderiza (útil para gatear por rol/modo) */
  hidden?: boolean
}

interface ActionMenuProps {
  items: ActionMenuItem[]
  /** Texto del botón (se oculta en mobile, queda solo el ícono ⋯). Default "Acciones" */
  label?: string
  /** Alineación del menú respecto del botón. Default "right" */
  align?: 'left' | 'right'
  className?: string
  /** Solo el ícono ⋯, más chico (para acciones por fila de una lista). `label` queda como aria-label. */
  compact?: boolean
}

/**
 * Menú de acciones secundarias colapsadas en un solo botón "⋯ Acciones".
 * Abre con click (no hover → funciona en touch/mobile), cierra con click-afuera o ESC.
 * Pensado para descongestionar los toolbars de header en mobile: la acción principal
 * queda como botón aparte y todo lo secundario entra acá.
 */
export function ActionMenu({ items, label = 'Acciones', align = 'right', className = '', compact = false }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const visibles = items.filter(i => !i.hidden)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (visibles.length === 0) return null

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        className={compact
          ? `flex items-center justify-center w-9 h-9 rounded-lg border text-gray-500 dark:text-gray-400 transition-[background-color,transform] duration-150 active:scale-[0.97] ${open ? 'border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-gray-700' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`
          : 'flex items-center gap-2 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-all'}
      >
        <MoreHorizontal size={16} />
        {!compact && <span className="hidden sm:inline">{label}</span>}
        {!compact && <ChevronDown size={13} className={`hidden sm:inline transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div
          role="menu"
          className={`menu-pop absolute ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} top-full mt-1 min-w-[12rem] bg-surface border border-border-ds rounded-xl shadow-lg overflow-hidden z-30 py-1`}
        >
          {visibles.map((item, idx) => {
            const Icon = item.icon
            return (
              <button
                key={idx}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick() }}
                className={`w-full px-4 py-2.5 text-sm text-left flex items-center gap-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  item.danger
                    ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {Icon && <Icon size={15} className={item.danger ? '' : 'text-muted'} />}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
