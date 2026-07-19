import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'

/**
 * InfoTip — el ⓘ estándar de la app (backlog Fede/GO punto 8, 2026-07-19).
 *
 * Hasta ahora la única "ayuda" era el `title=` nativo del navegador: invisible en mobile
 * (no hay hover), sin estilo, y con delay de ~1s. Este componente muestra un popover real:
 *  · Desktop: hover o focus (accesible por teclado).
 *  · Mobile: tap para abrir, tap afuera para cerrar.
 *  · Dark-mode-aware, ancho máximo legible, no se corta en contenedores con overflow
 *    (position: fixed calculada al abrir).
 *
 * Uso: <label>Factor KM <InfoTip text="Multiplica la distancia en línea recta…" /></label>
 */
export function InfoTip({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      // Centrado bajo el ícono, clampeado al viewport (popover w-max max-w-[260px])
      const left = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140)
      setPos({ top: r.bottom + 6, left })
    }
    setOpen(true)
  }
  const hide = () => setOpen(false)

  // Tap afuera cierra (mobile)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) hide()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Más información"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={e => { e.preventDefault(); e.stopPropagation(); open ? hide() : show() }}
        className={`inline-flex align-middle text-gray-400 dark:text-gray-500 hover:text-accent-text focus-visible:text-accent-text focus-visible:outline-none cursor-help ${className}`}
      >
        <Info size={13} />
      </button>
      {open && pos && (
        <div
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
          className="z-[80] w-max max-w-[260px] px-3 py-2 rounded-xl text-xs leading-relaxed
            bg-gray-900 text-gray-100 dark:bg-gray-700 dark:text-gray-100 shadow-xl pointer-events-none"
        >
          {text}
        </div>
      )}
    </>
  )
}
