/**
 * mpPertenencia.test.ts — Fase 4 (regresión billing MP, REGLA #0)
 * Fija el contrato de pertenencia que gobierna si un cliente que pagó se activa.
 * Espejo del EF mp-verificar-suscripcion / admin-api billing.link_subscription.
 */
import { describe, test, expect } from 'vitest'
import { decidirPertenencia, type PreapprovalMin } from '@/lib/mpPertenencia'

const TIERS = { plan_basico_id: 'basico', plan_pro_id: 'pro' } as const
const base = {
  userEmail: 'due@o.com',
  planTiers: TIERS as Record<string, 'basico' | 'pro'>,
  reclamadaPorOtroTenant: false,
}
const authorized = (over: Partial<PreapprovalMin> = {}): PreapprovalMin => ({
  id: 'pre_1', status: 'authorized', preapproval_plan_id: 'plan_basico_id', payer_email: '', ...over,
})

describe('decidirPertenencia — activación', () => {
  test('authorized + plan nuestro + payer_email VACÍO + no reclamada → activa (crux v1.107/108)', () => {
    // El caso real: MP no manda payer_email en checkout por plan → se activa por claim exclusivo.
    expect(decidirPertenencia({ ...base, sub: authorized({ payer_email: '' }) }))
      .toEqual({ activar: true, tier: 'basico' })
  })

  test('payer_email presente y coincide → activa', () => {
    expect(decidirPertenencia({ ...base, sub: authorized({ payer_email: 'DUE@o.com' }) }))
      .toEqual({ activar: true, tier: 'basico' })
  })

  test('plan pro → tier pro', () => {
    expect(decidirPertenencia({ ...base, sub: authorized({ preapproval_plan_id: 'plan_pro_id' }) }))
      .toEqual({ activar: true, tier: 'pro' })
  })
})

describe('decidirPertenencia — rechazos', () => {
  test('sin sub (no encontrado en MP) → no_encontrado', () => {
    expect(decidirPertenencia({ ...base, sub: null })).toEqual({ activar: false, reason: 'no_encontrado' })
    expect(decidirPertenencia({ ...base, sub: {} })).toEqual({ activar: false, reason: 'no_encontrado' })
  })

  test('status != authorized (pending/paused/cancelled) → no_autorizado', () => {
    for (const status of ['pending', 'paused', 'cancelled']) {
      expect(decidirPertenencia({ ...base, sub: authorized({ status }) }))
        .toEqual({ activar: false, reason: 'no_autorizado' })
    }
  })

  test('plan que no es nuestro → plan_desconocido', () => {
    expect(decidirPertenencia({ ...base, sub: authorized({ preapproval_plan_id: 'plan_ajeno' }) }))
      .toEqual({ activar: false, reason: 'plan_desconocido' })
    expect(decidirPertenencia({ ...base, sub: authorized({ preapproval_plan_id: null }) }))
      .toEqual({ activar: false, reason: 'plan_desconocido' })
  })

  test('payer_email presente y NO coincide → owner_mismatch (nunca activa a otro)', () => {
    expect(decidirPertenencia({ ...base, sub: authorized({ payer_email: 'otro@mp.com' }) }))
      .toEqual({ activar: false, reason: 'owner_mismatch' })
  })

  test('reclamada por otro tenant → ya_reclamada (claim exclusivo, anti robo de sub)', () => {
    expect(decidirPertenencia({ ...base, reclamadaPorOtroTenant: true, sub: authorized() }))
      .toEqual({ activar: false, reason: 'ya_reclamada' })
  })

  test('orden REGLA #0: authorized se chequea antes que plan/email/claim', () => {
    // Un preapproval no autorizado con plan desconocido igual sale por no_autorizado.
    expect(decidirPertenencia({ ...base, sub: authorized({ status: 'pending', preapproval_plan_id: 'x' }) }))
      .toEqual({ activar: false, reason: 'no_autorizado' })
  })
})

describe('decidirPertenencia — variante admin (exigirPayerEmail=false)', () => {
  test('el link por soporte NO exige el email (activa aunque payer_email no matchee)', () => {
    // admin-api billing.link_subscription: el agente decide; igual protege authorized + plan + claim.
    expect(decidirPertenencia({ ...base, exigirPayerEmail: false, sub: authorized({ payer_email: 'otro@mp.com' }) }))
      .toEqual({ activar: true, tier: 'basico' })
  })

  test('pero el link por soporte SIGUE respetando el claim exclusivo', () => {
    expect(decidirPertenencia({ ...base, exigirPayerEmail: false, reclamadaPorOtroTenant: true, sub: authorized() }))
      .toEqual({ activar: false, reason: 'ya_reclamada' })
  })

  test('y sigue exigiendo authorized + plan nuestro', () => {
    expect(decidirPertenencia({ ...base, exigirPayerEmail: false, sub: authorized({ status: 'pending' }) }))
      .toEqual({ activar: false, reason: 'no_autorizado' })
    expect(decidirPertenencia({ ...base, exigirPayerEmail: false, sub: authorized({ preapproval_plan_id: 'ajeno' }) }))
      .toEqual({ activar: false, reason: 'plan_desconocido' })
  })
})
