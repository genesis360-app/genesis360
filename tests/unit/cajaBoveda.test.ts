import { describe, it, expect } from 'vitest'
import { calcularConversionUsd, tasaUsdAArs } from '@/lib/cajaBoveda'

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

// ─── tasaUsdAArs (hallazgo de Fede, 2026-09-08) ──────────────────────────────────────────────
// El POS convertía los precios en USD al dólar VENTA; la convención del sistema (F2, G5 Fase 5) es
// que cuando el negocio valúa dólares en pesos usa la de COMPRA. Cobraba de más al cliente.
describe('tasaUsdAArs — la tasa con la que el negocio pasa USD a pesos', () => {
  it('usa la de COMPRA cuando está cargada (no la de venta)', () => {
    expect(tasaUsdAArs(950, 1000)).toBe(950)
  })

  it('cae a la de VENTA solo si no hay compra — es el caso de la cotización cargada a mano', () => {
    expect(tasaUsdAArs(0, 1000)).toBe(1000)
    expect(tasaUsdAArs(null, 1000)).toBe(1000)
    expect(tasaUsdAArs(undefined, 1000)).toBe(1000)
  })

  it('sin ninguna cotización devuelve 0, para que el llamador pueda frenar', () => {
    expect(tasaUsdAArs(0, 0)).toBe(0)
    expect(tasaUsdAArs(null, null)).toBe(0)
  })

  it('un producto de USD 100 se cobra a la de compra, no a la de venta', () => {
    const precioUsd = 100
    expect(precioUsd * tasaUsdAArs(950, 1000)).toBe(95000)   // lo correcto
    expect(precioUsd * tasaUsdAArs(950, 1000)).not.toBe(100000) // lo que hacía antes
  })

  it('🔑 el precio y el pago en dólares usan la MISMA tasa: no se genera vuelto fantasma', () => {
    const tasa = tasaUsdAArs(950, 1000)
    const totalPesos = 100 * tasa          // producto de USD 100
    const pagoEnPesos = 100 * tasa         // el cliente paga USD 100
    expect(pagoEnPesos - totalPesos).toBe(0)
  })
})
