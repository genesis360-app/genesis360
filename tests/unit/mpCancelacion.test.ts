/**
 * mpCancelacion.test.ts — Fase 4 (regresión billing MP, REGLA #0)
 * Fija el contrato FAIL-CLOSED de cancelación: nunca marcar la cuenta cancelada si el
 * preapproval guardado no se confirmó fuera de cobro. Espeja cancelarSubMP (cancel-suscripcion
 * / admin-api). El bug original era fail-OPEN (marcaba cancelado y MP seguía cobrando).
 */
import { describe, test, expect } from 'vitest'
import { evaluarCancelacion } from '@/lib/mpCancelacion'

const STORED = 'sub_stored'

describe('evaluarCancelacion — fail-closed (REGLA #0)', () => {
  test('sub guardada viva + PUT cancel OK → cancelada, sin errores, PUEDE marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'authorized', esDelTenant: true, putOk: true },
    ])
    expect(r).toEqual({ mp_cancelled: 1, errores: [], puedeMarcarCancelado: true })
  })

  test('🛑 sub guardada viva + PUT cancel FALLA → error + no_confirmado, NO puede marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'authorized', esDelTenant: true, putOk: false, putStatus: 500 },
    ])
    expect(r.mp_cancelled).toBe(0)
    expect(r.errores).toContain(`${STORED}:500`)
    expect(r.errores).toContain('no_confirmado')
    expect(r.puedeMarcarCancelado).toBe(false) // el cliente seguiría cobrado → jamás marcar cancelado
  })

  test('🛑 GET de la sub guardada FALLA → no se puede confirmar → NO puede marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: false, getStatus: 404 },
    ])
    expect(r.errores).toContain(`${STORED}:get_404`)
    expect(r.errores).toContain('no_confirmado')
    expect(r.puedeMarcarCancelado).toBe(false)
  })

  test('sub guardada YA cancelada → confirmada, sin errores, puede marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'cancelled', esDelTenant: true },
    ])
    expect(r).toEqual({ mp_cancelled: 1, errores: [], puedeMarcarCancelado: true })
  })

  test('sub guardada no-viva (finalizada) → confirmada (no cobra), sin contar, puede marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'finished', esDelTenant: true },
    ])
    expect(r).toEqual({ mp_cancelled: 0, errores: [], puedeMarcarCancelado: true })
  })

  test('sin sub guardada (NULL) y sin candidatos → puede marcar (nada que confirmar)', () => {
    expect(evaluarCancelacion(null, [])).toEqual({ mp_cancelled: 0, errores: [], puedeMarcarCancelado: true })
  })

  test('sin sub guardada + otra sub del tenant viva cancelada OK → cuenta, puede marcar', () => {
    const r = evaluarCancelacion(null, [
      { id: 'otra', getOk: true, status: 'authorized', esDelTenant: true, putOk: true },
    ])
    expect(r).toEqual({ mp_cancelled: 1, errores: [], puedeMarcarCancelado: true })
  })

  test('candidato que NO es del tenant se ignora (no toca su preapproval)', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'cancelled', esDelTenant: true },
      { id: 'ajena', getOk: true, status: 'authorized', esDelTenant: false, putOk: true },
    ])
    // solo cuenta la del tenant; la ajena ni se toca
    expect(r).toEqual({ mp_cancelled: 1, errores: [], puedeMarcarCancelado: true })
  })

  test('varias del tenant: guardada OK + extra viva cancelada OK → 2 canceladas, puede marcar', () => {
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'authorized', esDelTenant: true, putOk: true },
      { id: 'extra', getOk: true, status: 'authorized', esDelTenant: true, putOk: true },
    ])
    expect(r).toEqual({ mp_cancelled: 2, errores: [], puedeMarcarCancelado: true })
  })

  test('🛑 guardada OK pero una EXTRA viva del tenant no se pudo cancelar → NO puede marcar', () => {
    // Aunque la guardada quedó confirmada, si otra sub viva del tenant no se canceló hay error
    // → fail-closed (podría seguir cobrando por esa otra).
    const r = evaluarCancelacion(STORED, [
      { id: STORED, getOk: true, status: 'cancelled', esDelTenant: true },
      { id: 'extra', getOk: true, status: 'authorized', esDelTenant: true, putOk: false, putStatus: 502 },
    ])
    expect(r.errores).toContain('extra:502')
    expect(r.puedeMarcarCancelado).toBe(false)
  })
})
