import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/lib/supabase'

// ─── AuthGuard ────────────────────────────────────────────────────────────────
interface AuthGuardProps {
  requireRole?: UserRole
}

export function AuthGuard({ requireRole }: AuthGuardProps) {
  const { user, loading, needsOnboarding } = useAuthStore()

  if (loading) return null

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

  const now = new Date()
  const trialEnd = new Date(tenant.trial_ends_at)
  // MP-C9: al cancelar una sub PAGA, el acceso perdura hasta el fin del período ya pagado
  // (subscription_period_end, seteado por el EF cancel-suscripcion). Pagaron el período → les corresponde.
  const periodEnd = tenant.subscription_period_end ? new Date(tenant.subscription_period_end) : null

  const isActive =
    tenant.subscription_status === 'active' ||
    (tenant.subscription_status === 'trial' && now < trialEnd) ||
    (tenant.subscription_status === 'cancelled' && periodEnd !== null && now < periodEnd)

  if (!isActive) return <Navigate to="/suscripcion" replace />

  return <Outlet />
}
