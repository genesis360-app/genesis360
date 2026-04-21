import { describe, it, expect } from 'vitest'
import { esDecimal, parseCantidad } from '@/lib/ventasValidation'

describe('esDecimal', () => {
  it('retorna true para kg', () => expect(esDecimal('kg')).toBe(true))
  it('retorna true para KG (case insensitive)', () => expect(esDecimal('KG')).toBe(true))
  it('retorna true para g, gr, mg', () => {
    expect(esDecimal('g')).toBe(true)
    expect(esDecimal('gr')).toBe(true)
    expect(esDecimal('mg')).toBe(true)
  })
  it('retorna true para l, lt, ml', () => {
    expect(esDecimal('l')).toBe(true)
    expect(esDecimal('lt')).toBe(true)
    expect(esDecimal('ml')).toBe(true)
  })
  it('retorna true para m, m2, m3, cm, mm, km', () => {
    expect(esDecimal('m')).toBe(true)
    expect(esDecimal('m2')).toBe(true)
    expect(esDecimal('m3')).toBe(true)
    expect(esDecimal('cm')).toBe(true)
    expect(esDecimal('mm')).toBe(true)
    expect(esDecimal('km')).toBe(true)
  })
  it('retorna false para unidad', () => expect(esDecimal('unidad')).toBe(false))
  it('retorna false para u', () => expect(esDecimal('u')).toBe(false))
  it('retorna false para null', () => expect(esDecimal(null)).toBe(false))
  it('retorna false para undefined', () => expect(esDecimal(undefined)).toBe(false))
})

describe('parseCantidad — UOM decimal (kg)', () => {
  it('parsea entero', () => expect(parseCantidad('2', 'kg')).toBe(2))
  it('parsea decimal con punto', () => expect(parseCantidad('1.5', 'kg')).toBe(1.5))
  it('parsea decimal con coma', () => expect(parseCantidad('1,5', 'kg')).toBe(1.5))
  it('parsea cero y clampea a 0.001', () => expect(parseCantidad('0', 'kg')).toBe(0.001))
  it('parsea string vacío y clampea a 0.001', () => expect(parseCantidad('', 'kg')).toBe(0.001))
  it('parsea string inválido y clampea a 0.001', () => expect(parseCantidad('abc', 'kg')).toBe(0.001))
  it('parsea "0.5" correctamente', () => expect(parseCantidad('0.5', 'kg')).toBe(0.5))
  it('parsea "0,5" correctamente', () => expect(parseCantidad('0,5', 'kg')).toBe(0.5))
})

describe('parseCantidad — UOM entera (unidad)', () => {
  it('parsea entero', () => expect(parseCantidad('3', 'unidad')).toBe(3))
  it('trunca decimal con punto a entero', () => expect(parseCantidad('1.9', 'unidad')).toBe(1))
  it('trunca decimal con coma a entero', () => expect(parseCantidad('2,7', 'unidad')).toBe(2))
  it('parsea cero y clampea a 1', () => expect(parseCantidad('0', 'unidad')).toBe(1))
  it('parsea string vacío y clampea a 1', () => expect(parseCantidad('', 'unidad')).toBe(1))
  it('parsea "1.5" y devuelve 1 (sin UOM decimal)', () => expect(parseCantidad('1.5', 'unidad')).toBe(1))
  it('parsea sin UOM (null) como entero', () => expect(parseCantidad('3', null)).toBe(3))
})
