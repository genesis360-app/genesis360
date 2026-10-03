import { describe, it, expect } from 'vitest'
import { leerPorcentaje, porcentajeLegible } from '@/lib/categoriaDescuentos'

describe('leerPorcentaje', () => {
  it('acepta coma, punto, % y números de Excel', () => {
    expect(leerPorcentaje('15')).toBe(15)
    expect(leerPorcentaje('12,5')).toBe(12.5)
    expect(leerPorcentaje('12.5')).toBe(12.5)
    expect(leerPorcentaje(' 20 % ')).toBe(20)
    expect(leerPorcentaje(7.25)).toBe(7.25)
  })
  it('0 es un valor (sin descuento explícito); vacío es null (sin cargar)', () => {
    expect(leerPorcentaje('0')).toBe(0)
    expect(leerPorcentaje(0)).toBe(0)
    expect(leerPorcentaje('')).toBeNull()
    expect(leerPorcentaje(undefined)).toBeNull()
  })
  it('rechaza fuera de rango, negativos, más de 2 decimales y texto', () => {
    for (const v of ['101', '-5', '12,345', 'diez', '1.000', 150, -1, 12.345]) expect(leerPorcentaje(v)).toBe('invalido')
  })
})

describe('porcentajeLegible', () => {
  it('formatea el numeric de Postgres', () => {
    expect(porcentajeLegible('12.50')).toBe('12,5 %')
    expect(porcentajeLegible(0)).toBe('0 %')
  })
})
