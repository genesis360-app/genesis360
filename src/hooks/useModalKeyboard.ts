import { useEffect } from 'react'

/**
 * Hook para manejar teclado en modales:
 * - ESC → cierra el modal (onClose)
 * - Enter → confirma (onConfirm), excepto en textarea o botones
 *
 * Uso: llamar con el estado abierto/cerrado del modal.
 * El listener se activa solo cuando isOpen === true.
 */
export function useModalKeyboard({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm?: () => void
}) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Enter' && onConfirm) {
        const target = e.target as HTMLElement
        // No interceptar Enter en textarea (salto de línea) ni en botones (ya tienen click)
        if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return
        e.preventDefault()
        onConfirm()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose, onConfirm])
}
