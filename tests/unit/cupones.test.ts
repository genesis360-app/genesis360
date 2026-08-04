import { describe, it, expect } from 'vitest'
import {
  cuponVigente, montoDescuentoCupon, generarCodigoCupon, generarCodigosCupon,
  CUPON_CODIGOS_MAXIMO, type Cupon,
} from '@/lib/cupones'

// Fede 25/7, módulo Comercial: cupones = $ FIJOS sobre el TOTAL de la compra, independientes de
// cualquier descuento de producto ya aplicado. Código único alfanumérico, hasta ~100 por campaña.

describe('cuponVigente', () => {
  const base: Cupon = { activo: true, vigencia_desde: '2026-08-01', vigencia_hasta: '2026-08-31', monto: 500 }

  it('vigente dentro del rango', () => {
    expect(cuponVigente(base, '2026-08-15')).toBe(true)
    expect(cuponVigente(base, '2026-08-01')).toBe(true) // límite inferior inclusive
    expect(cuponVigente(base, '2026-08-31')).toBe(true) // límite superior inclusive
  })

  it('no vigente antes de vigencia_desde o después de vigencia_hasta', () => {
    expect(cuponVigente(base, '2026-07-31')).toBe(false)
    expect(cuponVigente(base, '2026-09-01')).toBe(false)
  })

  it('inactivo nunca es vigente, aunque la fecha caiga dentro del rango', () => {
    expect(cuponVigente({ ...base, activo: false }, '2026-08-15')).toBe(false)
  })
})

describe('montoDescuentoCupon', () => {
  it('descuenta el monto fijo del cupón', () => {
    expect(montoDescuentoCupon({ monto: 500 }, 5000)).toBe(500)
  })

  it('🛑 nunca descuenta más que el total (no da negativo)', () => {
    expect(montoDescuentoCupon({ monto: 5000 }, 500)).toBe(500)
  })

  it('total en 0 o cupón sin monto → 0', () => {
    expect(montoDescuentoCupon({ monto: 500 }, 0)).toBe(0)
    expect(montoDescuentoCupon({ monto: 0 }, 5000)).toBe(0)
  })
})

describe('generarCodigoCupon', () => {
  it('genera un código de la longitud pedida, sin caracteres ambiguos (O/0, I/1)', () => {
    const codigo = generarCodigoCupon(8)
    expect(codigo).toHaveLength(8)
    expect(codigo).toMatch(/^[A-HJ-NP-Z2-9]+$/) // sin I, O, 0, 1
  })

  it('longitud configurable', () => {
    expect(generarCodigoCupon(12)).toHaveLength(12)
  })
})

describe('generarCodigosCupon', () => {
  it('genera la cantidad pedida, todos únicos entre sí', () => {
    const codigos = generarCodigosCupon(50)
    expect(codigos).toHaveLength(50)
    expect(new Set(codigos).size).toBe(50)
  })

  it(`🛑 clampea al máximo de ${CUPON_CODIGOS_MAXIMO} códigos por campaña`, () => {
    expect(generarCodigosCupon(500)).toHaveLength(CUPON_CODIGOS_MAXIMO)
  })

  it('al menos 1 código, aunque pidan 0 o negativo', () => {
    expect(generarCodigosCupon(0)).toHaveLength(1)
    expect(generarCodigosCupon(-5)).toHaveLength(1)
  })
})
