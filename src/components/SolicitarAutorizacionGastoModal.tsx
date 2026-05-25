import { useState } from 'react'
import { X, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { logActividad } from '@/lib/actividadLog'
import toast from 'react-hot-toast'

type Tipo = 'crear' | 'editar' | 'eliminar'

interface Props {
  tipo: Tipo
  monto: number
  descripcion: string
  payload: Record<string, any>
  umbral: number | null
  rolMinimoAprobador: 'SUPERVISOR' | 'DUEÑO'
  sucursalId?: string | null
  gastoId?: string | null
  onClose: () => void
  onSubmitted?: () => void
}

const tipoLabel: Record<Tipo, string> = {
  crear: 'creación',
  editar: 'edición',
  eliminar: 'eliminación',
}

export default function SolicitarAutorizacionGastoModal({
  tipo, monto, descripcion, payload, umbral, rolMinimoAprobador,
  sucursalId, gastoId, onClose, onSubmitted,
}: Props) {
  const { tenant, user } = useAuthStore()
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!motivo.trim()) return toast.error('Ingresá un motivo para la solicitud')
    setSubmitting(true)
    const { data, error } = await supabase.from('autorizaciones_gasto').insert({
      tenant_id:       tenant!.id,
      sucursal_id:     sucursalId ?? null,
      gasto_id:        gastoId ?? null,
      tipo,
      monto,
      descripcion,
      motivo:          motivo.trim(),
      payload,
      solicitante_id:  user!.id,
      solicitante_rol: user!.rol,
    }).select('id').single()
    setSubmitting(false)
    if (error) return toast.error(error.message)
    logActividad({ entidad: 'autorizacion_gasto', entidad_id: data?.id, entidad_nombre: descripcion, accion: 'solicitar', pagina: '/gastos' })
    toast.success(`Solicitud enviada al ${rolMinimoAprobador}`)
    onSubmitted?.()
    onClose()
  }

  useModalKeyboard({ onClose, onConfirm: submit, isOpen: true })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Solicitar autorización</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">{tipoLabel[tipo]} de gasto · aprueba {rolMinimoAprobador} o superior</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-300">
            El monto <strong>${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>{' '}
            {umbral != null
              ? <>supera tu umbral de <strong>${Number(umbral).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>.</>
              : <>requiere autorización (no tenés un umbral configurado).</>}
          </div>

          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Descripción del gasto</label>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{descripcion || '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo de la solicitud</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
              rows={3}
              placeholder="Explicale brevemente al aprobador por qué es necesario este gasto…"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={submit} disabled={submitting || !motivo.trim()}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {submitting ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </div>
      </div>
    </div>
  )
}
