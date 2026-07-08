/**
 * facturacionManual.test.ts — sweep de vencimiento del pago manual (billing_mode='manual').
 * Espejo de la decisión de la EF billing-manual-sweep — mantener EN SYNC.
 */
import { describe, test, expect } from 'vitest'
import { decidirSweepManual, formatearVencimiento, GRACIA_DIAS, RECORDATORIO_DIAS_ANTES } from '@/lib/facturacionManual'

describe('decidirSweepManual', () => {
  const paidUntil = '2026-08-01T00:00:00Z'

  test('sin paid_until (recién pasado a manual, sin primer pago) → nada', () => {
    expect(decidirSweepManual({ paidUntil: null, ultimoTipo: null })).toBe('nada')
  })

  test('lejos del vencimiento → nada', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: null, now: new Date('2026-07-15T00:00:00Z'),
    })).toBe('nada')
  })

  test('5 días antes → recordatorio_5d (primera vez)', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: null, now: new Date('2026-07-27T00:00:00Z'),
    })).toBe('recordatorio_5d')
  })

  test('5 días antes pero YA se mandó ese recordatorio → nada (dedupe)', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_5d', now: new Date('2026-07-27T12:00:00Z'),
    })).toBe('nada')
  })

  test('1 día antes, ya se mandó el de 5d → recordatorio_1d (el segundo SÍ se manda)', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_5d', now: new Date('2026-07-31T00:00:00Z'),
    })).toBe('recordatorio_1d')
  })

  test('el día del vencimiento, con el de 1d ya mandado → nada (todavía en gracia, sin acción)', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_1d', now: new Date('2026-08-01T00:00:00Z'),
    })).toBe('nada')
  })

  test('dentro de los 5 días de gracia tras vencer → nada (todavía no suspende)', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_1d', now: new Date('2026-08-05T00:00:00Z'),
    })).toBe('nada')
  })

  test('justo en el borde de gracia (paid_until + 5 días exactos) → nada', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_1d', now: new Date('2026-08-06T00:00:00Z'),
    })).toBe('nada')
  })

  test('pasado el borde de gracia → suspender', () => {
    expect(decidirSweepManual({
      paidUntil, ultimoTipo: 'recordatorio_1d', now: new Date('2026-08-06T00:00:01Z'),
    })).toBe('suspender')
  })

  test('🛑 un pago nuevo limpia ultimoTipo (fn_registrar_pago_manual) → no reaparece el recordatorio viejo', () => {
    // Tras pagar, paid_until avanza 1 mes y ultimoTipo vuelve a null (mig 262) — el sweep
    // vuelve a evaluar desde cero contra la NUEVA fecha.
    expect(decidirSweepManual({
      paidUntil: '2026-09-01T00:00:00Z', ultimoTipo: null, now: new Date('2026-08-06T00:00:01Z'),
    })).toBe('nada')
  })

  test('constantes documentadas: recordatorios 5 y 1 días antes, gracia 5 días', () => {
    expect(RECORDATORIO_DIAS_ANTES).toEqual([5, 1])
    expect(GRACIA_DIAS).toBe(5)
  })
})

describe('formatearVencimiento', () => {
  test('formatea en es-AR', () => {
    expect(formatearVencimiento('2026-08-01T00:00:00Z')).toMatch(/2026/)
  })
})
