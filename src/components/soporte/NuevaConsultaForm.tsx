import { useState } from 'react'
import { Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { SelectorAdjuntos } from '@/components/soporte/SelectorAdjuntos'
import { crearConsulta } from '@/lib/soporteApi'
import { TIPOS_CONSULTA, URGENCIAS, validarNuevaConsulta, type TipoConsulta, type Urgencia } from '@/lib/soporte'

const CAMPO = 'w-full text-sm border border-border-ds rounded-xl px-3 py-2 bg-white dark:bg-gray-700 text-primary dark:text-white focus:outline-none focus:border-accent-text'

/**
 * "Reportar un problema" (Ayuda, mig 426): crea una consulta que queda en Ayuda → Mis consultas y le llega al equipo
 * por mail y marcada en el panel. Se usa en el panel lateral de Ayuda y en la página de consultas.
 */
export function NuevaConsultaForm({ modulo, onCreada, compacto = false }: {
  modulo?: string
  onCreada?: (ticketId: string) => void
  compacto?: boolean
}) {
  const { user, tenant } = useAuthStore()
  const qc = useQueryClient()
  const [tipo, setTipo] = useState<TipoConsulta>('problema')
  const [urgencia, setUrgencia] = useState<Urgencia>('media')
  const [asunto, setAsunto] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const prefijo = compacto ? 'ayuda-consulta' : 'consulta'

  const enviar = async () => {
    if (!user || !tenant) return
    const error = validarNuevaConsulta({ asunto, cuerpo })
    if (error) { toast.error(error); return }
    setEnviando(true)
    try {
      const id = await crearConsulta({
        tenantId: tenant.id, userId: user.id, asunto: asunto.trim(), cuerpo: cuerpo.trim(), tipo, urgencia, modulo, archivos,
      })
      toast.success('Consulta enviada. Te avisamos en la campanita cuando respondamos.')
      setAsunto(''); setCuerpo(''); setArchivos([]); setTipo('problema'); setUrgencia('media')
      qc.invalidateQueries({ queryKey: ['soporte-consultas'] })
      onCreada?.(id)
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo enviar la consulta. Escribinos a soporte@genesis360.pro')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compacto ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div>
          <label htmlFor={`${prefijo}-tipo`} className="text-xs text-muted block mb-1">Tipo</label>
          <select id={`${prefijo}-tipo`} value={tipo} onChange={(e) => setTipo(e.target.value as TipoConsulta)} className={CAMPO}>
            {TIPOS_CONSULTA.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${prefijo}-urgencia`} className="text-xs text-muted block mb-1">Urgencia</label>
          <select id={`${prefijo}-urgencia`} value={urgencia} onChange={(e) => setUrgencia(e.target.value as Urgencia)} className={CAMPO}>
            {URGENCIAS.map((u) => <option key={u.valor} value={u.valor}>{u.etiqueta}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${prefijo}-asunto`} className="text-xs text-muted block mb-1">Asunto</label>
        <input
          id={`${prefijo}-asunto`}
          value={asunto}
          maxLength={120}
          onChange={(e) => setAsunto(e.target.value)}
          placeholder="En pocas palabras, ¿qué pasa?"
          className={CAMPO}
        />
      </div>
      <div>
        <label htmlFor={`${prefijo}-cuerpo`} className="text-xs text-muted block mb-1">Detalle</label>
        <textarea
          id={`${prefijo}-cuerpo`}
          value={cuerpo}
          maxLength={4000}
          rows={compacto ? 3 : 5}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder="Qué estabas haciendo, qué esperabas que pasara y qué pasó."
          className={`${CAMPO} resize-none`}
        />
      </div>
      <SelectorAdjuntos id={`${prefijo}-adjuntos`} archivos={archivos} onChange={setArchivos} disabled={enviando} />
      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className="w-full bg-accent hover:bg-accent/90 text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Send size={14} />
        {enviando ? 'Enviando…' : 'Enviar consulta'}
      </button>
    </div>
  )
}
