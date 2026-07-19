import { describe, it, expect } from 'vitest'
import { fmtPesos, fmtEntero, fmtPct, formatMoneda } from '@/lib/formato'

// Punto 6 backlog Fede/GO — helpers centrales de formato numérico ($ / entero / %)

describe('fmtPesos', () => {
  it('sin decimales, separador es-AR', () => {
    expect(fmtPesos(12345.6)).toBe('$12.346')
    expect(fmtPesos(0)).toBe('$0')
  })
  it('acepta string y basura', () => {
    expect(fmtPesos('1500')).toBe('$1.500')
    expect(fmtPesos(null)).toBe('$0')
    expect(fmtPesos('x')).toBe('$0')
  })
})

describe('fmtEntero', () => {
  it('redondea y separa miles', () => {
    expect(fmtEntero(12345.6)).toBe('12.346')
    expect(fmtEntero('999')).toBe('999')
    expect(fmtEntero(undefined)).toBe('0')
  })
})

describe('fmtPct', () => {
  it('hasta 2 decimales, coma decimal es-AR', () => {
    expect(fmtPct(10)).toBe('10%')
    expect(fmtPct(10.5)).toBe('10,5%')
    expect(fmtPct('21')).toBe('21%')
    expect(fmtPct(null)).toBe('0%')
  })
})

describe('formatMoneda (regresión: sigue igual)', () => {
  it('ARS default', () => {
    expect(formatMoneda(1500)).toBe('$1.500')
  })
})
