import { describe, it, expect } from 'vitest'
import {
  estadoOCdesdeRecibido, superaOverReceipt, tieneFaltante, esAjusteCantidad,
} from '@/lib/recepcionLogic'

// Compras CO2 — recepción robusta (acumulado por ítem entre múltiples recepciones)

describe('estadoOCdesdeRecibido (B5)', () => {
  it('todos completos → recibida', () => {
    expect(estadoOCdesdeRecibido([
      { esperada: 100, recibidoAcum: 100 },
      { esperada: 50, recibidoAcum: 60 },  // over también cuenta como completo
    ])).toBe('recibida')
  })
  it('completada en 2 recepciones parciales → recibida (el bug que arregla CO2)', () => {
    // 60 + 40 = 100 acumulado → completa, aunque cada recepción por separado fue parcial
    expect(estadoOCdesdeRecibido([{ esperada: 100, recibidoAcum: 100 }])).toBe('recibida')
  })
  it('algo recibido pero falta → recibida_parcial', () => {
    expect(estadoOCdesdeRecibido([
      { esperada: 100, recibidoAcum: 60 },
      { esperada: 50, recibidoAcum: 50 },
    ])).toBe('recibida_parcial')
  })
  it('nada recibido → sin_recibir', () => {
    expect(estadoOCdesdeRecibido([{ esperada: 100, recibidoAcum: 0 }])).toBe('sin_recibir')
  })
  it('sin ítems → sin_recibir', () => {
    expect(estadoOCdesdeRecibido([])).toBe('sin_recibir')
  })
})

describe('superaOverReceipt (B3)', () => {
  it('sin exceso → false', () => {
    expect(superaOverReceipt(100, 100, { permite: false })).toBe(false)
    expect(superaOverReceipt(90, 100, { permite: false })).toBe(false)
  })
  it('exceso y no se permite → true', () => {
    expect(superaOverReceipt(101, 100, { permite: false })).toBe(true)
  })
  it('exceso permitido sin tope → false', () => {
    expect(superaOverReceipt(150, 100, { permite: true, pctMax: null })).toBe(false)
  })
  it('exceso dentro del tope % → false; fuera del tope → true', () => {
    expect(superaOverReceipt(110, 100, { permite: true, pctMax: 10 })).toBe(false)  // +10% exacto
    expect(superaOverReceipt(111, 100, { permite: true, pctMax: 10 })).toBe(true)   // +11%
  })
})

describe('tieneFaltante (B4)', () => {
  it('recibido < esperado → true', () => {
    expect(tieneFaltante(80, 100)).toBe(true)
  })
  it('recibido >= esperado → false', () => {
    expect(tieneFaltante(100, 100)).toBe(false)
    expect(tieneFaltante(120, 100)).toBe(false)
  })
})

describe('esAjusteCantidad (B1c)', () => {
  it('igual a lo esperado → false', () => {
    expect(esAjusteCantidad(100, 100)).toBe(false)
  })
  it('over o under → true (requiere SUPERVISOR+)', () => {
    expect(esAjusteCantidad(120, 100)).toBe(true)
    expect(esAjusteCantidad(80, 100)).toBe(true)
  })
})
