import { describe, it, expect } from 'vitest'
import {
  indemnizacionAntiguedad, sacProporcionalEgreso, vacacionesNoGozadas,
  liquidacionFinal, generaIndemnizacion,
} from '@/lib/liquidacionFinal'

// RRHH RH8 — liquidación final

describe('indemnizacionAntiguedad (A2-c)', () => {
  it('1 sueldo por año', () => {
    expect(indemnizacionAntiguedad(100000, 5, 0)).toBe(500000)
  })
  it('fracción > 3 meses suma un año', () => {
    expect(indemnizacionAntiguedad(100000, 5, 4)).toBe(600000)
  })
  it('mínimo 1 sueldo', () => {
    expect(indemnizacionAntiguedad(100000, 0, 2)).toBe(100000)
  })
})

describe('sacProporcionalEgreso (A2-c)', () => {
  it('(mejor/2) × dias/182', () => {
    expect(sacProporcionalEgreso(120000, 91)).toBe(30000) // 60000 × 0.5
  })
})

describe('vacacionesNoGozadas (A2-c)', () => {
  it('sueldo/25 por día', () => {
    expect(vacacionesNoGozadas(10, 100000)).toBe(40000) // 4000 × 10
  })
})

describe('liquidacionFinal (A2-c)', () => {
  it('suma los 3 componentes', () => {
    const r = liquidacionFinal({
      mejorSueldo: 100000, antiguedadAnios: 5, mesesFraccion: 0,
      mejorSueldoSemestre: 120000, diasTrabajadosSemestre: 91,
      diasVacacionesPendientes: 10, sueldoMensual: 100000, conIndemnizacion: true,
    })
    expect(r.indemnizacion).toBe(500000)
    expect(r.sacProporcional).toBe(30000)
    expect(r.vacacionesNoGozadas).toBe(40000)
    expect(r.total).toBe(570000)
  })
  it('renuncia (sin indemnización) la omite', () => {
    const r = liquidacionFinal({
      mejorSueldo: 100000, antiguedadAnios: 5, mesesFraccion: 0,
      mejorSueldoSemestre: 120000, diasTrabajadosSemestre: 91,
      diasVacacionesPendientes: 10, sueldoMensual: 100000, conIndemnizacion: false,
    })
    expect(r.indemnizacion).toBe(0)
    expect(r.total).toBe(70000)
  })
})

describe('generaIndemnizacion', () => {
  it('despido sin causa y fin de contrato sí; renuncia y con causa no', () => {
    expect(generaIndemnizacion('despido_sin_causa')).toBe(true)
    expect(generaIndemnizacion('fin_contrato')).toBe(true)
    expect(generaIndemnizacion('renuncia')).toBe(false)
    expect(generaIndemnizacion('despido_con_causa')).toBe(false)
  })
})
