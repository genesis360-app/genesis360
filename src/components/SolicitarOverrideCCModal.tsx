// Modal para solicitar al DUEÑO autorización para crear CC bloqueada (v1.8.44)
import { useState } from 'react'
import { X, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useModalKeyboard } from '@/hooks/useModalKeyboard'
import { logActividad } from '@/lib/actividadLog'
import type { MotivoBloqueoCC } from '@/lib/ccProveedor'
import toast from 'react-hot-toast'

interface Props {
  proveedorId: string
  proveedorNombre: string
  ocId?: string | null
  monto: number
  motivoBloqueo: MotivoBloqueoCC
  detalle: string
  onClose: () => void
  onSubmitted?: () => void
}

const motivoLabel: Record<MotivoBloqueoCC, string> = {
  limite_excedido: 'Límite de CC excedido',
  oc_vencida:      'OC con CC vencida sin pagar',
}

export default function SolicitarOverrideCCModal({
  proveedorId, proveedorNombre, ocId, monto, motivoBloqueo, detalle, onClose, onSubmitted,
}: Props) {
  const { tenant, user } = useAuthStore()
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!motivo.trim()) return toast.error('Ingresá un motivo para la solicitud')
    setSubmitting(true)
    const { data, error } = await supabase.from('autorizaciones_cc').insert({
      tenant_id:       tenant!.id,
      proveedor_id:    proveedorId,
      oc_id:           ocId ?? null,
      motivo_bloqueo:  motivoBloqueo,
      monto,
      motivo:          motivo.trim(),
      solicitante_id:  user!.id,
      solicitante_rol: user!.rol,
    }).select('id').single()
    setSubmitting(false)
    if (error) return toast.error(error.message)
    logActividad({ entidad: 'autorizacion_gasto', entidad_id: data?.id, entidad_nombre: `CC ${proveedorNombre}`, accion: 'solicitar', pagina: '/gastos' })
    toast.success('Solicitud enviada al DUEÑO')
    onSubmitted?.()
    onClose()
  }

  useModalKeyboard({ onClose, onConfirm: submit, isOpen: true })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">CC bloqueada — solicitar override</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">Aprueba el DUEÑO</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl p-3 text-sm">
            <p className="font-medium text-red-700 dark:text-red-400 mb-1">🚫 {motivoLabel[motivoBloqueo]}</p>
            <p className="text-red-700 dark:text-red-300 text-xs">{detalle}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Proveedor</p>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{proveedorNombre}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Monto CC nuevo</p>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo de la solicitud</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
              rows={3}
              placeholder="Explicale al DUEÑO por qué necesitás crear esta CC a pesar del bloqueo..."
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent-text bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={submit} disabled={submitting || !motivo.trim()}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {submitting ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </div>
      </div>
    </div>
  )
}
