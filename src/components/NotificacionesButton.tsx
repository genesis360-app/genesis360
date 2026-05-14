import { Bell, X, ArrowRight, Check, XCircle } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface NotificacionesButtonProps {
  className?: string
}

export function NotificacionesButton({ className = '' }: NotificacionesButtonProps) {
  const { user, tenant } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [procesando, setProcesando] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: notifs = [] } = useQuery({
    queryKey: ['notificaciones', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('notificaciones')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(30)
      return data ?? []
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const unread = (notifs as any[]).filter(n => !n.leida).length

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id: string) => {
    await supabase.from('notificaciones').update({ leida: true }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['notificaciones', user?.id] })
  }

  const markAllRead = async () => {
    const unreadIds = (notifs as any[]).filter(n => !n.leida).map(n => n.id)
    if (!unreadIds.length) return
    await supabase.from('notificaciones').update({ leida: true }).in('id', unreadIds)
    qc.invalidateQueries({ queryKey: ['notificaciones', user?.id] })
  }

  const aprobarSolicitudCajaFuerte = async (n: any) => {
    if (!tenant || !user) return
    setProcesando(n.id)
    try {
      const { monto, concepto, sesion_id, caja_nombre } = n.metadata

      // Verificar que la sesión sigue abierta
      const { data: sesion } = await supabase
        .from('caja_sesiones')
        .select('id, estado')
        .eq('id', sesion_id)
        .single()
      if (!sesion || sesion.estado !== 'abierta') {
        toast.error('La sesión de caja ya fue cerrada. La solicitud no puede ejecutarse.')
        await markRead(n.id)
        return
      }

      // Obtener o crear sesión permanente de caja fuerte
      const { data: cajaFuerte } = await supabase
        .from('cajas')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('es_caja_fuerte', true)
        .single()
      if (!cajaFuerte) throw new Error('No hay caja fuerte configurada')

      let fuerteSessionId: string
      const { data: fuerteSession } = await supabase
        .from('caja_sesiones')
        .select('id')
        .eq('caja_id', cajaFuerte.id)
        .eq('es_permanente', true)
        .maybeSingle()

      if (fuerteSession) {
        fuerteSessionId = fuerteSession.id
      } else {
        const { data: ns, error: eNS } = await supabase
          .from('caja_sesiones')
          .insert({
            tenant_id: tenant.id,
            caja_id: cajaFuerte.id,
            estado: 'abierta',
            es_permanente: true,
            usuario_id: user.id,
            monto_apertura: 0,
          })
          .select('id')
          .single()
        if (eNS) throw eNS
        fuerteSessionId = ns.id
      }

      // Egreso de la caja del cajero
      const { error: e1 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant.id,
        sesion_id,
        tipo: 'egreso_traspaso',
        monto,
        concepto: concepto || `Depósito aprobado en caja fuerte`,
        usuario_id: user.id,
      })
      if (e1) throw e1

      // Ingreso en caja fuerte
      const { error: e2 } = await supabase.from('caja_movimientos').insert({
        tenant_id: tenant.id,
        sesion_id: fuerteSessionId,
        tipo: 'ingreso_traspaso',
        monto,
        concepto: concepto || `Depósito aprobado desde ${caja_nombre}`,
        usuario_id: user.id,
      })
      if (e2) throw e2

      // Marcar esta notificación como leída
      await markRead(n.id)

      // Invalidar queries de caja por si el aprobador está en la página de caja
      qc.invalidateQueries({ queryKey: ['caja-movimientos'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte-movimientos'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte-sesion'] })

      toast.success(`Transferencia de $${monto.toLocaleString('es-AR')} aprobada y ejecutada`)
    } catch (e: any) {
      toast.error(e.message ?? 'Error al aprobar la solicitud')
    } finally {
      setProcesando(null)
    }
  }

  const rechazarSolicitudCajaFuerte = async (n: any) => {
    setProcesando(n.id)
    await markRead(n.id)
    toast('Solicitud rechazada', { icon: '🚫' })
    setProcesando(null)
  }

  function formatFecha(iso: string) {
    const d = new Date(iso)
    const hoy = new Date()
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
    if (d.toDateString() === hoy.toDateString()) return `hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    if (d.toDateString() === ayer.toDateString()) return `ayer ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Notificaciones"
        className={`relative ${className}`}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center border border-white dark:border-gray-900"
            style={{ fontSize: 9, lineHeight: 1 }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border-ds rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-ds">
            <h3 className="font-semibold text-sm text-primary dark:text-white">Notificaciones</h3>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-accent hover:underline">
                  Marcar todas leídas
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-muted hover:text-primary dark:hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          {notifs.length === 0 ? (
            <p className="text-sm text-muted px-4 py-6 text-center">Sin notificaciones</p>
          ) : (
            <div className="divide-y divide-border-ds max-h-96 overflow-y-auto">
              {(notifs as any[]).map(n => {
                const esSolicitudCajaFuerte = n.metadata?.accion === 'solicitud_caja_fuerte'
                const isProcesando = procesando === n.id
                return (
                  <div key={n.id}
                    className={`px-4 py-3 flex items-start gap-3 transition-colors ${n.leida ? 'opacity-60' : 'bg-accent/5'}`}
                  >
                    {!n.leida && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 mt-1.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary dark:text-white leading-snug">{n.titulo}</p>
                      <p className="text-xs text-muted mt-0.5 leading-snug">{n.mensaje}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatFecha(n.created_at)}</p>

                      {/* Botones de aprobación para solicitudes de caja fuerte */}
                      {esSolicitudCajaFuerte && !n.leida && (
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => aprobarSolicitudCajaFuerte(n)}
                            disabled={isProcesando}
                            className="flex items-center gap-1 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-all disabled:opacity-50"
                          >
                            <Check size={11} /> {isProcesando ? 'Ejecutando…' : 'Aprobar'}
                          </button>
                          <button
                            onClick={() => rechazarSolicitudCajaFuerte(n)}
                            disabled={isProcesando}
                            className="flex items-center gap-1 px-2.5 py-1 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                          >
                            <XCircle size={11} /> Rechazar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Botón "Ir" solo para notificaciones que no son solicitudes de aprobación */}
                    {n.action_url && !esSolicitudCajaFuerte && (
                      <button
                        onClick={() => { markRead(n.id); navigate(n.action_url); setOpen(false) }}
                        className="flex-shrink-0 text-accent hover:text-accent/80 text-xs flex items-center gap-1 font-medium whitespace-nowrap mt-0.5"
                      >
                        Ir <ArrowRight size={12} />
                      </button>
                    )}
                    {!n.action_url && !n.leida && !esSolicitudCajaFuerte && (
                      <button onClick={() => markRead(n.id)}
                        className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 whitespace-nowrap mt-0.5">
                        Leída
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
