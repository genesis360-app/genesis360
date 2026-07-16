/**
 * Toggle — el switch estándar de la app. Único lugar donde vive la geometría de un toggle.
 *
 * ─── Por qué existe (pedido de GO, 2026-07-16) ────────────────────────────────────────────
 * Había **~26 toggles hechos a mano con 5 geometrías distintas** (`translate-x-4/-5/-6`, con y sin
 * `left-0.5`, tracks `w-8`/`w-10`/`w-11`). El bug que reportó GO —el círculo blanco FUERA del óvalo
 * en 3 switches, y justo los 3 de UI fiscal (ARCA habilitada, **AFIP producción**, emisor activo)—
 * existía **precisamente porque cada uno se escribió por separado**: alcanzaba con que a uno le
 * faltara una clase.
 *
 * 🛑 **El bug original, para que no vuelva:** el knob era `absolute` **sin `left`**. Un `absolute`
 * con `left: auto` toma su **posición ESTÁTICA**, y un `<button>` trae `text-align: center` del
 * user-agent (Tailwind resetea el `padding` pero **NO** el `text-align`) → el knob arrancaba
 * CENTRADO (~12px) en vez del borde, y con `translate-x-5` terminaba en 48px dentro de un track de
 * 40px: 8px afuera.
 *
 * ─── Cómo lo evita este componente ────────────────────────────────────────────────────────
 *  1. **El knob NO es `absolute`**: es un flex item de un `inline-flex items-center`. Sin posición
 *     estática de por medio, el bug es imposible por construcción — no depende de acordarse de una
 *     clase.
 *  2. `items-center` centra vertical solo: nada de `top-0.5` calculado a mano.
 *  3. El desplazamiento ON es un **px exacto** derivado de la geometría (`track − knob − 2`), no un
 *     `translate-x-N` elegido a ojo. Padding simétrico de 2px de los dos lados en los 3 tamaños.
 *
 * Si mañana hay que cambiar el diseño de los switches, se cambia **acá** y aplica a toda la app.
 */
interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** sm = 32×16 · md = 40×20 (default, el más usado) · lg = 44×24 */
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  /** Clase de fondo cuando está ON. Default `bg-accent` (degradé de marca).
   *  Ej: `bg-emerald-500` para "AFIP producción". */
  colorOn?: string
  /** Obligatorio si el toggle no tiene un `<label>` que lo describa. */
  'aria-label'?: string
}

// Geometría: [track, knob, desplazamiento ON en px] — el ON sale de `track − knob − 2` (2px de
// padding a cada lado). No tocar a ojo: si cambia el track o el knob, recalcular.
const SIZES = {
  sm: { track: 'w-8 h-4', knob: 'w-3 h-3', on: 18 },  // 32 − 12 − 2 = 18
  md: { track: 'w-10 h-5', knob: 'w-4 h-4', on: 22 }, // 40 − 16 − 2 = 22
  lg: { track: 'w-11 h-6', knob: 'w-5 h-5', on: 22 }, // 44 − 20 − 2 = 22
} as const

export function Toggle({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  title,
  colorOn = 'bg-accent',
  'aria-label': ariaLabel,
}: ToggleProps) {
  const g = SIZES[size]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center rounded-full transition-colors shrink-0
        disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent2 focus-visible:ring-offset-1
        ${g.track} ${checked ? colorOn : 'bg-gray-300 dark:bg-gray-600'}`}>
      <span
        style={{ transform: `translateX(${checked ? g.on : 2}px)` }}
        className={`inline-block rounded-full bg-white shadow transition-transform
          motion-reduce:transition-none ${g.knob}`}
      />
    </button>
  )
}
