import { describe, it, expect } from 'vitest'
import { calcularSiguienteSKU } from '../../src/lib/skuAuto'

describe('calcularSiguienteSKU', () => {
  it('sin SKUs existentes → SKU-00001', () => {
    expect(calcularSiguienteSKU([])).toBe('SKU-00001')
  })

  it('con un SKU → incrementa correctamente', () => {
    expect(calcularSiguienteSKU(['SKU-00001'])).toBe('SKU-00002')
  })

  it('toma el máximo cuando hay varios', () => {
    expect(calcularSiguienteSKU(['SKU-00001', 'SKU-00003', 'SKU-00002'])).toBe('SKU-00004')
  })

  it('ignora SKUs que no siguen el patrón SKU-XXXXX', () => {
    expect(calcularSiguienteSKU(['TORN-0001', 'PROD-ABC', 'SKU-00005'])).toBe('SKU-00006')
  })

  it('ignora strings que empiezan con SKU- pero no son numéricos puros', () => {
    expect(calcularSiguienteSKU(['SKU-ABC', 'SKU-00002'])).toBe('SKU-00003')
  })

  it('genera padding correcto para números menores a 5 dígitos', () => {
    expect(calcularSiguienteSKU(['SKU-00009'])).toBe('SKU-00010')
    expect(calcularSiguienteSKU(['SKU-00099'])).toBe('SKU-00100')
    expect(calcularSiguienteSKU(['SKU-00999'])).toBe('SKU-01000')
  })

  it('maneja números grandes sin padding', () => {
    expect(calcularSiguienteSKU(['SKU-99999'])).toBe('SKU-100000')
  })

  it('lista con solo SKUs no válidos → SKU-00001', () => {
    expect(calcularSiguienteSKU(['PROD-001', 'ART-002'])).toBe('SKU-00001')
  })
})
