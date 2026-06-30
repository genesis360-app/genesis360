import { describe, it, expect } from 'vitest'
import { validarRetiroSaldoFavor, montoSugeridoCredito } from '../../src/lib/saldoFavor'

describe('validarRetiroSaldoFavor (cash-out de saldo a favor, espejo RPC mig 246)', () => {
  it('OK cuando hay saldo y efectivo suficientes', () => {
    expect(validarRetiroSaldoFavor(5000, 19080, 2000)).toEqual({ ok: true })
  })

  it('OK al borde (monto = saldo = efectivo)', () => {
    expect(validarRetiroSaldoFavor(2000, 2000, 2000)).toEqual({ ok: true })
  })

  it('bloquea monto <= 0', () => {
    expect(validarRetiroSaldoFavor(5000, 5000, 0).ok).toBe(false)
    expect(validarRetiroSaldoFavor(5000, 5000, -10).ok).toBe(false)
  })

  it('bloquea si supera el saldo a favor', () => {
    const r = validarRetiroSaldoFavor(2300, 99999, 9999999)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/saldo a favor/i)
  })

  it('bloquea si no hay efectivo en la caja (no caja negativa)', () => {
    const r = validarRetiroSaldoFavor(25000, 17080, 18000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/efectivo/i)
  })

  it('tolera redondeos de numeric (0.005)', () => {
    expect(validarRetiroSaldoFavor(2000, 2000, 2000.004)).toEqual({ ok: true })
  })
})

describe('montoSugeridoCredito (auto-sugerencia de crédito a favor en el POS)', () => {
  it('gasta MENOS que el crédito → sugiere el total (resto queda a favor)', () => {
    // crédito $5000, total $1200 → aplica $1200, quedan $3800 a favor
    expect(montoSugeridoCredito(5000, 1200)).toBe(1200)
  })

  it('gasta MÁS que el crédito → sugiere el crédito completo (faltante por otro medio)', () => {
    // crédito $1000, total $5000 → aplica $1000, faltan $4000
    expect(montoSugeridoCredito(1000, 5000)).toBe(1000)
  })

  it('crédito = total → cubre todo', () => {
    expect(montoSugeridoCredito(3000, 3000)).toBe(3000)
  })

  it('nunca supera el saldo disponible (respeta el guard server-aware)', () => {
    expect(montoSugeridoCredito(800, 9999)).toBe(800)
  })

  it('sin saldo o sin total → 0', () => {
    expect(montoSugeridoCredito(0, 5000)).toBe(0)
    expect(montoSugeridoCredito(5000, 0)).toBe(0)
  })

  it('nunca negativo y redondea a 2 decimales (numeric de PG)', () => {
    expect(montoSugeridoCredito(-100, 5000)).toBe(0)
    expect(montoSugeridoCredito(1200.005, 9999)).toBe(1200.01)
  })
})
