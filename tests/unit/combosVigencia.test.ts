import { describe, it, expect } from 'vitest'
import { comboVigente, estadoVigenciaCombo, hoyLocalISO } from '@/lib/ventasValidation'

// Punto 2 backlog Fede/GO — vigencia por fecha en combos (mig 279)

describe('comboVigente', () => {
  const HOY = '2026-07-19'
  it('sin fechas → siempre vigente (comportamiento pre-mig 279 intacto)', () => {
    expect(comboVigente({}, HOY)).toBe(true)
    expect(comboVigente({ vigencia_desde: null, vigencia_hasta: null }, HOY)).toBe(true)
  })
  it('ambos límites inclusive', () => {
    const c = { vigencia_desde: '2026-07-19', vigencia_hasta: '2026-07-19' }
    expect(comboVigente(c, HOY)).toBe(true)
  })
  it('todavía no empezó → no vigente', () => {
    expect(comboVigente({ vigencia_desde: '2026-07-20' }, HOY)).toBe(false)
  })
  it('ya venció → no vigente', () => {
    expect(comboVigente({ vigencia_hasta: '2026-07-18' }, HOY)).toBe(false)
  })
  it('solo desde / solo hasta funcionan como límites abiertos', () => {
    expect(comboVigente({ vigencia_desde: '2026-01-01' }, HOY)).toBe(true)
    expect(comboVigente({ vigencia_hasta: '2026-12-31' }, HOY)).toBe(true)
  })
})

describe('estadoVigenciaCombo (badges de Config)', () => {
  const HOY = '2026-07-19'
  it('clasifica vigente / programado / vencido', () => {
    expect(estadoVigenciaCombo({}, HOY)).toBe('vigente')
    expect(estadoVigenciaCombo({ vigencia_desde: '2026-08-01' }, HOY)).toBe('programado')
    expect(estadoVigenciaCombo({ vigencia_hasta: '2026-07-01' }, HOY)).toBe('vencido')
  })
})

describe('hoyLocalISO', () => {
  it('usa la fecha LOCAL, no UTC (una promo "hasta el 15" vale todo el 15 en AR)', () => {
    // 2026-07-15 23:30 hora local — en UTC ya es 16; la promo del 15 tiene que seguir valiendo
    const d = new Date(2026, 6, 15, 23, 30)
    expect(hoyLocalISO(d)).toBe('2026-07-15')
  })
  it('con padding de mes/día', () => {
    expect(hoyLocalISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
