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

// Incidente 2026-09-28 (mig 464): pago duplicado, ninguno vinculado, alertas sin negocio → descartadas como "prueba".
import { candidatosHuerfana, intentoPendienteReciente, esPosibleDuplicado } from '@/lib/mpReconciliacion'

describe('candidatosHuerfana — nombrar al negocio de una huérfana', () => {
  const PRO = 'plan-pro', BAS = 'plan-basico'
  const intentos = [
    { tenant_id: 'negocioA', mp_plan_id: PRO, created_at: '2026-09-28T20:08:50Z' },
    { tenant_id: 'negocioA', mp_plan_id: PRO, created_at: '2026-09-28T20:09:55Z' },
    { tenant_id: 'otro', mp_plan_id: BAS, created_at: '2026-09-28T20:05:00Z' },  // otro plan
    { tenant_id: 'viejo', mp_plan_id: PRO, created_at: '2026-09-28T10:00:00Z' }, // fuera de las 3 h
    { tenant_id: 'ya', mp_plan_id: PRO, created_at: '2026-09-28T20:00:00Z', vinculado_at: '2026-09-28T20:01:00Z' },
  ]

  test('mismo plan, dentro de las 3 h previas, sin vincular, sin repetir', () => {
    expect(candidatosHuerfana({ preapproval_plan_id: PRO, date_created: '2026-09-28T16:09:33.000-04:00' }, intentos)).toEqual(['negocioA'])
  })

  test('sin intentos que encajen → ninguno (la alerta dice "sin candidato")', () => {
    expect(candidatosHuerfana({ preapproval_plan_id: 'plan-enterprise', date_created: '2026-09-28T20:09:33Z' }, intentos)).toEqual([])
  })

  test('dos negocios en la ventana → los dos, el más cercano primero (ambiguo: lo decide soporte)', () => {
    const r = candidatosHuerfana({ preapproval_plan_id: PRO, date_created: '2026-09-28T20:10:00Z' },
      [...intentos, { tenant_id: 'otroPro', mp_plan_id: PRO, created_at: '2026-09-28T18:00:00Z' }])
    expect(r).toEqual(['negocioA', 'otroPro'])
  })
})

describe('intentoPendienteReciente — frenar el segundo pago', () => {
  const ahora = new Date('2026-09-28T20:10:13Z')
  test('🛑 un intento sin vincular de hace 1 minuto → avisa', () => {
    expect(intentoPendienteReciente([{ tenant_id: 't', mp_plan_id: 'p', created_at: '2026-09-28T20:09:10Z' }], ahora)).not.toBeNull()
  })
  test('vinculado o de hace más de 2 h → no avisa', () => {
    expect(intentoPendienteReciente([
      { tenant_id: 't', mp_plan_id: 'p', created_at: '2026-09-28T20:09:10Z', vinculado_at: '2026-09-28T20:09:40Z' },
      { tenant_id: 't', mp_plan_id: 'p', created_at: '2026-09-28T17:00:00Z' },
    ], ahora)).toBeNull()
  })
})

describe('esPosibleDuplicado', () => {
  test('🛑 el caso real: dos huérfanas del mismo negocio a 40 s → duplicado', () => {
    const otras = [
      { id: 'a', date_created: '2026-09-28T20:09:33Z', tenant_id: null, candidatos: ['negocioA'] },
      { id: 'b', date_created: '2026-09-28T20:10:13Z', tenant_id: null, candidatos: ['negocioA'] },
    ]
    expect(esPosibleDuplicado({ id: 'b', date_created: '2026-09-28T20:10:13Z' }, 'negocioA', otras)).toBe(true)
  })
  test('una sola suscripción del negocio → no es duplicado', () => {
    const otras = [{ id: 'a', date_created: '2026-09-28T20:09:33Z', tenant_id: null, candidatos: ['negocioA'] }]
    expect(esPosibleDuplicado({ id: 'a', date_created: '2026-09-28T20:09:33Z' }, 'negocioA', otras)).toBe(false)
  })
})
