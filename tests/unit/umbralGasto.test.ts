import { describe, it, expect } from 'vitest'
import { evaluarUmbralGasto, puedeAprobar } from '@/lib/umbralGasto'

// Plan: tests/specs/ventas.plan.md (secciones 3-4 — VEN-UMBRAL, VEN-APROB)

const suc = { umbral_gasto_supervisor: 5000, umbral_gasto_cajero: 2000 } as any

describe('evaluarUmbralGasto', () => {
  it('VEN-UMBRAL-01 rol null → no aplica', () => {
    expect(evaluarUmbralGasto(null, suc, 100)).toEqual({ aplica: false, umbral: null, superado: false, rolMinimoAprobador: null })
  })
  it('VEN-UMBRAL-02 DUEÑO → libre', () => {
    expect(evaluarUmbralGasto('DUEÑO', suc, 99999)).toEqual({ aplica: false, umbral: null, superado: false, rolMinimoAprobador: null })
  })
  it('VEN-UMBRAL-03 SUPERVISOR dentro del umbral', () => {
    expect(evaluarUmbralGasto('SUPERVISOR', suc, 3000)).toEqual({ aplica: true, umbral: 5000, superado: false, rolMinimoAprobador: 'DUEÑO' })
  })
  it('VEN-UMBRAL-04 SUPERVISOR supera el umbral', () => {
    expect(evaluarUmbralGasto('SUPERVISOR', suc, 6000)).toEqual({ aplica: true, umbral: 5000, superado: true, rolMinimoAprobador: 'DUEÑO' })
  })
  it('VEN-UMBRAL-05 SUPERVISOR sin umbral → libre', () => {
    expect(evaluarUmbralGasto('SUPERVISOR', { umbral_gasto_supervisor: null, umbral_gasto_cajero: 2000 } as any, 99999))
      .toEqual({ aplica: false, umbral: null, superado: false, rolMinimoAprobador: null })
  })
  it('VEN-UMBRAL-06 CAJERO dentro del umbral', () => {
    expect(evaluarUmbralGasto('CAJERO', suc, 1500)).toEqual({ aplica: true, umbral: 2000, superado: false, rolMinimoAprobador: 'SUPERVISOR' })
  })
  it('VEN-UMBRAL-07 CAJERO supera el umbral', () => {
    expect(evaluarUmbralGasto('CAJERO', suc, 2500)).toEqual({ aplica: true, umbral: 2000, superado: true, rolMinimoAprobador: 'SUPERVISOR' })
  })
  it('VEN-UMBRAL-08 CAJERO sin umbral → todo requiere autorización', () => {
    expect(evaluarUmbralGasto('CAJERO', { umbral_gasto_supervisor: 5000, umbral_gasto_cajero: null } as any, 10))
      .toEqual({ aplica: true, umbral: null, superado: true, rolMinimoAprobador: 'SUPERVISOR' })
  })
  it('VEN-UMBRAL-09 CONTADOR → no aplica', () => {
    expect(evaluarUmbralGasto('CONTADOR', suc, 100)).toEqual({ aplica: false, umbral: null, superado: false, rolMinimoAprobador: null })
  })
})

describe('puedeAprobar', () => {
  it('VEN-APROB-01 CAJERO ← SUPERVISOR', () => expect(puedeAprobar('CAJERO', 'SUPERVISOR')).toBe(true))
  it('VEN-APROB-02 CAJERO ← CAJERO → no', () => expect(puedeAprobar('CAJERO', 'CAJERO')).toBe(false))
  it('VEN-APROB-03 SUPERVISOR ← SUPERVISOR → no (necesita DUEÑO+)', () => expect(puedeAprobar('SUPERVISOR', 'SUPERVISOR')).toBe(false))
  it('VEN-APROB-04 SUPERVISOR ← DUEÑO', () => expect(puedeAprobar('SUPERVISOR', 'DUEÑO')).toBe(true))
})
