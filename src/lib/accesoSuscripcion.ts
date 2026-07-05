/**
 * accesoSuscripcion.ts — Condición REAL de acceso del `SubscriptionGuard` (AuthGuard.tsx),
 * extraída para testearla (UAT MP-C9/C9c/C9d). NO es un espejo: el guard importa esta función
 * (lo testeado = lo que corre).
 *
 * Reglas (v1.110, MP-C9 grace period):
 *   • `active` → acceso.
 *   • `trial` → acceso mientras `now < trial_ends_at`.
 *   • `cancelled` → acceso mientras `now < subscription_period_end` (el cliente PAGÓ ese
 *     período — mig 255; lo setean los EFs de cancelación con el next_payment_date de MP).
 *     Sin `subscription_period_end` (cancelados pre-v1.110) → sin grace, corta al instante.
 *   • Cualquier otro estado → sin acceso (redirect a /suscripcion).
 */
export function tieneAccesoVigente(p: {
  subscriptionStatus: string | null | undefined
  trialEndsAt: string | null | undefined
  subscriptionPeriodEnd: string | null | undefined
  now: Date
}): boolean {
  const trialEnd = p.trialEndsAt ? new Date(p.trialEndsAt) : null
  const periodEnd = p.subscriptionPeriodEnd ? new Date(p.subscriptionPeriodEnd) : null

  return (
    p.subscriptionStatus === 'active' ||
    (p.subscriptionStatus === 'trial' && trialEnd !== null && p.now < trialEnd) ||
    (p.subscriptionStatus === 'cancelled' && periodEnd !== null && p.now < periodEnd)
  )
}
