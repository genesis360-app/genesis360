/**
 * arrepentimiento.test.ts — UAT del botón de arrepentimiento (Ley 24.240 / click-to-cancel).
 * Fija el contrato de: ventana de 10 días corridos desde la PRIMERA compra, y refund
 * total IDEMPOTENTE (los ya reembolsados se saltean — nunca se devuelve dos veces).
 * Espejo del EF cancel-suscripcion (acciones preview/arrepentimiento) — mantener EN SYNC.
 */
import { describe, test, expect } from 'vitest'
import {
  ARREPENTIMIENTO_DIAS, elegibleArrepentimiento, necesitaRefund, planDeRefunds,
} from '@/lib/arrepentimiento'

describe('elegibleArrepentimiento — 10 días corridos desde la primera compra', () => {
  const compra = '2026-07-01T12:00:00Z'

  test('día 3 → elegible, con la fecha límite exacta (compra + 10 días)', () => {
    const r = elegibleArrepentimiento(compra, new Date('2026-07-04T12:00:00Z'))
    expect(r.elegible).toBe(true)
    expect(r.hasta?.toISOString()).toBe('2026-07-11T12:00:00.000Z')
  })

  test('borde: exactamente a los 10 días → todavía elegible; un segundo después → no', () => {
    expect(elegibleArrepentimiento(compra, new Date('2026-07-11T12:00:00Z')).elegible).toBe(true)
    expect(elegibleArrepentimiento(compra, new Date('2026-07-11T12:00:01Z')).elegible).toBe(false)
  })

  test('sin primera compra (trial/free, nunca pagó) → NO elegible (nada que reembolsar)', () => {
    expect(elegibleArrepentimiento(null)).toEqual({ elegible: false, hasta: null })
    expect(elegibleArrepentimiento(undefined)).toEqual({ elegible: false, hasta: null })
  })

  test('fecha corrupta → NO elegible (fail-closed: no se reembolsa con datos rotos)', () => {
    expect(elegibleArrepentimiento('no-es-fecha').elegible).toBe(false)
  })

  test('la ventana NO se resetea: renovación/upgrade posterior no re-abre el arrepentimiento', () => {
    // primera_compra_at solo se setea si estaba NULL (trigger mig 260) → a los 40 días
    // de la PRIMERA compra ya no hay arrepentimiento aunque ayer haya pagado un upgrade.
    expect(elegibleArrepentimiento(compra, new Date('2026-08-10T12:00:00Z')).elegible).toBe(false)
  })

  test('la constante legal es 10 días', () => {
    expect(ARREPENTIMIENTO_DIAS).toBe(10)
  })
})

describe('planDeRefunds — refund total idempotente (REGLA #0: nunca devolver dos veces)', () => {
  test('pago aprobado sin refund previo → se reembolsa completo', () => {
    expect(necesitaRefund({ id: '1', status: 'approved', transaction_amount: 54000 })).toBe(true)
  })

  test('pago ya reembolsado (status refunded o monto devuelto completo) → se saltea', () => {
    expect(necesitaRefund({ id: '1', status: 'refunded', transaction_amount: 54000 })).toBe(false)
    expect(necesitaRefund({
      id: '1', status: 'approved', transaction_amount: 54000, transaction_amount_refunded: 54000,
    })).toBe(false)
  })

  test('pago no aprobado (rejected/pending) → no hay nada que devolver', () => {
    expect(necesitaRefund({ id: '1', status: 'rejected', transaction_amount: 54000 })).toBe(false)
    expect(necesitaRefund({ id: '1', status: 'pending', transaction_amount: 54000 })).toBe(false)
  })

  test('mix real: cuota de sub + delta de batch ya devuelto + temporal → devuelve solo lo pendiente', () => {
    const r = planDeRefunds([
      { id: 'sub-1', status: 'approved', transaction_amount: 54000 },
      { id: 'batch-1', status: 'approved', transaction_amount: 5000, transaction_amount_refunded: 5000 },
      { id: 'temp-1', status: 'approved', transaction_amount: 10000 },
    ])
    expect(r.ids).toEqual(['sub-1', 'temp-1'])
    expect(r.total).toBe(64000)
  })

  test('refund parcial previo → se devuelve el remanente', () => {
    const r = planDeRefunds([
      { id: 'p1', status: 'approved', transaction_amount: 54000, transaction_amount_refunded: 4000 },
    ])
    expect(r.ids).toEqual(['p1'])
    expect(r.total).toBe(50000)
  })
})
