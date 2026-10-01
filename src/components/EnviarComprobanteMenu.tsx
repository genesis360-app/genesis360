// Botón "Enviar" de un comprobante (ticket, factura, NC) con dos opciones: Mail y WhatsApp (pedido de GO 2026-10-01).
import { useEffect, useRef, useState } from 'react'
import { Mail, MessageCircle, Send, RefreshCw } from 'lucide-react'

interface Props {
  onMail: () => void
  /** Se llama dentro del click: abrir la pestaña de WhatsApp ahí evita el bloqueador de ventanas emergentes. */
  onWhatsApp: () => void
  ocupado?: boolean
  /** Solo ícono (filas compactas, p. ej. la NC en el detalle de la venta). */
  compacto?: boolean
  className?: string
  /** Abre el menú hacia arriba (cuando el botón está al pie de un modal). */
  haciaArriba?: boolean
}

export function EnviarComprobanteMenu({ onMail, onWhatsApp, ocupado, compacto, className = '', haciaArriba }: Props) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAbierto(false) } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])

  const opcion = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'

  return (
    <div ref={ref} className={`relative ${compacto ? '' : 'flex-1'} ${className}`}>
      {compacto ? (
        <button type="button" title="Enviar" aria-label="Enviar" aria-haspopup="menu" aria-expanded={abierto}
          disabled={ocupado} onClick={() => setAbierto(o => !o)}
          className="p-1 text-gray-500 hover:text-accent-text hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50">
          {ocupado ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      ) : (
        <button type="button" aria-haspopup="menu" aria-expanded={abierto} disabled={ocupado} onClick={() => setAbierto(o => !o)}
          className="w-full flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all text-sm disabled:opacity-50">
          {ocupado ? <><RefreshCw size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar</>}
        </button>
      )}
      {abierto && (
        <div role="menu"
          className={`absolute z-50 ${haciaArriba ? 'bottom-full mb-1' : 'top-full mt-1'} ${compacto ? 'right-0' : 'left-0 right-0'} min-w-[10rem] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden`}>
          <button type="button" role="menuitem" className={opcion} onClick={() => { setAbierto(false); onMail() }}>
            <Mail size={15} /> Mail
          </button>
          <button type="button" role="menuitem" className={opcion} onClick={() => { setAbierto(false); onWhatsApp() }}>
            <MessageCircle size={15} className="text-green-600" /> WhatsApp
          </button>
        </div>
      )}
    </div>
  )
}
