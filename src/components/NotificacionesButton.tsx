import { Bell, X, ArrowRight } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

interface NotificacionesButtonProps {
  className?: string
}

export function NotificacionesButton({ className = '' }: NotificacionesButtonProps) {
  const { user } = useAuthStore()
  const [open, setOpen] = useState(false)
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
            <div className="divide-y divide-border-ds max-h-80 overflow-y-auto">
              {(notifs as any[]).map(n => (
                <div key={n.id}
                  className={`px-4 py-3 flex items-start gap-3 transition-colors ${n.leida ? 'opacity-60' : 'bg-accent/5'}`}
                >
                  {!n.leida && <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 mt-1.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary dark:text-white leading-snug">{n.titulo}</p>
                    <p className="text-xs text-muted mt-0.5 leading-snug">{n.mensaje}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatFecha(n.created_at)}</p>
                  </div>
                  {n.action_url && (
                    <button
                      onClick={() => { markRead(n.id); navigate(n.action_url); setOpen(false) }}
                      className="flex-shrink-0 text-accent hover:text-accent/80 text-xs flex items-center gap-1 font-medium whitespace-nowrap mt-0.5"
                    >
                      Ir <ArrowRight size={12} />
                    </button>
                  )}
                  {!n.action_url && !n.leida && (
                    <button onClick={() => markRead(n.id)}
                      className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 whitespace-nowrap mt-0.5">
                      Leída
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
