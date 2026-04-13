import { Bell, X, ArrowRight } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface Notificacion {
  id: number | string
  text: string
  action: string
  leida?: boolean
}

// Datos simulados — se reemplazarán por query real cuando se implemente el backend de notificaciones
const MOCK_NOTIFICACIONES: Notificacion[] = [
  { id: 1, text: 'Vendiste 15% más que ayer', action: '/dashboard?tab=general' },
  { id: 2, text: '4 productos sin movimiento hace 43 días', action: '/alertas' },
]

interface NotificacionesButtonProps {
  className?: string
}

export function NotificacionesButton({ className = '' }: NotificacionesButtonProps) {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notificacion[]>(MOCK_NOTIFICACIONES)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const unread = notifs.filter(n => !n.leida).length

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = (id: number | string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, leida: true } : n))
  }

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, leida: true })))

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
          {/* Header */}
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

          {/* Lista */}
          {notifs.length === 0 ? (
            <p className="text-sm text-muted px-4 py-6 text-center">Sin notificaciones</p>
          ) : (
            <div className="divide-y divide-border-ds max-h-80 overflow-y-auto">
              {notifs.map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                    n.leida ? 'opacity-60' : 'bg-accent/5'
                  }`}
                >
                  {!n.leida && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                  )}
                  <p className="flex-1 text-sm text-primary dark:text-white leading-snug">{n.text}</p>
                  <button
                    onClick={() => { markRead(n.id); navigate(n.action); setOpen(false) }}
                    className="flex-shrink-0 text-accent hover:text-accent/80 text-xs flex items-center gap-1 font-medium whitespace-nowrap"
                  >
                    Ir <ArrowRight size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
