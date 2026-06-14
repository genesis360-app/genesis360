import { useEffect, useRef } from 'react'

/**
 * Hook para manejar teclado en modales:
 * - ESC → cierra el modal (onClose)
 * - Enter → confirma (onConfirm), excepto en textarea o botones
 *
 * Usa un STACK global: si hay varios modales abiertos, ESC/Enter actúan SIEMPRE sobre el
 * último abierto (el que está visualmente encima), y al cerrarlo el siguiente vuelve a
 * tomar el control. Así ESC cierra "de arriba hacia abajo", uno por vez.
 */

type Handlers = { onClose: () => void; onConfirm?: () => void }
// Guardamos refs (no funciones sueltas) para que el orden del stack no cambie en cada
// render: el ref es estable y `.current` siempre tiene los callbacks más nuevos.
type Entry = { current: Handlers }

const stack: Entry[] = []
let attached = false

function onKeydown(e: KeyboardEvent) {
  const top = stack[stack.length - 1]
  if (!top) return
  const { onClose, onConfirm } = top.current
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
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

export function useModalKeyboard({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm?: () => void
}) {
  // Ref estable; sus callbacks se mantienen siempre actualizados sin re-ordenar el stack.
  const ref = useRef<Handlers>({ onClose, onConfirm })
  ref.current = { onClose, onConfirm }

  useEffect(() => {
    if (!isOpen) return
    stack.push(ref)
    if (!attached) {
      document.addEventListener('keydown', onKeydown)
      attached = true
    }
    return () => {
      const i = stack.lastIndexOf(ref)
      if (i !== -1) stack.splice(i, 1)
      if (stack.length === 0 && attached) {
        document.removeEventListener('keydown', onKeydown)
        attached = false
      }
    }
  }, [isOpen])
}
