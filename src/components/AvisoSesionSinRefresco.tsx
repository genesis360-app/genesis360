import { useEffect, useState } from 'react'
import { AlertTriangle, LogIn, RefreshCw, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase, cortacircuitosRefresco } from '@/lib/supabase'
import { EVENTO_ESTADO_REFRESCO, type DetalleEstado } from '@/lib/authRefreshBreaker'

/**
 * D1 — cara visible del cortacircuitos del refresco de sesión (`authRefreshBreaker.ts`).
 *
 * Cuando el backend no renueva el token, la app deja de poder consultar datos: seguir mostrando
 * todo como si nada sería mentirle al usuario. Pero tampoco lo deslogueamos solos: un cajero en
 * medio de una venta no puede quedar afuera por un blip de 30 s. Así que avisamos y le damos las
 * dos salidas — reintentar (si el backend volvió, sigue trabajando sin perder nada) o volver a
 * entrar limpio.
 *
 * No bloquea la pantalla a propósito: aunque la app esté degradada, el usuario tiene que poder
 * leer/copiar lo que tiene delante.
 */
export function AvisoSesionSinRefresco() {
  const [detalle, setDetalle] = useState<DetalleEstado | null>(null)
  const [reintentando, setReintentando] = useState(false)
  const [falloElReintento, setFalloElReintento] = useState(false)

  useEffect(() => {
    const onEstado = (e: Event) => setDetalle((e as CustomEvent<DetalleEstado>).detail)
    window.addEventListener(EVENTO_ESTADO_REFRESCO, onEstado)
    return () => window.removeEventListener(EVENTO_ESTADO_REFRESCO, onEstado)
  }, [])

  const reintentar = async () => {
    setReintentando(true)
    cortacircuitosRefresco.reiniciar()
    try {
      const { error } = await supabase.auth.refreshSession()
      if (error) throw error
      setFalloElReintento(false)
      toast.success('Sesión renovada')
    } catch {
      setFalloElReintento(true)
      toast.error('El servidor sigue sin responder')
    } finally {
      setReintentando(false)
    }
  }

  const volverAEntrar = async () => {
    // scope 'local': limpia la sesión guardada SIN salir a la red. Si el backend está caído,
    // un signOut normal se colgaría o fallaría justo cuando más necesitamos salir limpio.
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* la sesión local igual se va */ }
    localStorage.removeItem('sucursal-id')
    window.location.href = '/login'
  }

  const grave = detalle?.estado === 'rendido' || falloElReintento
  const leve = !grave && detalle?.estado === 'degradado' && detalle.fallos >= 2

  if (grave) {
    return (
      <div className="fixed bottom-4 right-4 z-[9998] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-red-300 dark:border-red-800 bg-white dark:bg-gray-900 shadow-xl p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" size={18} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              No se pudo renovar la sesión
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              El servidor no está respondiendo{detalle?.ultimoStatus ? ` (error ${detalle.ultimoStatus})` : ''}.
              Dejamos de reintentar para no empeorarlo. Los datos que veas pueden estar desactualizados.
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={reintentar} disabled={reintentando}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50">
            <RefreshCw size={13} className={reintentando ? 'animate-spin' : ''} />
            {reintentando ? 'Reintentando…' : 'Reintentar'}
          </button>
          <button type="button" onClick={volverAEntrar}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            <LogIn size={13} /> Volver a entrar
          </button>
        </div>
      </div>
    )
  }

  if (leve) {
    return (
      <div className="fixed bottom-4 right-4 z-[9998] flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 shadow-lg">
        <WifiOff className="text-amber-700 dark:text-amber-400 shrink-0" size={14} />
        <span className="text-xs text-amber-800 dark:text-amber-300">
          Problemas de conexión con el servidor — reintentando…
        </span>
      </div>
    )
  }

  return null
}
