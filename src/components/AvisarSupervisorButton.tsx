import { useState } from 'react'
import { Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { usePrompt } from '@/hooks/useConfirm'
import { avisarSupervisor } from '@/hooks/useSupervisorAutorizaciones'

// F1 del relevamiento de Supervisor (Confirmado): "se construye genérico desde el día uno, cualquier
// módulo puede usar el botón 'Avisar al supervisor'". F2: llega a quien tenga permiso `supervisa` en
// ese módulo (resuelto por herencia de C2). `contexto` ya trae identificado producto/ubicación/tarea
// (mismo criterio que pedía el relevamiento original de Repositores, C1) — la nota es opcional.

interface Props {
  modulo: string
  /** Ej: "LPN E2E-... — Producto X" — se antepone al mensaje, ya identifica de qué se trata. */
  contexto: string
  actionUrl: string
  className?: string
}

export function AvisarSupervisorButton({ modulo, contexto, actionUrl, className }: Props) {
  const { tenant, user } = useAuthStore()
  const preguntar = usePrompt()
  const [enviando, setEnviando] = useState(false)

  const handleClick = async () => {
    const nota = await preguntar('¿Algo para agregar? (opcional)', {
      titulo: 'Avisar al supervisor', placeholder: 'Ej: falta stock, precio dudoso...', requerido: false,
    })
    if (nota === null) return // canceló
    setEnviando(true)
    try {
      const mensaje = nota.trim() ? `${contexto} — ${nota.trim()}` : contexto
      const n = await avisarSupervisor(tenant!.id, modulo, user?.id, 'Aviso al supervisor', mensaje, actionUrl)
      toast.success(n > 0 ? `Avisado — ${n} supervisor${n !== 1 ? 'es' : ''} notificado${n !== 1 ? 's' : ''}` : 'No hay supervisores para notificar en este módulo')
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo enviar el aviso')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={enviando}
      className={className ?? 'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50'}>
      <Bell size={13} /> Avisar al supervisor
    </button>
  )
}
