// Bandeja de borradores de gasto capturados por el Asistente de WhatsApp (Fase 2, v1.182.0).
// Solo lista estado='pendiente' — ya confirmados por el remitente de WhatsApp con el botón
// interactivo (whatsapp_gastos_borrador.estado: pendiente_confirmacion -> pendiente). "Aprobar"
// NO crea nada acá: abre el modal "Nuevo Gasto" de siempre (GastosPage.tsx → abrirDesdeBorrador),
// precargado, para que corra la validación/creación real (umbral, CAJ-18, comprobante, multi-CUIT).

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X, MessageCircle, Clock, Image } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface Props {
  onAprobar: (borrador: any) => void
}

export default function BandejaBorradoresWhatsapp({ onAprobar }: Props) {
  const { tenant, user } = useAuthStore()
  const qc = useQueryClient()
  const [procesando, setProcesando] = useState<string | null>(null)

  const { data: borradores = [], isLoading } = useQuery({
    queryKey: ['whatsapp-borradores', tenant?.id],
    queryFn: async () => {
      const { data } = await supabase.from('whatsapp_gastos_borrador')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!tenant,
  })

  const descartar = async (b: any) => {
    setProcesando(b.id)
    try {
      const { error } = await supabase.from('whatsapp_gastos_borrador').update({
        estado: 'descartado', resuelto_por: user!.id, resuelto_at: new Date().toISOString(),
      }).eq('id', b.id)
      if (error) throw error
      toast.success('Borrador descartado')
      qc.invalidateQueries({ queryKey: ['whatsapp-borradores'] })
      qc.invalidateQueries({ queryKey: ['whatsapp-borradores-pendientes-count', tenant?.id] })
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo descartar')
    } finally {
      setProcesando(null)
    }
  }

  const fmtMonto = (n: number) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
  const fmtFecha = (s: string) => new Date(s).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // Fase 3: el borrador puede traer una foto de comprobante ya subida (comprobante_url) — se abre
  // con signed URL, mismo patrón que verComprobante() en GastosPage.tsx.
  const verFoto = async (path: string) => {
    const { data } = await supabase.storage.from('comprobantes-gastos').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('No se pudo abrir la foto')
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Gastos que alguien le contó al Asistente de WhatsApp — ninguno se guardó todavía como gasto real.
        "Aprobar" abre el formulario de siempre, precargado, para revisarlo y completarlo antes de guardar.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent-text" /></div>
      ) : borradores.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <MessageCircle size={36} className="mb-3 opacity-30" />
          <p className="text-sm">No hay borradores pendientes de revisión</p>
        </div>
      ) : (
        <div className="space-y-2">
          {borradores.map((b: any) => (
            <div key={b.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{b.descripcion}</p>
                <div className="flex gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                  <span>Monto: <strong className="text-gray-700 dark:text-gray-200">{fmtMonto(b.monto)}</strong></span>
                  {b.categoria && <span>Categoría: {b.categoria}</span>}
                  <span><Clock size={11} className="inline -mt-0.5 mr-0.5" />{fmtFecha(b.created_at)}</span>
                  {b.comprobante_url && (
                    <button onClick={() => verFoto(b.comprobante_url)} className="flex items-center gap-1 text-accent-text hover:underline">
                      <Image size={11} /> Ver foto
                    </button>
                  )}
                </div>
              </div>
              <button onClick={() => onAprobar(b)} disabled={procesando === b.id}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                <Check size={12} /> Aprobar
              </button>
              <button onClick={() => descartar(b)} disabled={procesando === b.id}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                <X size={12} /> Descartar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
