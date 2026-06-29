import { describe, it, expect } from 'vitest'
import { validarRetiroSaldoFavor } from '../../src/lib/saldoFavor'

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
