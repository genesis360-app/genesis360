import { describe, it, expect } from 'vitest'
import { calcularDescuentoEstadoLinea, combinarDetalleDescuentoEstado } from '@/lib/descuentoEstado'

// Punto 3 backlog Fede/GO — descuento automático por estado de inventario ("aging profile")

describe('calcularDescuentoEstadoLinea', () => {
  it('sin fuentes con descuento → monto 0, sin detalle', () => {
    const r = calcularDescuentoEstadoLinea([{ cantidad: 5, estado_nombre: 'Disponible', estado_descuento_pct: null }], 100)
    expect(r).toEqual({ monto: 0, detalle: [] })
  })

  it('toda la cantidad viene de un estado con descuento', () => {
    const r = calcularDescuentoEstadoLinea(
      [{ cantidad: 3, estado_nombre: 'Próximo a Vencer', estado_descuento_pct: 15 }],
      100,
    )
    // 3 unidades × $100 × 15% = $45
    expect(r.monto).toBe(45)
    expect(r.detalle).toEqual([{ estado_nombre: 'Próximo a Vencer', pct: 15, cantidad: 3, monto: 45 }])
  })

  it('mezcla de fuentes: solo la porción del estado con descuento entra al cálculo', () => {
    const r = calcularDescuentoEstadoLinea(
      [
        { cantidad: 2, estado_nombre: 'Próximo a Vencer', estado_descuento_pct: 15 },
        { cantidad: 5, estado_nombre: 'Disponible', estado_descuento_pct: null },
      ],
      100,
    )
    // Solo las 2 unidades de "Próximo a Vencer" descuentan: 2 × 100 × 15% = 30
    expect(r.monto).toBe(30)
    expect(r.detalle).toEqual([{ estado_nombre: 'Próximo a Vencer', pct: 15, cantidad: 2, monto: 30 }])
  })

  it('dos fuentes del MISMO estado se agrupan en un solo renglón de detalle', () => {
    const r = calcularDescuentoEstadoLinea(
      [
        { cantidad: 2, estado_nombre: 'Próximo a Vencer', estado_descuento_pct: 10 },
        { cantidad: 4, estado_nombre: 'Próximo a Vencer', estado_descuento_pct: 10 },
      ],
      50,
    )
    // (2+4) × 50 × 10% = 30
    expect(r.detalle).toHaveLength(1)
    expect(r.detalle[0]).toEqual({ estado_nombre: 'Próximo a Vencer', pct: 10, cantidad: 6, monto: 30 })
    expect(r.monto).toBe(30)
  })

  it('dos estados con descuento distintos generan dos renglones', () => {
    const r = calcularDescuentoEstadoLinea(
      [
        { cantidad: 2, estado_nombre: 'Próximo a Vencer', estado_descuento_pct: 15 },
        { cantidad: 1, estado_nombre: 'Dañado', estado_descuento_pct: 30 },
      ],
      100,
    )
    expect(r.detalle).toHaveLength(2)
    expect(r.monto).toBe(2 * 100 * 0.15 + 1 * 100 * 0.30) // 30 + 30 = 60
  })

  it('precio unitario 0 o fuentes vacías → sin descuento, no explota', () => {
    expect(calcularDescuentoEstadoLinea([], 100)).toEqual({ monto: 0, detalle: [] })
    expect(calcularDescuentoEstadoLinea([{ cantidad: 3, estado_descuento_pct: 15 }], 0)).toEqual({ monto: 0, detalle: [] })
  })

  it('estado_descuento_pct 0 o negativo se ignora (no debería pasar por la UI, pero por las dudas)', () => {
    const r = calcularDescuentoEstadoLinea([{ cantidad: 5, estado_nombre: 'X', estado_descuento_pct: 0 }], 100)
    expect(r.monto).toBe(0)
  })

  it('redondea a 2 decimales', () => {
    const r = calcularDescuentoEstadoLinea([{ cantidad: 3, estado_nombre: 'X', estado_descuento_pct: 33.33 }], 10)
    // 3 × 10 × 0.3333 = 9.999 → 10.00
    expect(r.monto).toBeCloseTo(10, 2)
  })
})

describe('combinarDetalleDescuentoEstado', () => {
  it('combina detalle de varias líneas, agrupando por estado repetido', () => {
    const combinado = combinarDetalleDescuentoEstado([
      [{ estado_nombre: 'Próximo a Vencer', pct: 15, cantidad: 2, monto: 30 }],
      [{ estado_nombre: 'Próximo a Vencer', pct: 15, cantidad: 1, monto: 15 }],
      [{ estado_nombre: 'Dañado', pct: 30, cantidad: 1, monto: 20 }],
    ])
    expect(combinado).toHaveLength(2)
    const pav = combinado.find(d => d.estado_nombre === 'Próximo a Vencer')
    expect(pav).toEqual({ estado_nombre: 'Próximo a Vencer', pct: 15, cantidad: 3, monto: 45 })
    const dan = combinado.find(d => d.estado_nombre === 'Dañado')
    expect(dan).toEqual({ estado_nombre: 'Dañado', pct: 30, cantidad: 1, monto: 20 })
  })

  it('sin detalle en ninguna línea → []', () => {
    expect(combinarDetalleDescuentoEstado([[], []])).toEqual([])
  })
})
