/**
 * mpReconciliacion.test.ts — UAT MP-W6 + DRIFT 1-2 (sweep de reconciliación billing MP)
 * Fija el contrato de clasificación del EF mp-reconciliacion. El caso semilla es el bug
 * real de Fede (2026-07-04): pago aprobado + webhook sin poder linkear → huérfana silenciosa.
 * Espejo: src/lib/mpReconciliacion.ts — si cambia el EF, actualizar espejo + estos tests.
 */
import { describe, test, expect } from 'vitest'
import { clasificarPreapproval } from '@/lib/mpReconciliacion'

describe('clasificarPreapproval — sweep anti-MP-W6', () => {
  test('🛑 caso Fede: authorized + plan nuestro + sin tenant linkeado → huerfana', () => {
    expect(clasificarPreapproval({ esPlanNuestro: true, status: 'authorized', linkedTenantStatus: null }))
      .toBe('huerfana')
  })

  test('authorized + tenant active → ok (consistente, no alertar)', () => {
    expect(clasificarPreapproval({ esPlanNuestro: true, status: 'authorized', linkedTenantStatus: 'active' }))
      .toBe('ok')
  })

  test('🛑 authorized + tenant NO active (cancelled/trial/inactive) → drift_mp_cobra', () => {
    for (const s of ['cancelled', 'trial', 'inactive', 'free']) {
      expect(clasificarPreapproval({ esPlanNuestro: true, status: 'authorized', linkedTenantStatus: s }))
        .toBe('drift_mp_cobra')
    }
  })

  test('🛑 preapproval muerto + tenant active → drift_acceso_gratis (zombie access)', () => {
    for (const st of ['cancelled', 'finished', 'expired']) {
      expect(clasificarPreapproval({ esPlanNuestro: true, status: st, linkedTenantStatus: 'active' }))
        .toBe('drift_acceso_gratis')
    }
  })

  test('preapproval muerto + tenant cancelled (grace period) → ignorar (consistente)', () => {
    // El caso normal post-cancelación: MP cancelled + DB cancelled (con grace). NO es drift.
    expect(clasificarPreapproval({ esPlanNuestro: true, status: 'cancelled', linkedTenantStatus: 'cancelled' }))
      .toBe('ignorar')
  })

  test('preapproval muerto sin tenant linkeado → ignorar (histórico, ej. sub vieja tras cambio de plan)', () => {
    expect(clasificarPreapproval({ esPlanNuestro: true, status: 'cancelled', linkedTenantStatus: null }))
      .toBe('ignorar')
  })

  test('pending/paused → ignorar (sin cobro confirmado; lo maneja el webhook)', () => {
    for (const st of ['pending', 'paused']) {
      expect(clasificarPreapproval({ esPlanNuestro: true, status: st, linkedTenantStatus: null })).toBe('ignorar')
      expect(clasificarPreapproval({ esPlanNuestro: true, status: st, linkedTenantStatus: 'active' })).toBe('ignorar')
    }
  })

  test('plan ajeno → ignorar SIEMPRE (aunque esté authorized y huérfano)', () => {
    expect(clasificarPreapproval({ esPlanNuestro: false, status: 'authorized', linkedTenantStatus: null }))
      .toBe('ignorar')
  })
})
