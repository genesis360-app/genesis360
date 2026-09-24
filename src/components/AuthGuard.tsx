import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/lib/supabase'
import { tieneAccesoVigente } from '@/lib/accesoSuscripcion'
import { Lock } from 'lucide-react'

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
