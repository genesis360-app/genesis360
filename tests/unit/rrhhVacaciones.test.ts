import { describe, it, expect } from 'vitest'
import {
  diasVacacionesLCT, antiguedadAnios, remanenteSiguiente,
  rangosSolapan, solapamientos, evaluarAviso, validarParticion,
} from '@/lib/rrhhVacaciones'

// RRHH RH5 — vacaciones

describe('diasVacacionesLCT (C1)', () => {
  it('tramos LCT 14/21/28/35', () => {
    expect(diasVacacionesLCT(2)).toBe(14)
    expect(diasVacacionesLCT(5)).toBe(21)
    expect(diasVacacionesLCT(10)).toBe(28)
    expect(diasVacacionesLCT(20)).toBe(35)
  })
})

describe('antiguedadAnios', () => {
  it('cuenta años enteros', () => {
    expect(antiguedadAnios('2020-06-01', '2026-06-09')).toBe(6)
    expect(antiguedadAnios('2020-12-31', '2026-06-09')).toBe(5)
  })
})

describe('remanenteSiguiente (C6)', () => {
  it('totales + anterior - usados, con tope', () => {
    expect(remanenteSiguiente(21, 10, 0, 0)).toBe(11)
    expect(remanenteSiguiente(21, 10, 0, 5)).toBe(5) // limitado a max 5
  })
  it('nunca negativo', () => {
    expect(remanenteSiguiente(14, 20, 0, 0)).toBe(0)
  })
})

describe('solapamiento (C4)', () => {
  it('detecta rangos que se pisan', () => {
    expect(rangosSolapan({ desde: '2026-07-01', hasta: '2026-07-10' }, { desde: '2026-07-08', hasta: '2026-07-15' })).toBe(true)
    expect(rangosSolapan({ desde: '2026-07-01', hasta: '2026-07-10' }, { desde: '2026-07-11', hasta: '2026-07-15' })).toBe(false)
  })
  it('filtra las aprobadas que se solapan', () => {
    const aprob = [
      { desde: '2026-07-05', hasta: '2026-07-09', id: 'a' },
      { desde: '2026-08-01', hasta: '2026-08-05', id: 'b' },
    ]
    const r = solapamientos({ desde: '2026-07-01', hasta: '2026-07-10' }, aprob)
    expect(r.map(x => x.id)).toEqual(['a'])
  })
})

describe('evaluarAviso (C3)', () => {
  it("'alerta' avisa pero no bloquea", () => {
    const r = evaluarAviso('2026-06-09', '2026-06-20', { modo: 'alerta', dias: 30 })
    expect(r.ok).toBe(true)
    expect(r.aviso).toBe(true) // 11 días < 30
  })
  it("'fijo' bloquea si no cumple", () => {
    const r = evaluarAviso('2026-06-09', '2026-06-20', { modo: 'fijo', dias: 30 })
    expect(r.ok).toBe(false)
  })
  it("'sin' siempre ok", () => {
    expect(evaluarAviso('2026-06-09', '2026-06-10', { modo: 'sin' }).ok).toBe(true)
  })
})

describe('validarParticion (C5)', () => {
  it('bloque por debajo del mínimo falla', () => {
    expect(validarParticion(4, 0, { minBloque: 7 }).ok).toBe(false)
  })
  it('supera el máximo de bloques', () => {
    expect(validarParticion(10, 2, { maxBloques: 2 }).ok).toBe(false)
  })
  it('ok dentro de los límites', () => {
    expect(validarParticion(10, 1, { minBloque: 7, maxBloques: 3 }).ok).toBe(true)
  })
})
