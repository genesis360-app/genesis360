import { useEffect, useRef } from 'react'

/**
 * Marca un contenedor de la landing para que sus piezas (.lp-rev, .lp-msj, …) se revelen al entrar en pantalla, una sola
 * vez. Sin JavaScript o sin IntersectionObserver el atributo nunca se pone y todo queda visible (ver src/styles/landing.css).
 */
export function useRevelar<T extends HTMLElement>(umbral = 0.25) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    el.dataset.revelar = 'espera'
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          el.dataset.revelar = 'visto'
          io.disconnect()
        }
      }
    }, { threshold: umbral, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [umbral])

  return ref
}
