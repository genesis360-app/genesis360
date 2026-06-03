import { describe, it, expect } from 'vitest'
import { calcularDescuentoComboMulti } from '@/lib/ventasValidation'

// Plan: tests/specs/ventas.plan.md (sección 1 — VEN-COMBO)

describe('calcularDescuentoComboMulti', () => {
  it('VEN-COMBO-01 pct sobre subtotal', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'pct', descuento_pct: 10 }, 1000)).toBe(100)
  })
  it('VEN-COMBO-02 sin tipo → default pct', () => {
    expect(calcularDescuentoComboMulti({ descuento_pct: 20 }, 500)).toBe(100)
  })
  it('VEN-COMBO-03 pct sin valor → 0', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'pct' }, 1000)).toBe(0)
  })
  it('VEN-COMBO-04 monto fijo local', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'monto', descuento_monto: 150 }, 1000)).toBe(150)
  })
  it('VEN-COMBO-05 monto_usd con cotización', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'monto_usd', descuento_monto: 10 }, 1000, 1200)).toBe(12000)
  })
  it('VEN-COMBO-06 monto_usd sin cotización (default 1)', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'monto_usd', descuento_monto: 10 }, 1000)).toBe(10)
  })
  it('VEN-COMBO-07 monto sin valor → 0', () => {
    expect(calcularDescuentoComboMulti({ descuento_tipo: 'monto' }, 1000)).toBe(0)
  })
})
