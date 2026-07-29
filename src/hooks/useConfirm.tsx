// Reemplazo propio de `window.confirm`/`window.prompt` — GO: "no quiero ningún popup del sistema,
// deben ser diseños de la app". El navegador no permite estilizar `confirm()`/`prompt()` (título fijo
// "localhost:5173 dice", tipografía y colores del SO), así que hace falta un modal propio.
//
// API pensada para que la migración desde `if (!confirm('¿Seguro?')) return` sea mecánica:
//   const confirmar = useConfirm()
//   if (!(await confirmar('¿Seguro?'))) return
// Mismo `true`/`false` de siempre — el call site no cambia de forma, solo agrega `await` y hace la
// función `async` si no lo era.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'

interface ConfirmOptions {
  titulo?: string
  /** Texto del botón de confirmar (default "Confirmar"). */
  confirmText?: string
  cancelText?: string
  /** Bulto en rojo (para eliminar/desconectar) en vez del acento de marca. */
  danger?: boolean
}

interface PromptOptions {
  titulo?: string
  placeholder?: string
  valorInicial?: string
  confirmText?: string
  cancelText?: string
  /** Input vacío no es válido → deshabilita "Aceptar" (default true). */
  requerido?: boolean
}

type Pedido =
  | { tipo: 'confirm'; mensaje: string; opciones: ConfirmOptions }
  | { tipo: 'prompt'; mensaje: string; opciones: PromptOptions }

interface ConfirmContextValue {
  confirmar: (mensaje: string, opciones?: ConfirmOptions) => Promise<boolean>
  preguntar: (mensaje: string, opciones?: PromptOptions) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [valorPrompt, setValorPrompt] = useState('')
  // Resolver en un ref: si se pide un 2do confirm mientras el modal sigue abierto (no debería
  // pasar con la UI deshabilitada de fondo, pero un doble-click es barato de blindar), el anterior
  // se resuelve `false`/`null` en vez de quedar colgado para siempre.
  const resolverRef = useRef<((v: any) => void) | null>(null)

  const cerrar = useCallback((valor: boolean | string | null) => {
    resolverRef.current?.(valor)
    resolverRef.current = null
    setPedido(null)
  }, [])

  const confirmar = useCallback((mensaje: string, opciones: ConfirmOptions = {}): Promise<boolean> => {
    resolverRef.current?.(false)
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
      setPedido({ tipo: 'confirm', mensaje, opciones })
    })
  }, [])

  const preguntar = useCallback((mensaje: string, opciones: PromptOptions = {}): Promise<string | null> => {
    resolverRef.current?.(null)
    setValorPrompt(opciones.valorInicial ?? '')
    return new Promise<string | null>(resolve => {
      resolverRef.current = resolve
      setPedido({ tipo: 'prompt', mensaje, opciones })
    })
  }, [])

  const esPrompt = pedido?.tipo === 'prompt'
  const requerido = esPrompt ? (pedido.opciones.requerido ?? true) : false
  const puedeConfirmar = !esPrompt || !requerido || valorPrompt.trim() !== ''

  return (
    <ConfirmContext.Provider value={{ confirmar, preguntar }}>
      {children}
      {pedido && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
          onClick={() => cerrar(pedido.tipo === 'prompt' ? null : false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}
            role="alertdialog" aria-modal="true"
            onKeyDown={e => {
              if (e.key === 'Escape') cerrar(pedido.tipo === 'prompt' ? null : false)
              if (e.key === 'Enter' && pedido.tipo === 'confirm') cerrar(true)
              if (e.key === 'Enter' && pedido.tipo === 'prompt' && puedeConfirmar) cerrar(valorPrompt)
            }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                pedido.tipo === 'confirm' && pedido.opciones.danger
                  ? 'bg-red-100 dark:bg-red-900/30' : 'bg-accent/10'}`}>
                {pedido.tipo === 'confirm' && pedido.opciones.danger
                  ? <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
                  : <HelpCircle size={20} className="text-accent-text" />}
              </div>
              <div className="min-w-0 pt-1.5">
                {pedido.opciones.titulo && (
                  <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">{pedido.opciones.titulo}</h2>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{pedido.mensaje}</p>
              </div>
            </div>

            {pedido.tipo === 'prompt' && (
              <input
                type="text" autoFocus value={valorPrompt}
                onChange={e => setValorPrompt(e.target.value)}
                placeholder={pedido.opciones.placeholder}
                className="w-full px-3 py-2 mb-4 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text"
              />
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => cerrar(pedido.tipo === 'prompt' ? null : false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 transition-all"
              >
                {pedido.opciones.cancelText ?? 'Cancelar'}
              </button>
              <button
                autoFocus={pedido.tipo === 'confirm'}
                disabled={!puedeConfirmar}
                onClick={() => cerrar(pedido.tipo === 'prompt' ? valorPrompt : true)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 ${
                  pedido.tipo === 'confirm' && pedido.opciones.danger
                    ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent/90'}`}
              >
                {pedido.opciones.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

/** `confirmar('¿Seguro?')` — reemplazo directo de `window.confirm`, con la misma semántica true/false. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm() necesita <ConfirmProvider> montado en la raíz de la app')
  return ctx.confirmar
}

/** `preguntar('Nombre:')` — reemplazo directo de `window.prompt`, con la misma semántica string/null. */
export function usePrompt() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('usePrompt() necesita <ConfirmProvider> montado en la raíz de la app')
  return ctx.preguntar
}
