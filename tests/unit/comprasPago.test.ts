import { describe, it, expect } from 'vitest'
import {
  labelModoPago, defaultAnticipoOC, montoAnticipo,
  totalPctSchedule, scheduleValido, montoCuota, labelBaseCuota,
  type CuotaSchedule,
} from '@/lib/comprasPago'

// Compras CO5 — pago: anticipo + schedule

describe('labelModoPago (D1)', () => {
  it('mapea cada modo a su etiqueta', () => {
    expect(labelModoPago('contado')).toBe('Contado')
    expect(labelModoPago('anticipo')).toContain('Anticipo')
    expect(labelModoPago('contra_entrega')).toBe('Contra entrega')
    expect(labelModoPago('cuenta_corriente')).toBe('Cuenta corriente')
  })
  it('valor desconocido / null → Contado', () => {
    expect(labelModoPago(null)).toBe('Contado')
    expect(labelModoPago('xxx')).toBe('Contado')
  })
})

describe('defaultAnticipoOC (D1)', () => {
  it('proveedor con modo anticipo y % > 0 → OC marcada con ese %', () => {
    expect(defaultAnticipoOC({ modo_pago: 'anticipo', anticipo_pct: 30 }))
      .toEqual({ paga_con_anticipo: true, anticipo_pct: 30 })
  })
  it('proveedor anticipo sin % válido → no marca', () => {
    expect(defaultAnticipoOC({ modo_pago: 'anticipo', anticipo_pct: 0 }))
      .toEqual({ paga_con_anticipo: false, anticipo_pct: null })
    expect(defaultAnticipoOC({ modo_pago: 'anticipo', anticipo_pct: null }))
      .toEqual({ paga_con_anticipo: false, anticipo_pct: null })
  })
  it('otros modos / null → no marca', () => {
    expect(defaultAnticipoOC({ modo_pago: 'contado', anticipo_pct: 50 }).paga_con_anticipo).toBe(false)
    expect(defaultAnticipoOC(null).paga_con_anticipo).toBe(false)
  })
})

describe('montoAnticipo (D1)', () => {
  it('calcula total × pct/100 redondeado', () => {
    expect(montoAnticipo(1000, 30)).toBe(300)
    expect(montoAnticipo(1234.5, 10)).toBe(123.45)
  })
  it('pct/total inválidos → 0', () => {
    expect(montoAnticipo(1000, 0)).toBe(0)
    expect(montoAnticipo(1000, null)).toBe(0)
    expect(montoAnticipo(0, 30)).toBe(0)
  })
})

describe('schedule de pago (D2)', () => {
  const sched: CuotaSchedule[] = [
    { etiqueta: 'Seña', base: 'confirmacion', pct: 40 },
    { etiqueta: 'Saldo', base: 'dias', dias: 30, pct: 60 },
  ]

  it('totalPctSchedule suma porcentajes', () => {
    expect(totalPctSchedule(sched)).toBe(100)
    expect(totalPctSchedule([])).toBe(0)
    expect(totalPctSchedule(null)).toBe(0)
  })

  it('scheduleValido: suma 100 y bases correctas → válido', () => {
    expect(scheduleValido(sched)).toBe(true)
  })
  it('schedule vacío / null es válido (opcional)', () => {
    expect(scheduleValido([])).toBe(true)
    expect(scheduleValido(null)).toBe(true)
  })
  it('suma ≠ 100 → inválido', () => {
    expect(scheduleValido([{ base: 'confirmacion', pct: 50 }])).toBe(false)
  })
  it('cuota con pct ≤ 0 → inválido', () => {
    expect(scheduleValido([{ base: 'confirmacion', pct: 100 }, { base: 'recepcion', pct: 0 }])).toBe(false)
  })
  it("base 'dias' sin días > 0 → inválido", () => {
    expect(scheduleValido([{ base: 'dias', dias: 0, pct: 100 }])).toBe(false)
  })
  it('tolerancia de 0.5 en la suma', () => {
    expect(scheduleValido([{ base: 'confirmacion', pct: 33.33 }, { base: 'recepcion', pct: 33.33 }, { base: 'dias', dias: 30, pct: 33.34 }])).toBe(true)
  })

  it('montoCuota = total × pct/100', () => {
    expect(montoCuota(1000, 40)).toBe(400)
    expect(montoCuota(1000, 0)).toBe(0)
  })

  it('labelBaseCuota describe el disparador', () => {
    expect(labelBaseCuota({ base: 'confirmacion', pct: 50 })).toBe('Al confirmar la OC')
    expect(labelBaseCuota({ base: 'recepcion', pct: 50 })).toBe('Al recibir')
    expect(labelBaseCuota({ base: 'dias', dias: 45, pct: 50 })).toBe('A 45 días')
  })
})
