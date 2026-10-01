import { describe, it, expect } from 'vitest'
import { calcularConversionUsd } from '@/lib/cajaBoveda'

// Plan: G5 Fase 5 (Bóveda ARS/USD) — F2 del relevamiento. D-1 fase 2 (GO, 2026-09-25): la Bóveda
// usa la MISMA tasa que el resto del sistema en los dos sentidos (vendedor divisa BNA del día hábil
// anterior); ya no hay compra/venta separadas.

// ─────────────────────────────────────────────────────────────────────────────
// calcularConversionUsd (BOV-CNV)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularConversionUsd', () => {
  it('BOV-CNV-01 usd_a_ars multiplica por la tasa única', () => {
    const r = calcularConversionUsd('usd_a_ars', 100, 1525.5)
    expect(r).toEqual({ montoDestino: 152550, tasaUsada: 1525.5 })
  })
  it('BOV-CNV-02 ars_a_usd divide por la MISMA tasa', () => {
    const r = calcularConversionUsd('ars_a_usd', 152550, 1525.5)
    expect(r).toEqual({ montoDestino: 100, tasaUsada: 1525.5 })
  })
  it('BOV-CNV-03 J1: sin redondeo — decimales exactos', () => {
    const r = calcularConversionUsd('usd_a_ars', 33.33, 999.99)
    expect(r.montoDestino).toBeCloseTo(33329.6667, 4)
  })
  it('BOV-CNV-04 sin cotización (0) → throw, en los dos sentidos (D5: nunca se inventa)', () => {
    expect(() => calcularConversionUsd('usd_a_ars', 100, 0)).toThrow(/cotizaci/i)
    expect(() => calcularConversionUsd('ars_a_usd', 100000, 0)).toThrow(/cotizaci/i)
  })
  it('BOV-CNV-05 cotización NaN → throw', () => {
    expect(() => calcularConversionUsd('usd_a_ars', 100, NaN)).toThrow(/cotizaci/i)
  })
  it('BOV-CNV-06 monto origen 0 → throw', () => {
    expect(() => calcularConversionUsd('usd_a_ars', 0, 1300)).toThrow(/monto/i)
  })
  it('BOV-CNV-07 monto origen negativo → throw', () => {
    expect(() => calcularConversionUsd('ars_a_usd', -50, 1300)).toThrow(/monto/i)
  })
  it('BOV-CNV-08 ida y vuelta no crea ni pierde plata (una sola tasa, sin spread)', () => {
    const pesos = calcularConversionUsd('usd_a_ars', 250, 1525.5).montoDestino
    expect(calcularConversionUsd('ars_a_usd', pesos, 1525.5).montoDestino).toBeCloseTo(250, 10)
  })
})
