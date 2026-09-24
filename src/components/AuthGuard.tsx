import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/supabase'
import { tieneAccesoVigente } from '@/lib/accesoSuscripcion'
import { BTN } from '@/config/brand'
import { Lock, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── AuthGuard ────────────────────────────────────────────────────────────────
interface AuthGuardProps {
  requireRole?: UserRole
}

export function AuthGuard({ requireRole }: AuthGuardProps) {
  const { user, loading, needsOnboarding, accesoRevocado } = useAuthStore()

  if (loading) return null

  // Mig 433: tiene sesión válida pero lo dieron de baja. Va ANTES del redirect a onboarding, que si
  // no lo mandaría a crear un negocio nuevo con su misma identidad.
  if (accesoRevocado) return <AccesoRevocado />

  if (!user) return <Navigate to={needsOnboarding ? '/onboarding' : '/login'} replace />

  // Mig 434: la contraseña que puso el dueño es de un solo uso. Hasta que la cambie no entra a
  // ningún lado — va acá y no en una ruta propia para que no se pueda saltear por URL.
  if (user.debe_cambiar_password) return <CambiarPasswordInicial />

  if (requireRole && user.rol !== requireRole) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

// ─── SubscriptionGuard ────────────────────────────────────────────────────────
export function SubscriptionGuard() {
  const { tenant, user } = useAuthStore()

  if (!tenant) return <Navigate to="/login" replace />

  // ADMIN siempre pasa
  if (user?.rol === 'SUPER_USUARIO') return <Outlet />

  // MP-C9: al cancelar una sub PAGA, el acceso perdura hasta el fin del período ya pagado
  // (subscription_period_end, seteado por el EF cancel-suscripcion). Pagaron el período → les
  // corresponde. La condición vive en accesoSuscripcion.ts para poder testearla (UAT MP-C9).
  const isActive = tieneAccesoVigente({
    subscriptionStatus: tenant.subscription_status,
    trialEndsAt: tenant.trial_ends_at,
    subscriptionPeriodEnd: tenant.subscription_period_end,
    now: new Date(),
  })

  if (!isActive) return <Navigate to="/suscripcion" replace />

  return <Outlet />
}


// ─── AccesoRevocado ───────────────────────────────────────────────────────────
// El usuario fue dado de baja (mig 433). Tiene sesión de Supabase válida —darlo de baja no cierra
// sesiones abiertas— pero el servidor ya no le devuelve ningún dato. Se le dice claramente qué pasó
// en vez de dejarlo mirando una pantalla vacía o mandarlo a crear un negocio.
function AccesoRevocado() {
  const { signOut } = useAuthStore()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-5">
          <Lock size={26} className="text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">Tu acceso fue dado de baja</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Tu usuario ya no está habilitado en este negocio. Si creés que es un error, pedile al dueño
          que te reactive desde Usuarios.
        </p>
        <button
          onClick={() => signOut()}
          className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:opacity-90 transition">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

// ─── CambiarPasswordInicial ───────────────────────────────────────────────────
// Mig 434: el empleado sin correo entró con la contraseña que le puso el dueño, y esa es de un solo
// uso. Después de este paso la sabe únicamente él — que es lo que hace que el log de actividad sea
// indiscutiblemente suyo.
//
// 🛑 El cambio y la baja de la bandera los hace la Edge Function en UNA sola llamada, con
// service_role. Si fueran dos pasos (updateUser acá + un RPC que baja la bandera), alcanzaba con
// llamar al segundo desde la consola y quedarse con la contraseña que el dueño ya conoce. Por eso
// `users` tampoco tiene policy de UPDATE para uno mismo.
function CambiarPasswordInicial() {
  const { user, signOut, loadUserData } = useAuthStore()
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [guardando, setGuardando] = useState(false)

  const MIN = 8
  const problema =
    nueva.length > 0 && nueva.length < MIN ? `Tiene que tener al menos ${MIN} caracteres`
    : repetir.length > 0 && nueva !== repetir ? 'Las dos contraseñas no coinciden'
    : null
  const puedeGuardar = nueva.length >= MIN && nueva === repetir && !guardando

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      // La dirección se lee ANTES del cambio, mientras la sesión todavía vale (ver abajo).
      const { data: authData } = await supabase.auth.getUser()
      const email = authData?.user?.email

      const { data, error } = await supabase.functions.invoke('usuarios-sin-correo', {
        body: { accion: 'cambiar-password-propia', password: nueva },
      })
      if (error || data?.error) throw new Error(data?.error ?? error!.message)

      // 🛑 Cambiar la contraseña con la Admin API revoca TODAS las sesiones del usuario — incluida
      // la que está usando en este momento. Sin volver a entrar acá, la app lo escupe al login justo
      // después de elegir su contraseña, sin una palabra de explicación. Encontrado en el spec 159.
      // La contraseña nueva la tenemos en la mano, así que el reingreso es invisible para él.
      if (email) {
        const { error: reErr } = await supabase.auth.signInWithPassword({ email, password: nueva })
        if (reErr) {
          // Pasó lo importante igual: la contraseña ya es la nueva. Que entre de nuevo a mano.
          toast.success('Listo. Entrá de nuevo con tu contraseña nueva.')
          await signOut()
          return
        }
      }

      toast.success('Listo, tu contraseña quedó cambiada')
      // Recargar el perfil para que baje la bandera y el guard deje pasar.
      if (user) await loadUserData(user.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
      <form onSubmit={guardar}
        className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-8">
        <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-5">
          <KeyRound size={26} className="text-accent-text" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2 text-center">
          Elegí tu contraseña
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
          La que usaste para entrar te la dio el dueño del negocio y es de un solo uso. Elegí una que
          sepas solo vos.
        </p>

        <label htmlFor="pass-nueva" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña nueva</label>
        <input id="pass-nueva" type="password" autoFocus autoComplete="new-password" value={nueva}
          onChange={e => setNueva(e.target.value)}
          className="w-full px-3 py-2.5 mb-3 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />

        <label htmlFor="pass-repetir" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Repetila</label>
        <input id="pass-repetir" type="password" autoComplete="new-password" value={repetir}
          onChange={e => setRepetir(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-accent-text" />

        {problema && <p className="text-xs text-red-500 mt-2">{problema}</p>}

        <button type="submit" disabled={!puedeGuardar} className={`w-full mt-5 ${BTN.primary} ${BTN.md}`}>
          {guardando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        <button type="button" onClick={() => signOut()}
          className="w-full mt-2 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">
          Cerrar sesión
        </button>
      </form>
    </div>
  )
}
