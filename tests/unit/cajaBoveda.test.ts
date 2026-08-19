import { describe, it, expect } from 'vitest'
import { calcularConversionUsd } from '@/lib/cajaBoveda'

// Plan: G5 Fase 5 (Bóveda ARS/USD) — F2 del relevamiento

// ─────────────────────────────────────────────────────────────────────────────
// calcularConversionUsd (BOV-CNV)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularConversionUsd', () => {
  it('BOV-CNV-01 usd_a_ars usa la cotización de COMPRA (el dueño vende dólares)', () => {
    const r = calcularConversionUsd('usd_a_ars', 100, 1300, 1250)
    expect(r).toEqual({ montoDestino: 125000, tasaUsada: 1250 })
  })
  it('BOV-CNV-02 ars_a_usd usa la cotización de VENTA (el dueño compra dólares)', () => {
    const r = calcularConversionUsd('ars_a_usd', 130000, 1300, 1250)
    expect(r).toEqual({ montoDestino: 100, tasaUsada: 1300 })
  })
  it('BOV-CNV-03 J1: sin redondeo — decimales exactos', () => {
    const r = calcularConversionUsd('usd_a_ars', 33.33, 1000, 999.99)
    expect(r.montoDestino).toBeCloseTo(33329.6667, 4)
  })
  it('BOV-CNV-04 usd_a_ars con cotización de compra faltante (0) → throw', () => {
    expect(() => calcularConversionUsd('usd_a_ars', 100, 1300, 0)).toThrow(/compra/i)
  })
  it('BOV-CNV-05 ars_a_usd con cotización de venta faltante (0) → throw', () => {
    expect(() => calcularConversionUsd('ars_a_usd', 100000, 0, 1250)).toThrow(/venta/i)
  })
  it('BOV-CNV-06 monto origen 0 → throw', () => {
    expect(() => calcularConversionUsd('usd_a_ars', 0, 1300, 1250)).toThrow(/monto/i)
  })
  it('BOV-CNV-07 monto origen negativo → throw', () => {
    expect(() => calcularConversionUsd('ars_a_usd', -50, 1300, 1250)).toThrow(/monto/i)
  })
})
