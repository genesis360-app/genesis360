import { describe, it, expect } from 'vitest'
import {
  sueldoHora, descuentoTardanza, montoHorasExtra, montoFeriadoTrabajado, minutosTardeFacturables,
} from '@/lib/rrhhAsistencia'

// RRHH RH6 — tardanza + horas extra + feriados

describe('sueldoHora (D3/D5)', () => {
  it('bruto / horas base', () => {
    expect(sueldoHora(200000, 200)).toBe(1000)
  })
})

describe('descuentoTardanza (D3)', () => {
  const sh = 1200 // sueldo/hora → 20/min
  it("modo 'registrar' no descuenta", () => {
    expect(descuentoTardanza(30, sh, { modo: 'registrar' })).toBe(0)
  })
  it("'proporcional' descuenta todos los minutos", () => {
    expect(descuentoTardanza(30, sh, { modo: 'proporcional' })).toBe(600) // 30 × 20
  })
  it("'umbral' solo descuenta el excedente de la tolerancia", () => {
    expect(descuentoTardanza(30, sh, { modo: 'umbral', toleranciaMin: 10 })).toBe(400) // 20 × 20
  })
  it("'umbral' dentro de la tolerancia no descuenta", () => {
    expect(descuentoTardanza(8, sh, { modo: 'umbral', toleranciaMin: 10 })).toBe(0)
  })
})

describe('minutosTardeFacturables (D3 — desde fichadas)', () => {
  // ts sin timezone → se interpretan en hora local (determinista en cualquier runner)
  it("modo 'registrar' siempre 0", () => {
    expect(minutosTardeFacturables([{ ts: '2026-06-02T09:30:00' }], '09:00', { modo: 'registrar' })).toBe(0)
  })
  it('sin horario de entrada → 0', () => {
    expect(minutosTardeFacturables([{ ts: '2026-06-02T09:30:00' }], null, { modo: 'proporcional' })).toBe(0)
  })
  it("proporcional: suma minutos de atraso vs horario", () => {
    expect(minutosTardeFacturables([{ ts: '2026-06-02T09:15:00' }], '09:00', { modo: 'proporcional' })).toBe(15)
  })
  it('toma la PRIMERA entrada de cada día', () => {
    const entradas = [{ ts: '2026-06-02T09:20:00' }, { ts: '2026-06-02T09:05:00' }]
    expect(minutosTardeFacturables(entradas, '09:00', { modo: 'proporcional' })).toBe(5)
  })
  it("umbral: aplica la tolerancia por día", () => {
    expect(minutosTardeFacturables([{ ts: '2026-06-02T09:15:00' }], '09:00', { modo: 'umbral', toleranciaMin: 10 })).toBe(5)
  })
  it('suma a través de varios días', () => {
    const entradas = [{ ts: '2026-06-02T09:10:00' }, { ts: '2026-06-03T09:30:00' }]
    expect(minutosTardeFacturables(entradas, '09:00', { modo: 'proporcional' })).toBe(40)
  })
  it('llegar temprano no genera atraso', () => {
    expect(minutosTardeFacturables([{ ts: '2026-06-02T08:45:00' }], '09:00', { modo: 'proporcional' })).toBe(0)
  })
})

describe('montoHorasExtra (D5)', () => {
  it('50% → horas × sueldo/hora × 1.5', () => {
    expect(montoHorasExtra(3, 1000, 50)).toBe(4500)
  })
  it('100% → ×2', () => {
    expect(montoHorasExtra(2, 1000, 100)).toBe(4000)
  })
})

describe('montoFeriadoTrabajado (D6)', () => {
  it('doble por default', () => {
    expect(montoFeriadoTrabajado(10000, 'doble')).toBe(20000)
  })
  it('triple', () => {
    expect(montoFeriadoTrabajado(10000, 'triple')).toBe(30000)
  })
})
