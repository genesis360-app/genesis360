import { describe, it, expect } from 'vitest'
import { redondearPrecio } from '@/lib/precioRedondeo'

describe('redondearPrecio — H4 redondeo de precios de venta', () => {
  describe('modo none / inválido → sin cambios', () => {
    it('none devuelve el precio tal cual', () => {
      expect(redondearPrecio(1437, 'none')).toBe(1437)
      expect(redondearPrecio(1437.55, 'none')).toBe(1437.55)
    })
    it('null / undefined / vacío → sin cambios', () => {
      expect(redondearPrecio(1437, null)).toBe(1437)
      expect(redondearPrecio(1437, undefined)).toBe(1437)
      expect(redondearPrecio(1437, '')).toBe(1437)
    })
    it('modo desconocido → sin cambios (fail-safe)', () => {
      expect(redondearPrecio(1437, '25')).toBe(1437)
      expect(redondearPrecio(1437, 'foo')).toBe(1437)
    })
  })

  describe('redondeo al múltiplo más cercano', () => {
    it('a $10', () => {
      expect(redondearPrecio(1437, '10')).toBe(1440)
      expect(redondearPrecio(1434, '10')).toBe(1430)
      expect(redondearPrecio(1435, '10')).toBe(1440) // half-up
    })
    it('a $50', () => {
      expect(redondearPrecio(1437, '50')).toBe(1450)
      expect(redondearPrecio(1424, '50')).toBe(1400)
      expect(redondearPrecio(1425, '50')).toBe(1450) // half-up
    })
    it('a $100', () => {
      expect(redondearPrecio(1437, '100')).toBe(1400)
      expect(redondearPrecio(1480, '100')).toBe(1500)
      expect(redondearPrecio(1450, '100')).toBe(1500) // half-up
    })
    it('a $500', () => {
      expect(redondearPrecio(1240, '500')).toBe(1000)
      expect(redondearPrecio(1260, '500')).toBe(1500)
      expect(redondearPrecio(1250, '500')).toBe(1500) // half-up
    })
    it('a $1.000', () => {
      expect(redondearPrecio(1437, '1000')).toBe(1000)
      expect(redondearPrecio(1600, '1000')).toBe(2000)
      expect(redondearPrecio(1500, '1000')).toBe(2000) // half-up
    })
  })

  describe('valores que ya son múltiplos exactos no cambian', () => {
    it('1400 a $100 → 1400', () => expect(redondearPrecio(1400, '100')).toBe(1400))
    it('2000 a $1000 → 2000', () => expect(redondearPrecio(2000, '1000')).toBe(2000))
  })

  describe('bordes: precio inválido / 0 / negativo → sin cambios', () => {
    it('precio 0 → 0', () => expect(redondearPrecio(0, '100')).toBe(0))
    it('precio negativo se devuelve igual (no aplica)', () => expect(redondearPrecio(-50, '100')).toBe(-50))
    it('NaN → NaN (no inventa plata)', () => expect(redondearPrecio(NaN, '100')).toBeNaN())
    it('Infinity → Infinity', () => expect(redondearPrecio(Infinity, '100')).toBe(Infinity))
  })

  describe('precios chicos vs paso grande', () => {
    it('precio menor a medio paso → 0', () => {
      expect(redondearPrecio(40, '100')).toBe(0)   // 40 < 50 → 0
      expect(redondearPrecio(60, '100')).toBe(100)
    })
    it('precio decimal redondea al múltiplo más cercano', () => {
      expect(redondearPrecio(149.99, '50')).toBe(150)
      expect(redondearPrecio(124.99, '50')).toBe(100)
    })
  })
})
