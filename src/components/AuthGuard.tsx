import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/lib/supabase'

// ─── AuthGuard ────────────────────────────────────────────────────────────────
interface AuthGuardProps {
  requireRole?: UserRole
}

export function AuthGuard({ requireRole }: AuthGuardProps) {
  const { user, loading } = useAuthStore()

  if (loading) return null

  if (!user) return <Navigate to="/login" replace />

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
  if (user?.rol === 'ADMIN') return <Outlet />

  const now = new Date()
  const trialEnd = new Date(tenant.trial_ends_at)

  const isActive =
    tenant.subscription_status === 'active' ||
    (tenant.subscription_status === 'trial' && now < trialEnd)

  if (!isActive) return <Navigate to="/suscripcion" replace />

  return <Outlet />
}
