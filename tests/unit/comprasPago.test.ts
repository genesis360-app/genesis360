import { describe, it, expect } from 'vitest'
import {
  labelModoPago, defaultAnticipoOC, montoAnticipo,
  totalPctSchedule, scheduleValido, montoCuota, labelBaseCuota,
  convertirMontoAMonedaOC, desvioCotizacionFuerte,
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

// Compras/Gastos en USD (mig 381) — B3/C1: pago con descalce de moneda. Espejo JS de la conversión
// que hace registrar_pago_oc server-side — mismo escenario que verificó migration-reviewer a mano.
describe('convertirMontoAMonedaOC (B3/C1, mig 381)', () => {
  it('misma moneda → no convierte, cotización ni se usa', () => {
    expect(convertirMontoAMonedaOC(1000, 'ARS', 'ARS', null)).toBe(1000)
    expect(convertirMontoAMonedaOC(100, 'USD', 'USD', undefined)).toBe(100)
  })
  it('medio en ARS, OC en USD → divide por la cotización', () => {
    expect(convertirMontoAMonedaOC(145000, 'ARS', 'USD', 1450)).toBe(100)
  })
  it('medio en USD, OC en ARS → multiplica por la cotización', () => {
    expect(convertirMontoAMonedaOC(100, 'USD', 'ARS', 1450)).toBe(145000)
  })
  it('descalce sin cotización válida → NaN (para que el caller lo detecte y bloquee)', () => {
    expect(convertirMontoAMonedaOC(145000, 'ARS', 'USD', null)).toBeNaN()
    expect(convertirMontoAMonedaOC(145000, 'ARS', 'USD', 0)).toBeNaN()
    expect(convertirMontoAMonedaOC(145000, 'ARS', 'USD', -1)).toBeNaN()
  })
  it('nunca redondea (H1)', () => {
    expect(convertirMontoAMonedaOC(100, 'ARS', 'USD', 3)).toBeCloseTo(33.333333, 5)
  })
})

describe('desvioCotizacionFuerte (B3)', () => {
  it('sin referencia → nunca avisa (no bloqueante, no hay con qué comparar)', () => {
    expect(desvioCotizacionFuerte(1450, null)).toBe(false)
    expect(desvioCotizacionFuerte(1450, undefined)).toBe(false)
    expect(desvioCotizacionFuerte(1450, 0)).toBe(false)
  })
  it('dentro del 20% de la referencia → no avisa', () => {
    expect(desvioCotizacionFuerte(1450, 1400)).toBe(false)  // ~3.6%
    expect(desvioCotizacionFuerte(1650, 1400)).toBe(false)  // ~17.9%, límite justo debajo
  })
  it('20% o más de la referencia → avisa (para arriba y para abajo)', () => {
    expect(desvioCotizacionFuerte(1680, 1400)).toBe(true)   // +20%
    expect(desvioCotizacionFuerte(1120, 1400)).toBe(true)   // -20%
    expect(desvioCotizacionFuerte(2000, 1400)).toBe(true)
  })
})
