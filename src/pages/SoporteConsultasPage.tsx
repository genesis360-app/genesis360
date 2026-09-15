import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LifeBuoy, Plus, Send, MessageSquare, Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { NuevaConsultaForm } from '@/components/soporte/NuevaConsultaForm'
import { SelectorAdjuntos } from '@/components/soporte/SelectorAdjuntos'
import { listarConsultas, verConsulta, responderConsulta, marcarAvisosLeidos } from '@/lib/soporteApi'
import { estadoParaCliente, puedeResponder, validarRespuesta, type EstadoCliente } from '@/lib/soporte'

// Ayuda → Mis consultas (mig 426). Cada usuario ve sus consultas; DUEÑO y SUPER_USUARIO, todas las del negocio (lo
// resuelve la base). Vive fuera del SubscriptionGuard: con la prueba vencida también hay que poder hablar con soporte.

const TONO: Record<EstadoCliente['tono'], string> = {
  revision: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  respondida: 'bg-accent/10 text-accent-text',
  resuelta: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cerrada: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

const fecha = (s: string) =>
  new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SoporteConsultasPage() {
  const { user, tenant } = useAuthStore()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const seleccionada = searchParams.get('ticket')
  const [nueva, setNueva] = useState(searchParams.get('nueva') === '1')
  const [respuesta, setRespuesta] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])

  const { data: consultas = [], isLoading } = useQuery({
    queryKey: ['soporte-consultas', user?.id],
    queryFn: listarConsultas,
    enabled: !!user,
  })

  const { data: detalle, isLoading: cargandoDetalle, error: errorDetalle } = useQuery({
    queryKey: ['soporte-consulta', seleccionada],
    queryFn: () => verConsulta(seleccionada!),
    enabled: !!user && !!seleccionada && !nueva,
  })

  useEffect(() => {
    if (!user || !seleccionada) return
    void marcarAvisosLeidos(user.id, seleccionada).then(() => qc.invalidateQueries({ queryKey: ['notificaciones', user.id] }))
  }, [user, seleccionada, qc])

  const abrir = (ticketId: string) => {
    setNueva(false)
    setRespuesta('')
    setArchivos([])
    setSearchParams({ ticket: ticketId })
  }

  const responder = useMutation({
    mutationFn: async () => {
      const error = validarRespuesta(respuesta)
      if (error) throw new Error(error)
      await responderConsulta({
        tenantId: tenant!.id, userId: user!.id, ticketId: seleccionada!, asunto: detalle!.ticket.asunto,
        cuerpo: respuesta.trim(), archivos,
      })
    },
    onSuccess: () => {
      toast.success('Respuesta enviada')
      setRespuesta('')
      setArchivos([])
      qc.invalidateQueries({ queryKey: ['soporte-consulta', seleccionada] })
      qc.invalidateQueries({ queryKey: ['soporte-consultas'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const veTodas = user?.rol === 'DUEÑO' || user?.rol === 'SUPER_USUARIO'

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary dark:text-white flex items-center gap-2">
            <LifeBuoy size={24} className="text-accent-text" /> Mis consultas
          </h1>
          <p className="text-sm text-muted mt-1">
            {veTodas ? 'Las consultas de todo el negocio con el equipo de soporte.' : 'Lo que le escribiste al equipo de soporte.'}
            {' '}Te avisamos en la campanita cuando respondemos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setNueva(true); setSearchParams({}) }}
          className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} /> Nueva consulta
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4 items-start">
        {/* Lista */}
        <div className="bg-surface border border-border-ds rounded-xl overflow-hidden">
          {isLoading ? (
            <p className="p-5 text-sm text-muted">Cargando…</p>
          ) : consultas.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              <MessageSquare size={28} className="mx-auto mb-2 text-muted" />
              Todavía no hay consultas. Si algo no funciona o tenés una duda, escribinos desde "Nueva consulta".
            </div>
          ) : (
            <ul className="divide-y divide-border-ds">
              {consultas.map((c) => {
                const estado = estadoParaCliente(c.estado, c.ultimo_autor)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-consulta={c.id}
                      onClick={() => abrir(c.id)}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-page ${seleccionada === c.id && !nueva ? 'bg-accent/5' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-primary dark:text-white line-clamp-2">{c.asunto}</span>
                        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONO[estado.tono]}`}>{estado.etiqueta}</span>
                      </div>
                      <p className="text-xs text-muted mt-1">
                        {fecha(c.ultimo_mensaje_at)} · {c.mensajes} mensaje{c.mensajes === 1 ? '' : 's'}
                        {!c.es_mia && c.usuario_nombre ? ` · de ${c.usuario_nombre}` : ''}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Detalle */}
        <div className="bg-surface border border-border-ds rounded-xl">
          {nueva ? (
            <div className="p-5 space-y-3">
              <h2 className="font-semibold text-primary dark:text-white">Nueva consulta</h2>
              <NuevaConsultaForm onCreada={abrir} />
            </div>
          ) : !seleccionada ? (
            <p className="p-10 text-center text-sm text-muted">Elegí una consulta para ver la conversación.</p>
          ) : cargandoDetalle ? (
            <p className="p-6 text-sm text-muted">Cargando…</p>
          ) : errorDetalle || !detalle ? (
            <p className="p-6 text-sm text-red-600 dark:text-red-400">{(errorDetalle as Error)?.message ?? 'No se pudo abrir la consulta.'}</p>
          ) : (
            <div className="flex flex-col">
              <div className="px-5 py-4 border-b border-border-ds">
                <h2 className="font-semibold text-primary dark:text-white">{detalle.ticket.asunto}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {estadoParaCliente(detalle.ticket.estado, detalle.mensajes[detalle.mensajes.length - 1]?.autor_tipo).etiqueta} · abierta el {fecha(detalle.ticket.created_at)}
                  {!detalle.ticket.es_mia && detalle.ticket.usuario_nombre ? ` por ${detalle.ticket.usuario_nombre}` : ''}
                </p>
              </div>

              <div className="px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
                {detalle.mensajes.map((m) => (
                  <div
                    key={m.id}
                    data-mensaje-autor={m.autor_tipo}
                    className={`rounded-xl p-3 text-sm ${m.autor_tipo === 'cliente' ? 'ml-8 bg-accent/10' : 'mr-8 bg-page border border-border-ds'}`}
                  >
                    <p className="text-xs text-muted mb-1">{m.autor_nombre} · {fecha(m.created_at)}</p>
                    <p className="text-primary dark:text-white whitespace-pre-wrap break-words">{m.cuerpo}</p>
                    {m.adjuntos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {m.adjuntos.map((a) => (
                          a.url ? (
                            <a key={a.path} href={a.url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
                              <Paperclip size={11} /> {a.nombre}
                            </a>
                          ) : (
                            <span key={a.path} className="inline-flex items-center gap-1 text-xs text-muted">
                              <Paperclip size={11} /> {a.nombre}
                            </span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="px-5 py-4 border-t border-border-ds space-y-2">
                {puedeResponder(detalle.ticket.estado) ? (
                  <>
                    <label htmlFor="consulta-respuesta" className="sr-only">Tu respuesta</label>
                    <textarea
                      id="consulta-respuesta"
                      value={respuesta}
                      maxLength={4000}
                      rows={3}
                      onChange={(e) => setRespuesta(e.target.value)}
                      placeholder="Escribí tu respuesta…"
                      className="w-full text-sm border border-border-ds rounded-xl px-3 py-2 bg-white dark:bg-gray-700 text-primary dark:text-white focus:outline-none focus:border-accent-text resize-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SelectorAdjuntos id="consulta-respuesta-adjuntos" archivos={archivos} onChange={setArchivos} disabled={responder.isPending} />
                      <button
                        type="button"
                        onClick={() => responder.mutate()}
                        disabled={responder.isPending || !respuesta.trim()}
                        className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                      >
                        <Send size={14} /> {responder.isPending ? 'Enviando…' : 'Responder'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted">Esta consulta está cerrada. Si necesitás algo más, abrí una nueva.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
