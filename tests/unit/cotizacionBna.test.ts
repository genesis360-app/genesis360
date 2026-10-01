import { describe, it, expect } from 'vitest'
import {
  normalizarVigente, tasaUsdAArs, hoyArgentina, avisoCotizacion, fechaCorta, DIAS_COTIZACION_VIEJA,
} from '@/lib/cotizacionBna'

// D-1 fase 2 (GO, 2026-09-25): la UNA tasa USD→ARS = vendedor divisa BNA del día hábil anterior.

describe('normalizarVigente', () => {
  it('toma la fila de la RPC (array) y parsea el numeric que llega como string', () => {
    expect(normalizarVigente([{ fecha: '2026-09-25', compra: '1516.5000', venta: '1525.5000' }]))
      .toEqual({ fecha: '2026-09-25', venta: 1525.5 })
  })
  it('acepta un objeto suelto (la respuesta `vigente` de la EF)', () => {
    expect(normalizarVigente({ fecha: '2026-09-25', venta: 1525.5 })).toEqual({ fecha: '2026-09-25', venta: 1525.5 })
  })
  it('usa la VENTA, nunca la compra', () => {
    expect(normalizarVigente({ fecha: '2026-09-25', compra: 1516.5, venta: 1525.5 })?.venta).toBe(1525.5)
  })
  it('sin fila, venta 0/negativa/no numérica o fecha inválida → null (D5: no se inventa)', () => {
    expect(normalizarVigente([])).toBeNull()
    expect(normalizarVigente(null)).toBeNull()
    expect(normalizarVigente({ fecha: '2026-09-25', venta: 0 })).toBeNull()
    expect(normalizarVigente({ fecha: '2026-09-25', venta: -3 })).toBeNull()
    expect(normalizarVigente({ fecha: '2026-09-25', venta: 'abc' })).toBeNull()
    expect(normalizarVigente({ fecha: 'ayer', venta: 1500 })).toBeNull()
  })
})

describe('tasaUsdAArs', () => {
  it('devuelve la venta de la vigente', () => {
    expect(tasaUsdAArs({ fecha: '2026-09-25', venta: 1525.5 })).toBe(1525.5)
  })
  it('sin vigente devuelve 0, para que el llamador frene', () => {
    expect(tasaUsdAArs(null)).toBe(0)
    expect(tasaUsdAArs(undefined)).toBe(0)
  })
  it('🔑 precio y pago en dólares usan la MISMA tasa: no hay vuelto fantasma', () => {
    const t = tasaUsdAArs({ fecha: '2026-09-25', venta: 1525.5 })
    expect(100 * t - 100 * t).toBe(0)
  })
})

describe('hoyArgentina', () => {
  it('usa la hora de Argentina, no UTC: 01:30 UTC del 26 todavía es 25 en AR', () => {
    expect(hoyArgentina(new Date('2026-09-26T01:30:00Z'))).toBe('2026-09-25')
    expect(hoyArgentina(new Date('2026-09-26T03:30:00Z'))).toBe('2026-09-26')
  })
})

describe('avisoCotizacion', () => {
  const v = { fecha: '2026-09-25', venta: 1525.5 }
  it('sin cotización → sin_cotizacion', () => {
    expect(avisoCotizacion(null, false, '2026-09-26')?.tipo).toBe('sin_cotizacion')
  })
  it('al día y la captura anduvo → sin aviso', () => {
    expect(avisoCotizacion(v, false, '2026-09-26')).toBeNull()
  })
  it('lunes con la del viernes → sin aviso (fin de semana)', () => {
    expect(avisoCotizacion({ fecha: '2026-09-25', venta: 1 }, false, '2026-09-28')).toBeNull()
  })
  it('martes post-feriado del lunes con la del viernes → sin aviso', () => {
    expect(avisoCotizacion({ fecha: '2026-09-25', venta: 1 }, false, '2026-09-29')).toBeNull()
  })
  it(`${DIAS_COTIZACION_VIEJA}+ días → vieja, con la fecha`, () => {
    const a = avisoCotizacion(v, false, '2026-09-30')
    expect(a?.tipo).toBe('vieja')
    expect(a?.texto).toContain('25/09')
  })
  it('la captura de hoy falló → se sigue con la anterior y se dice de qué día es (A-2)', () => {
    const a = avisoCotizacion(v, true, '2026-09-26')
    expect(a?.tipo).toBe('captura_fallida')
    expect(a?.texto).toContain('25/09')
  })
})

describe('fechaCorta', () => {
  it('2026-09-05 → 05/09', () => expect(fechaCorta('2026-09-05')).toBe('05/09'))
})
