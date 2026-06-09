import { describe, it, expect } from 'vitest'
import {
  litrosConsumidos, costoCombustible, kmAcumuladoNuevo, desgloseIvaCombustible,
} from '@/lib/enviosRecurso'

// Envíos EN7 — G2: combustible del envío propio

describe('litrosConsumidos (G2)', () => {
  it('km × L/100km / 100', () => {
    expect(litrosConsumidos(100, 8)).toBe(8)
    expect(litrosConsumidos(50, 12)).toBe(6)
  })
  it('0 si falta rendimiento o km', () => {
    expect(litrosConsumidos(100, 0)).toBe(0)
    expect(litrosConsumidos(0, 8)).toBe(0)
    expect(litrosConsumidos(100, null)).toBe(0)
  })
  it('redondea a 2 decimales', () => {
    expect(litrosConsumidos(33, 7)).toBe(2.31)
  })
})

describe('costoCombustible (G2)', () => {
  it('litros × precio del litro', () => {
    // 100km × 8L/100 = 8L × $1000 = $8000
    expect(costoCombustible(100, { consumoLitros100km: 8, precioLitro: 1000 })).toBe(8000)
  })
  it('0 si falta rendimiento o precio (operador tipea a mano)', () => {
    expect(costoCombustible(100, { consumoLitros100km: 8, precioLitro: 0 })).toBe(0)
    expect(costoCombustible(100, { consumoLitros100km: null, precioLitro: 1000 })).toBe(0)
  })
})

describe('kmAcumuladoNuevo (G2)', () => {
  it('suma el km del envío al acumulado', () => {
    expect(kmAcumuladoNuevo(120, 15.5)).toBe(135.5)
  })
  it('arranca de 0 si el acumulado es null', () => {
    expect(kmAcumuladoNuevo(null, 10)).toBe(10)
  })
})

describe('desgloseIvaCombustible (G2)', () => {
  it('desglosa IVA del bruto', () => {
    const { neto, iva } = desgloseIvaCombustible(1210, 21)
    expect(neto).toBe(1000)
    expect(iva).toBe(210)
  })
  it('sin IVA devuelve todo como neto', () => {
    expect(desgloseIvaCombustible(1000, 0)).toEqual({ neto: 1000, iva: 0 })
  })
})
