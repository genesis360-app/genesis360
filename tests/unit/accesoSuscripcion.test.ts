/**
 * accesoSuscripcion.test.ts — UAT MP-C9/C9c/C9d (grace period al cancelar, v1.110/mig 255)
 * Testea la condición REAL del SubscriptionGuard (AuthGuard.tsx la importa): el acceso de un
 * tenant `cancelled` perdura hasta `subscription_period_end` (el cliente PAGÓ ese período).
 */
import { describe, test, expect } from 'vitest'
import { tieneAccesoVigente } from '@/lib/accesoSuscripcion'

const NOW = new Date('2026-07-04T12:00:00Z')
const AYER = '2026-07-03T12:00:00Z'
const MANANA = '2026-07-05T12:00:00Z'

const base = { trialEndsAt: null, subscriptionPeriodEnd: null, now: NOW }

describe('tieneAccesoVigente — SubscriptionGuard (MP-C9)', () => {
  test('active → acceso (sin mirar fechas)', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'active' })).toBe(true)
  })

  test('trial vigente → acceso; trial vencido → corta', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'trial', trialEndsAt: MANANA })).toBe(true)
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'trial', trialEndsAt: AYER })).toBe(false)
  })

  test('trial sin trial_ends_at → corta (no hay fecha que lo avale)', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'trial' })).toBe(false)
  })

  test('✅ MP-C9: cancelled con period_end FUTURO → acceso (pagó el período, le corresponde)', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'cancelled', subscriptionPeriodEnd: MANANA })).toBe(true)
  })

  test('MP-C9c: cancelled con period_end PASADO → corta (grace agotado)', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'cancelled', subscriptionPeriodEnd: AYER })).toBe(false)
  })

  test('MP-C9c borde exacto: now === period_end → corta (condición < estricta)', () => {
    expect(tieneAccesoVigente({
      ...base, subscriptionStatus: 'cancelled', subscriptionPeriodEnd: NOW.toISOString(),
    })).toBe(false)
  })

  test('MP-C9d: cancelled SIN period_end (pre-v1.110) → corta al instante (sin grace)', () => {
    expect(tieneAccesoVigente({ ...base, subscriptionStatus: 'cancelled' })).toBe(false)
  })

  test('cualquier otro estado (free/inactive/null) → sin acceso', () => {
    for (const s of ['free', 'inactive', 'paused', null, undefined, '']) {
      expect(tieneAccesoVigente({ ...base, subscriptionStatus: s as any })).toBe(false)
    }
  })

  test('el grace NO aplica a estados que no sean cancelled (un trial vencido no revive por period_end)', () => {
    expect(tieneAccesoVigente({
      ...base, subscriptionStatus: 'trial', trialEndsAt: AYER, subscriptionPeriodEnd: MANANA,
    })).toBe(false)
  })
})
