import { describe, it, expect } from 'vitest'
import {
  descuentoDeConfig, descuentoVigente, montoDescuento, calcularPromosPago, etiquetaPromo,
} from '@/lib/promosPago'

// Punto 1 backlog Fede/GO — descuento al cliente por método de pago (metodos_pago.config.descuento)

describe('descuentoDeConfig', () => {
  it('lee el shape completo', () => {
    const d = descuentoDeConfig({ descuento: { pct: 10, tope: 5000, dias: [3], desde: '2026-07-01', hasta: '2026-07-31' } })
    expect(d).toEqual({ pct: 10, tope: 5000, dias: [3], desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('config sin descuento / basura → null', () => {
    expect(descuentoDeConfig(null)).toBeNull()
    expect(descuentoDeConfig({})).toBeNull()
    expect(descuentoDeConfig({ descuento: 'x' })).toBeNull()
    expect(descuentoDeConfig({ descuento: { pct: 0 } })).toBeNull()      // 0% = sin promo
    expect(descuentoDeConfig({ descuento: { pct: 150 } })).toBeNull()    // >100 inválido
    expect(descuentoDeConfig({ descuento: { pct: -5 } })).toBeNull()
  })
  it('tope 0/negativo se normaliza a null (sin tope)', () => {
    expect(descuentoDeConfig({ descuento: { pct: 10, tope: 0 } })!.tope).toBeNull()
  })
  it('días fuera de rango se filtran', () => {
    expect(descuentoDeConfig({ descuento: { pct: 10, dias: [1, 9, -1, 6] } })!.dias).toEqual([1, 6])
  })
})

describe('descuentoVigente', () => {
  const base = { pct: 10 }
  it('sin restricciones → siempre vigente', () => {
    expect(descuentoVigente(base, '2026-07-19', 0)).toBe(true)
  })
  it('respeta vigencia por fecha (inclusive)', () => {
    const d = { pct: 10, desde: '2026-07-01', hasta: '2026-07-31' }
    expect(descuentoVigente(d, '2026-07-01', 1)).toBe(true)
    expect(descuentoVigente(d, '2026-07-31', 1)).toBe(true)
    expect(descuentoVigente(d, '2026-06-30', 1)).toBe(false)
    expect(descuentoVigente(d, '2026-08-01', 1)).toBe(false)
  })
  it('respeta días de semana (0=Dom..6=Sáb)', () => {
    const d = { pct: 10, dias: [3] }  // solo miércoles
    expect(descuentoVigente(d, '2026-07-19', 3)).toBe(true)
    expect(descuentoVigente(d, '2026-07-19', 5)).toBe(false)
  })
  it('dias=[] equivale a todos los días', () => {
    expect(descuentoVigente({ pct: 10, dias: [] }, '2026-07-19', 5)).toBe(true)
  })
})

describe('montoDescuento', () => {
  it('pct simple con round2', () => {
    expect(montoDescuento({ pct: 10 }, 12345)).toBe(1234.5)
  })
  it('tope capa el descuento', () => {
    expect(montoDescuento({ pct: 10, tope: 500 }, 100000)).toBe(500)
  })
  it('base 0/negativa → 0', () => {
    expect(montoDescuento({ pct: 10 }, 0)).toBe(0)
    expect(montoDescuento({ pct: 10 }, -100)).toBe(0)
  })
})

describe('calcularPromosPago', () => {
  const metodos = [
    { nombre: 'Efectivo', descuento: { pct: 10, tope: null } },
    { nombre: 'MODO', descuento: { pct: 20, tope: 1000 } },
    { nombre: 'Tarjeta de crédito', descuento: null },
  ]
  const F = '2026-07-19'; const D = 0

  it('un solo medio con promo → descuenta sobre el total', () => {
    const r = calcularPromosPago([{ tipo: 'Efectivo', monto: '' }], metodos, 10000, F, D)
    expect(r.aplicadas).toEqual([{ metodo: 'Efectivo', pct: 10, monto: 1000 }])
    expect(r.totalDescuento).toBe(1000)
  })
  it('un solo medio SIN promo → nada', () => {
    const r = calcularPromosPago([{ tipo: 'Tarjeta de crédito', monto: '' }], metodos, 10000, F, D)
    expect(r.aplicadas).toEqual([])
    expect(r.totalDescuento).toBe(0)
  })
  it('pago mixto → cada método descuenta sobre SU monto tipeado (con tope)', () => {
    const r = calcularPromosPago(
      [{ tipo: 'Efectivo', monto: '4000' }, { tipo: 'MODO', monto: '6000' }],
      metodos, 10000, F, D,
    )
    // Efectivo: 10% de 4000 = 400 · MODO: 20% de 6000 = 1200 → capado a 1000
    expect(r.aplicadas).toEqual([
      { metodo: 'Efectivo', pct: 10, monto: 400 },
      { metodo: 'MODO', pct: 20, monto: 1000 },
    ])
    expect(r.totalDescuento).toBe(1400)
  })
  it('mixto: el monto de un medio no descuenta más allá del total de la venta', () => {
    const r = calcularPromosPago(
      [{ tipo: 'Efectivo', monto: '999999' }, { tipo: 'MODO', monto: '1' }],
      metodos, 5000, F, D,
    )
    expect(r.aplicadas[0]).toEqual({ metodo: 'Efectivo', pct: 10, monto: 500 })  // 10% de 5000, no de 999999
  })
  it('sin medios cargados o total 0 → nada', () => {
    expect(calcularPromosPago([], metodos, 10000, F, D).totalDescuento).toBe(0)
    expect(calcularPromosPago([{ tipo: 'Efectivo', monto: '' }], metodos, 0, F, D).totalDescuento).toBe(0)
  })
  it('promo no vigente hoy → no aplica', () => {
    const soloMiercoles = [{ nombre: 'Efectivo', descuento: null }]  // simulando filtro previo por vigencia
    expect(calcularPromosPago([{ tipo: 'Efectivo', monto: '' }], soloMiercoles, 10000, F, D).totalDescuento).toBe(0)
  })
})

describe('etiquetaPromo', () => {
  it('sin tope', () => expect(etiquetaPromo({ pct: 10 })).toBe('10% off'))
  it('con tope', () => expect(etiquetaPromo({ pct: 10, tope: 5000 })).toBe('10% off (tope $5.000)'))
})
