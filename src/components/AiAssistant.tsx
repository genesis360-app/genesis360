import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, AlertCircle, RotateCcw, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const QUICK_ACTIONS = [
  { label: 'Reportar un problema', prompt: 'Quiero reportar un problema con la app.' },
  { label: '¿Cómo ingreso stock?', prompt: '¿Cómo ingreso stock en el inventario?' },
  { label: '¿Cómo registro una venta?', prompt: '¿Cómo registro una venta?' },
  { label: '¿Qué roles existen?', prompt: '¿Qué roles de usuario existen y qué puede hacer cada uno?' },
]

export function AiAssistant({ className = '' }: { className?: string }) {
  const { user, tenant } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingReport, setSendingReport] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ESC para cerrar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Scroll al final cuando llegan mensajes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input al abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const sendMessage = async (text: string) => {
    const content = text.trim()
    if (!content || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ messages: newMessages }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? 'Error al responder.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No pude conectarme. Revisá tu conexión e intentá de nuevo.' }])
    } finally {
      setLoading(false)
    }
  }

  const sendReport = async () => {
    if (messages.length < 2 || sendingReport) return
    setSendingReport(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resumen = messages
        .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
        .join('\n\n')
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          tipo: 'bug_report',
          to: 'gaston.otranto@gmail.com',
          data: {
            usuario: user?.nombre_display ?? 'Usuario',
            tenant: tenant?.nombre ?? '-',
            resumen,
          },
        }),
      })
      setReportSent(true)
    } catch {
      // silencioso
    } finally {
      setSendingReport(false)
    }
  }

  const reset = () => {
    setMessages([])
    setInput('')
    setReportSent(false)
  }

  // Mostrar botón "Enviar reporte" cuando hay suficiente contexto
  const showSendReport = messages.length >= 4 && !reportSent

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Botón header */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Asistente IA"
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-xl transition-colors
          ${open
            ? 'bg-accent/15 text-accent'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <Bot size={18} />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] sm:w-[400px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden z-50"
          style={{ maxHeight: 'calc(100vh - 80px)', height: '520px' }}>

          {/* Header del panel */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
              <Bot size={15} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white leading-none">Asistente Genesis360</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Powered by Llama 3.1</p>
            </div>
            <button onClick={reset} title="Nueva conversación"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X size={16} />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="bg-accent/8 dark:bg-accent/15 rounded-xl p-3.5">
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    ¡Hola! Soy el asistente de Genesis360. Puedo ayudarte con preguntas sobre la app, guiarte por sus funciones o ayudarte a reportar un problema.
                  </p>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">Acciones rápidas</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_ACTIONS.map(a => (
                    <button key={a.label} onClick={() => sendMessage(a.prompt)}
                      className="text-left text-xs px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent hover:text-accent transition-colors leading-snug">
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                  ${m.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                  }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-4">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Botón enviar reporte */}
          {(showSendReport || reportSent) && (
            <div className="px-4 pb-2 shrink-0">
              {reportSent ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-xs bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">
                  <CheckCircle size={14} />
                  Reporte enviado. Lo revisaremos pronto.
                </div>
              ) : (
                <button onClick={sendReport} disabled={sendingReport}
                  className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-xl border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-60">
                  <AlertCircle size={13} />
                  {sendingReport ? 'Enviando...' : 'Enviar reporte al equipo'}
                </button>
              )}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 shrink-0">
            <form onSubmit={e => { e.preventDefault(); sendMessage(input) }}
              className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Escribí tu consulta..."
                disabled={loading}
                className="flex-1 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
              />
              <button type="submit" disabled={!input.trim() || loading}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-accent disabled:opacity-40 hover:bg-accent/90 transition-colors shrink-0">
                <Send size={13} className="text-white" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
