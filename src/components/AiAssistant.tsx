import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot, X, Send, AlertCircle, RotateCcw, CheckCircle, Settings2, Check, XCircle, Brain } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// Plan IA, Fase 2 (wiring) — propuesta de cambio de configuración que la EF arma cuando el
// modelo usa la herramienta "proponer_cambio_configuracion" (nunca aplica nada por sí sola).
interface PropuestaConfig {
  campo: string
  tipo: 'bool' | 'int' | 'text'
  descripcion: string
  valorActual: unknown
  valorPropuesto: string | number | boolean
  razon: string
  estado: 'pendiente' | 'confirmada' | 'rechazada' | 'error'
  error?: string
}

// Plan IA, Fase 3 (memoria persistente por tenant) — propuesta de guardar un hecho en la
// memoria del negocio, que la EF arma cuando el modelo usa la herramienta
// "guardar_hecho_memoria" (nunca guarda nada por sí sola).
interface PropuestaMemoria {
  hecho: string
  estado: 'pendiente' | 'confirmada' | 'rechazada' | 'error'
  error?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  propuesta?: PropuestaConfig
  propuestaMemoria?: PropuestaMemoria
}

const RPC_POR_TIPO: Record<PropuestaConfig['tipo'], string> = {
  bool: 'fn_ai_config_set_bool',
  int: 'fn_ai_config_set_int',
  text: 'fn_ai_config_set_text',
}

function formatValorConfig(v: unknown): string {
  if (v === null || v === undefined) return '(sin valor)'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return String(v)
}

