import { useRef, useEffect } from 'react'

/**
 * Permite arrastrar con el mouse (click + mover) un contenedor con `overflow-x`
 * para ver el contenido que no entra en pantalla — pensado para las barras de
 * tabs largas (RRHH, Inventario, Gastos…), donde el scrollbar está oculto y en
 * desktop no hay forma cómoda de desplazarlas.
 *
 * Devuelve un ref para asignar al contenedor scrolleable. Si el usuario ARRASTRÓ
 * (no fue un click simple), cancela el click siguiente para no cambiar de tab sin
 * querer. En touch el scroll nativo ya funciona, así que solo enganchamos el mouse.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let isDown = false
    let startX = 0
    let startScroll = 0
    let moved = false

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return // solo botón primario
      isDown = true
      moved = false
      startX = e.pageX
      startScroll = el.scrollLeft
      el.classList.add('cursor-grabbing')
    }
    const onMove = (e: MouseEvent) => {
      if (!isDown) return
      const dx = e.pageX - startX
      if (Math.abs(dx) > 3) moved = true
      el.scrollLeft = startScroll - dx
    }
    const onUp = () => {
      isDown = false
      el.classList.remove('cursor-grabbing')
    }
    // Si hubo arrastre, anular el click para que no dispare el onClick del tab.
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault()
        e.stopPropagation()
        moved = false
      }
    }

    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('click', onClickCapture, true)
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  return ref
}
