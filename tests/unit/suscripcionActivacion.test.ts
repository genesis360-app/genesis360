/**
 * suscripcionActivacion.test.ts — Fase 4 (regresión billing MP, v1.108.0)
 * Fija el contrato REGLA #0 de cómo la respuesta del EF mp-verificar-suscripcion se
 * traduce al estado de UI del retorno del checkout. Un cliente que paga DEBE activarse;
 * un error terminal NO debe quedar en loop de reintentos ni mentir "activado".
 */
import { describe, test, expect } from 'vitest'
import { clasificarVerificacion, mensajeErrorVerif } from '@/lib/suscripcionActivacion'

describe('clasificarVerificacion', () => {
  test('200 { activated:true } → ok (activar + redirigir)', () => {
    expect(clasificarVerificacion({ activated: true }, false)).toEqual({ estado: 'ok' })
  })

  test('activated:true ignora cualquier reason espurio', () => {
    expect(clasificarVerificacion({ activated: true, reason: 'x' }, false)).toEqual({ estado: 'ok' })
  })

  test('200 { activated:false, no_encontrado } → pendiente (reintentar; el webhook puede activar)', () => {
    expect(clasificarVerificacion({ activated: false, reason: 'no_encontrado' }, false))
      .toEqual({ estado: 'pendiente', reason: 'no_encontrado' })
  })

  test('200 { activated:false, no_autorizado } → pendiente', () => {
    expect(clasificarVerificacion({ activated: false, reason: 'no_autorizado' }, false))
      .toEqual({ estado: 'pendiente', reason: 'no_autorizado' })
  })

  test('sin data ni error (aún procesando) → pendiente, no error', () => {
    expect(clasificarVerificacion(null, false)).toEqual({ estado: 'pendiente', reason: undefined })
  })

  test('4xx/5xx con reason (owner_mismatch) → error terminal con el reason', () => {
    expect(clasificarVerificacion(null, true, 'owner_mismatch'))
      .toEqual({ estado: 'error', reason: 'owner_mismatch' })
    expect(clasificarVerificacion(null, true, 'ya_reclamada'))
      .toEqual({ estado: 'error', reason: 'ya_reclamada' })
  })

  test('4xx/5xx sin reason legible → error sin reason (mensaje genérico)', () => {
    expect(clasificarVerificacion(null, true)).toEqual({ estado: 'error', reason: undefined })
  })

  test('REGLA #0: un error HTTP es TERMINAL aunque venga data (nunca se toma como ok)', () => {
    // Contrato defensivo: si invoke marcó error, no se activa por un body ambiguo.
    expect(clasificarVerificacion({ activated: true }, true, 'ya_reclamada'))
      .toEqual({ estado: 'error', reason: 'ya_reclamada' })
  })
})

describe('mensajeErrorVerif', () => {
  test('owner_mismatch: menciona otra cuenta de MP', () => {
    expect(mensajeErrorVerif('owner_mismatch')).toMatch(/otra cuenta/i)
  })

  test('ya_reclamada: menciona otro negocio', () => {
    expect(mensajeErrorVerif('ya_reclamada')).toMatch(/otro negocio/i)
  })

  test('plan_desconocido: menciona el plan', () => {
    expect(mensajeErrorVerif('plan_desconocido')).toMatch(/plan/i)
  })

  test('reason desconocido / null / undefined → mensaje genérico "no vuelvas a pagar"', () => {
    for (const r of ['algo_raro', null, undefined]) {
      expect(mensajeErrorVerif(r as any)).toMatch(/no vuelvas a pagar/i)
    }
  })
})