/** Contexto real del usuario (rol/modo/menú visible) que la EF usa para no inventar UI. */
export interface AsistenteContexto {
  rol: string
  modoAvanzado: boolean
  plan?: string
  modulos: { label: string; ruta: string; bloqueadoPorPlan?: boolean }[]
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const QUICK_ACTIONS = [
  { label: 'Reportar un problema', prompt: 'Quiero reportar un problema con la app.' },
  { label: '¿Cómo ingreso stock?', prompt: '¿Cómo ingreso stock en el inventario?' },
  { label: '¿Cómo registro una venta?', prompt: '¿Cómo registro una venta?' },
  { label: '¿Qué roles existen?', prompt: '¿Qué roles de usuario existen y qué puede hacer cada uno?' },
]

// Memoria conversacional de corto plazo (G5 plan IA, Fase 1) — sobrevive a un F5/recarga de
// página dentro de la misma pestaña (sessionStorage, no localStorage: se pierde al cerrar la
// pestaña, a propósito — es "corto plazo", no memoria persistente entre sesiones, eso es Fase 3).
// Keyed por usuario para no mezclar conversaciones en una PC compartida (ej. POS de mostrador
// donde varios cajeros loguean/desloguean en el mismo navegador).
const storageKey = (userId?: string) => `g360-ai-assistant-messages-${userId ?? 'anon'}`

function cargarMensajesGuardados(userId?: string): Message[] {
  try {
    const raw = sessionStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function AiAssistant({ className = '', contexto }: { className?: string; contexto?: AsistenteContexto }) {
  const { user, tenant, setTenant } = useAuthStore()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(() => cargarMensajesGuardados(user?.id))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingReport, setSendingReport] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A quién pertenece el `messages` actualmente en memoria — evita que, al cambiar de usuario
  // (login/logout en una PC compartida), el efecto de "persistir" escriba los mensajes del
  // usuario VIEJO bajo la clave del usuario NUEVO antes de que el efecto de "recargar" alcance a
  // reemplazarlos (ambos efectos disparan en el mismo render por depender de `user?.id`).
  const usuarioDeMessages = useRef(user?.id)
  // Lock síncrono contra doble-submit de "Confirmar" (doble click antes del re-render que
  // esconde los botones) — un Set en un ref se lee/escribe sincrónicamente, a diferencia de
  // `messages`/`estado` que dependen del ciclo de render de React.
  const propuestasEnCurso = useRef(new Set<number>())

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

  // Persistir la conversación en sessionStorage (sobrevive a F5, no a cerrar la pestaña) — G5
  // plan IA, Fase 1. Si vacía (recién reseteada), limpiar la clave en vez de guardar "[]". Se
  // salta el guardado cuando `messages` todavía pertenece al usuario ANTERIOR (ver ref arriba) —
  // ese caso lo resuelve el efecto de abajo, que reemplaza `messages` por los del usuario nuevo.
  useEffect(() => {
    if (usuarioDeMessages.current !== user?.id) return
    try {
      if (messages.length === 0) sessionStorage.removeItem(storageKey(user?.id))
      else sessionStorage.setItem(storageKey(user?.id), JSON.stringify(messages))
    } catch { /* storage lleno/deshabilitado — no bloquear el chat por esto */ }
  }, [messages, user?.id])

  // Cambio de usuario en la misma pestaña (login/logout en una PC compartida, ej. POS de
  // mostrador) — recargar la conversación guardada de ESE usuario, no arrastrar la anterior.
  useEffect(() => {
    if (usuarioDeMessages.current === user?.id) return
    usuarioDeMessages.current = user?.id
    setMessages(cargarMensajesGuardados(user?.id))
  }, [user?.id])

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
        body: JSON.stringify({
          // Solo role+content — la EF los reenvía tal cual a Groq, que no reconoce el campo
          // `propuesta` (UI-only) que le agregamos a los mensajes guardados localmente.
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          contexto: contexto ? { ...contexto, ruta: pathname } : undefined,
        }),
      })
      const data = await res.json()
      if (data.propuesta) {
        // Plan IA, Fase 2 (wiring) — la EF NUNCA aplica el cambio, solo arma la propuesta acá;
        // el `content` sirve de contexto para el modelo en el próximo turno, la tarjeta real
        // se renderiza desde `propuesta`.
        const p = data.propuesta
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Propuesta: cambiar "${p.descripcion}" de ${formatValorConfig(p.valorActual)} a ${formatValorConfig(p.valorPropuesto)}. Razón: ${p.razon}`,
          propuesta: { ...p, estado: 'pendiente' },
        }])
      } else if (data.propuestaMemoria) {
        // Plan IA, Fase 3 (wiring) — la EF NUNCA guarda nada, solo arma la propuesta acá; el
        // usuario confirma o rechaza con la misma mecánica que la propuesta de config.
        const p = data.propuestaMemoria
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Propuesta: guardar en la memoria del negocio — "${p.hecho}"`,
          propuestaMemoria: { hecho: p.hecho, estado: 'pendiente' },
        }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? data.error ?? 'Error al responder.' }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No pude conectarme. Revisá tu conexión e intentá de nuevo.' }])
    } finally {
      setLoading(false)
    }
  }

  // Plan IA, Fase 2 (wiring) — recién ACÁ se llama a la RPC (mig 376), con la sesión REAL del
  // usuario (no la EF, no service_role) — el server revalida rol/allowlist de nuevo, no confía
  // en que la tarjeta llegó de un usuario habilitado solo porque el front la mostró.
  const confirmarPropuesta = async (idx: number) => {
    const p = messages[idx]?.propuesta
    if (!p || p.estado !== 'pendiente') return
    if (propuestasEnCurso.current.has(idx)) return // doble click antes del re-render
    propuestasEnCurso.current.add(idx)
    setMessages(prev => prev.map((m, i) => i === idx && m.propuesta ? { ...m, propuesta: { ...m.propuesta, estado: 'confirmada' } } : m))
    const { error } = await supabase.rpc(RPC_POR_TIPO[p.tipo], { p_campo: p.campo, p_valor: p.valorPropuesto, p_razon: p.razon })
    if (error) {
      setMessages(prev => prev.map((m, i) => i === idx && m.propuesta ? { ...m, propuesta: { ...m.propuesta, estado: 'error', error: error.message } } : m))
    } else if (tenant) {
      // Sincronizar el store — el UPDATE ya pasó server-side, sin esto el resto de la app
      // (ej. Configuración) sigue mostrando el valor viejo hasta el próximo login/reload.
      setTenant({ ...tenant, [p.campo]: p.valorPropuesto } as typeof tenant)
    }
    propuestasEnCurso.current.delete(idx)
  }

  const rechazarPropuesta = (idx: number) => {
    setMessages(prev => prev.map((m, i) => i === idx && m.propuesta ? { ...m, propuesta: { ...m.propuesta, estado: 'rechazada' } } : m))
  }

  // Plan IA, Fase 3 (wiring) — recién ACÁ se llama a la RPC (mig 377), con la sesión REAL del
  // usuario — misma mecánica que confirmarPropuesta: la EF nunca guardó nada, solo propuso.
  const confirmarMemoria = async (idx: number) => {
    const p = messages[idx]?.propuestaMemoria
    if (!p || p.estado !== 'pendiente') return
    if (propuestasEnCurso.current.has(idx)) return // doble click antes del re-render
    propuestasEnCurso.current.add(idx)
    setMessages(prev => prev.map((m, i) => i === idx && m.propuestaMemoria ? { ...m, propuestaMemoria: { ...m.propuestaMemoria, estado: 'confirmada' } } : m))
    const { error } = await supabase.rpc('fn_ai_memoria_guardar', { p_hecho: p.hecho })
    if (error) {
      setMessages(prev => prev.map((m, i) => i === idx && m.propuestaMemoria ? { ...m, propuestaMemoria: { ...m.propuestaMemoria, estado: 'error', error: error.message } } : m))
    }
    propuestasEnCurso.current.delete(idx)
  }

  const rechazarMemoria = (idx: number) => {
    setMessages(prev => prev.map((m, i) => i === idx && m.propuestaMemoria ? { ...m, propuestaMemoria: { ...m.propuestaMemoria, estado: 'rechazada' } } : m))
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
          type: 'bug_report',
          to: 'soporte@genesis360.pro',
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
            ? 'bg-accent/15 text-accent-text'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <Bot size={18} />
      </button>

      {/* Panel.
          📱 En mobile NO puede colgar del botón: el botón vive en el header con 3 íconos más a su
          derecha, así que su borde derecho cae cerca del MEDIO de la pantalla — un panel de 360px
          anclado con `right-0` arrancaba en x negativo y se salía por la izquierda (se veía a la
          mitad). Abajo de `sm` se ancla al VIEWPORT (`fixed inset-x-3`), que es lo único que
          garantiza que entre sin importar dónde esté el botón; de `sm` para arriba sigue siendo el
          dropdown de siempre.
          `dvh` y no `vh`: en mobile `100vh` cuenta la barra de direcciones y el panel se corta abajo. */}
      {open && (
        <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[400px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden z-50"
          style={{ maxHeight: 'calc(100dvh - 88px)', height: '520px' }}>

          {/* Header del panel */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
              <Bot size={15} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white leading-none">Asistente Genesis360</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Powered by Groq</p>
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
                      className="text-left text-xs px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-accent-text hover:text-accent-text transition-colors leading-snug">
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.propuesta ? (
                  // Plan IA, Fase 2 (wiring) — tarjeta de confirmación: la IA NUNCA aplicó nada
                  // todavía, solo propuso. Confirmar recién ahí llama a la RPC (mig 376).
                  <div className="max-w-[90%] w-full rounded-2xl rounded-bl-sm border border-accent/30 bg-accent/5 dark:bg-accent/10 px-3.5 py-3 text-sm">
                    <div className="flex items-center gap-1.5 text-accent-text font-medium mb-1.5">
                      <Settings2 size={14} /> Propuesta de configuración
                    </div>
                    <p className="text-gray-700 dark:text-gray-300">{m.propuesta.descripcion}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs">
                      <span className="text-gray-400 dark:text-gray-500 line-through">{formatValorConfig(m.propuesta.valorActual)}</span>
                      <span className="text-gray-400 dark:text-gray-500">→</span>
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{formatValorConfig(m.propuesta.valorPropuesto)}</span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">"{m.propuesta.razon}"</p>

                    {m.propuesta.estado === 'pendiente' && (
                      <div className="flex gap-2 mt-2.5">
                        <button onClick={() => confirmarPropuesta(i)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors">
                          <Check size={13} /> Confirmar
                        </button>
                        <button onClick={() => rechazarPropuesta(i)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          <XCircle size={13} /> Rechazar
                        </button>
                      </div>
                    )}
                    {m.propuesta.estado === 'confirmada' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle size={13} /> Cambio aplicado
                      </div>
                    )}
                    {m.propuesta.estado === 'rechazada' && (
                      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Rechazada — sin cambios.</p>
                    )}
                    {m.propuesta.estado === 'error' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                        <AlertCircle size={13} /> No se pudo aplicar: {m.propuesta.error ?? 'error desconocido'}
                      </div>
                    )}
                  </div>
                ) : m.propuestaMemoria ? (
                  // Plan IA, Fase 3 (wiring) — tarjeta de confirmación: la IA NUNCA guardó nada
                  // todavía, solo propuso. Confirmar recién ahí llama a la RPC (mig 377).
                  <div className="max-w-[90%] w-full rounded-2xl rounded-bl-sm border border-accent/30 bg-accent/5 dark:bg-accent/10 px-3.5 py-3 text-sm">
                    <div className="flex items-center gap-1.5 text-accent-text font-medium mb-1.5">
                      <Brain size={14} /> Guardar en la memoria del negocio
                    </div>
                    <p className="text-gray-700 dark:text-gray-300">"{m.propuestaMemoria.hecho}"</p>

                    {m.propuestaMemoria.estado === 'pendiente' && (
                      <div className="flex gap-2 mt-2.5">
                        <button onClick={() => confirmarMemoria(i)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors">
                          <Check size={13} /> Confirmar
                        </button>
                        <button onClick={() => rechazarMemoria(i)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          <XCircle size={13} /> Rechazar
                        </button>
                      </div>
                    )}
                    {m.propuestaMemoria.estado === 'confirmada' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle size={13} /> Guardado
                      </div>
                    )}
                    {m.propuestaMemoria.estado === 'rechazada' && (
                      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Rechazada — sin guardar.</p>
                    )}
                    {m.propuestaMemoria.estado === 'error' && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                        <AlertCircle size={13} /> No se pudo guardar: {m.propuestaMemoria.error ?? 'error desconocido'}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                    ${m.role === 'user'
                      ? 'bg-accent text-white rounded-br-sm'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                    }`}>
                    {m.content}
                  </div>
                )}
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
