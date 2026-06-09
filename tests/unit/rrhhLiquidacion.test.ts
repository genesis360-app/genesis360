import { describe, it, expect } from 'vitest'
import {
  factorProrrateo, basicoProrrateado, totalAnticipos, anticiposADescontar,
} from '@/lib/rrhhLiquidacion'

// RRHH RH4 — frecuencia + anticipos

describe('factorProrrateo (B1)', () => {
  it('mensual=1, quincenal=1/2, semanal=1/4', () => {
    expect(factorProrrateo('mensual')).toBe(1)
    expect(factorProrrateo('quincenal')).toBe(0.5)
    expect(factorProrrateo('semanal')).toBe(0.25)
  })
  it('personalizado = dias/30 con tope 1', () => {
    expect(factorProrrateo('personalizado', 15)).toBe(0.5)
    expect(factorProrrateo('personalizado', 45)).toBe(1)
    expect(factorProrrateo('personalizado', 0)).toBe(1)
  })
})

describe('basicoProrrateado (B1)', () => {
  it('aplica el factor al básico', () => {
    expect(basicoProrrateado(200000, 'quincenal')).toBe(100000)
    expect(basicoProrrateado(200000, 'semanal')).toBe(50000)
  })
})

describe('anticipos (B10)', () => {
  it('totalAnticipos suma', () => {
    expect(totalAnticipos([{ id: '1', monto: 5000 }, { id: '2', monto: 3000 }])).toBe(8000)
  })
  it('descuenta completos sin dejar neto negativo', () => {
    const r = anticiposADescontar([{ id: '1', monto: 5000 }, { id: '2', monto: 3000 }], 100000)
    expect(r.monto).toBe(8000)
    expect(r.saldadosIds).toEqual(['1', '2'])
  })
  it('descuento parcial cuando el neto no alcanza', () => {
    const r = anticiposADescontar([{ id: '1', monto: 5000 }, { id: '2', monto: 3000 }], 6000)
    expect(r.monto).toBe(6000)
    expect(r.saldadosIds).toEqual(['1']) // el 1 se salda; del 2 se descuenta 1000 (parcial)
  })
})
