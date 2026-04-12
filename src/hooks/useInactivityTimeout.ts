import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

/**
 * Detecta inactividad del usuario y cierra la sesión automáticamente.
 * timeoutMinutes: null/undefined = nunca expira.
 * Avisa con un toast 1 minuto antes si el timeout > 1 min.
 */
export function useInactivityTimeout(timeoutMinutes: number | null | undefined) {
  const { signOut } = useAuthStore()
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnToastRef = useRef<string | null>(null)

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return

    const ms = timeoutMinutes * 60 * 1000
    const warnMs = ms - 60 * 1000 // 1 min antes

    const clearTimers = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
      if (warnToastRef.current) toast.dismiss(warnToastRef.current)
    }

    const reset = () => {
      clearTimers()

      if (warnMs > 0) {
        warnTimerRef.current = setTimeout(() => {
          warnToastRef.current = toast('Tu sesión cerrará por inactividad en 1 minuto', {
            duration: 60000,
            icon: '⏳',
          })
        }, warnMs)
      }

      timerRef.current = setTimeout(async () => {
        clearTimers()
        await signOut()
        navigate('/login', { replace: true })
        toast.error('Sesión cerrada por inactividad')
      }, ms)
    }

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll', 'wheel']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      clearTimers()
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [timeoutMinutes, signOut, navigate])
}
