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
}

/**
 * Menú de acciones secundarias colapsadas en un solo botón "⋯ Acciones".
 * Abre con click (no hover → funciona en touch/mobile), cierra con click-afuera o ESC.
 * Pensado para descongestionar los toolbars de header en mobile: la acción principal
 * queda como botón aparte y todo lo secundario entra acá.
 */
export function ActionMenu({ items, label = 'Acciones', align = 'right', className = '' }: ActionMenuProps) {
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
        className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
      >
        <MoreHorizontal size={16} />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown size={13} className={`hidden sm:inline transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 min-w-[12rem] bg-surface border border-border-ds rounded-xl shadow-lg overflow-hidden z-30 py-1`}
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
