import { describe, it, expect } from 'vitest'
import {
  diaHabilAnterior, aFechaISO, convertirGastoAMonedaLibro, gastosSinCotizacion,
} from '@/lib/cotizacionFiscal'

// ⚠️ Criterio contable PENDIENTE de validar con un contador matriculado (ver el encabezado de
// `src/lib/cotizacionFiscal.ts`). Estos tests fijan el comportamiento acordado mientras tanto.

describe('diaHabilAnterior — BNA vendedor del día hábil ANTERIOR', () => {
  it('un martes devuelve el lunes', () => {
    // 2026-09-15 es martes
    expect(aFechaISO(diaHabilAnterior('2026-09-15'))).toBe('2026-09-14')
  })

  it('un LUNES devuelve el viernes, no el domingo', () => {
    // 2026-09-14 es lunes → 13 sábado, 12 viernes
    expect(aFechaISO(diaHabilAnterior('2026-09-14'))).toBe('2026-09-11')
  })

  it('un domingo devuelve el viernes', () => {
    expect(aFechaISO(diaHabilAnterior('2026-09-13'))).toBe('2026-09-11')
  })

  it('un sábado devuelve el viernes', () => {
    expect(aFechaISO(diaHabilAnterior('2026-09-12'))).toBe('2026-09-11')
  })

  it('cruza el fin de mes sin romperse', () => {
    // 2026-09-01 es martes → lunes 31/08
    expect(aFechaISO(diaHabilAnterior('2026-09-01'))).toBe('2026-08-31')
  })

  it('una fecha inválida no devuelve una fecha cualquiera', () => {
    expect(aFechaISO(diaHabilAnterior('no-es-fecha'))).toBe('')
  })
})

describe('convertirGastoAMonedaLibro', () => {
  it('un gasto que ya está en la moneda del libro pasa sin tocar', () => {
    const r = convertirGastoAMonedaLibro({ monto: 1000, iva_monto: 210, moneda: 'ARS' }, 'ARS')
    expect(r).toEqual({ monto: 1000, iva: 210, convertido: false, problema: null })
  })

  it('convierte monto E IVA con la misma tasa', () => {
    // El `iva_monto` está expresado en la moneda del gasto, así que va por la misma cotización.
    const r = convertirGastoAMonedaLibro(
      { monto: 100, iva_monto: 21, moneda: 'USD', cotizacion_fiscal: 1530 }, 'ARS')
    expect(r.monto).toBe(153000)
    expect(r.iva).toBe(32130)
    expect(r.convertido).toBe(true)
  })

  it('🛑 sin cotización NO inventa una tasa: devuelve el problema', () => {
    const r = convertirGastoAMonedaLibro({ monto: 100, iva_monto: 21, moneda: 'USD' }, 'ARS')
    expect(r.problema).toBe('sin_cotizacion')
    expect(r.monto).toBe(0)
    expect(r.iva).toBe(0)
  })

  it('una cotización en 0 cuenta como ausente, no como "vale cero"', () => {
    expect(convertirGastoAMonedaLibro(
      { monto: 100, moneda: 'USD', cotizacion_fiscal: 0 }, 'ARS').problema).toBe('sin_cotizacion')
  })

  it('el numeric de Postgres llega como string y se suma igual', () => {
    const r = convertirGastoAMonedaLibro(
      { monto: '100.50', iva_monto: '21.10', moneda: 'USD', cotizacion_fiscal: '1000.0000' }, 'ARS')
    expect(r.monto).toBe(100500)
    expect(r.iva).toBe(21100)
  })

  it('un gasto sin moneda se asume en la del libro', () => {
    expect(convertirGastoAMonedaLibro({ monto: 50 }, 'ARS').convertido).toBe(false)
  })

  it('funciona con un libro que no sea ARS', () => {
    const r = convertirGastoAMonedaLibro(
      { monto: 10, iva_monto: 2, moneda: 'USD', cotizacion_fiscal: 900 }, 'CLP')
    expect(r.monto).toBe(9000)
  })
})

describe('gastosSinCotizacion — lo que queda FUERA del libro', () => {
  it('agrupa por moneda y suma el IVA que no entra', () => {
    const r = gastosSinCotizacion([
      { monto: 100, iva_monto: 21, moneda: 'USD' },
      { monto: 200, iva_monto: 42, moneda: 'USD' },
      { monto: 50, iva_monto: 10, moneda: 'EUR' },
      { monto: 1000, iva_monto: 210, moneda: 'ARS' },                       // entra: es del libro
      { monto: 300, iva_monto: 63, moneda: 'USD', cotizacion_fiscal: 1500 },// entra: tiene tasa
    ], 'ARS')
    expect(r).toEqual([
      { moneda: 'EUR', cantidad: 1, iva: 10 },
      { moneda: 'USD', cantidad: 2, iva: 63 },
    ])
  })

  it('sin gastos problemáticos devuelve vacío (control anti-vacío del caso feliz)', () => {
    expect(gastosSinCotizacion([{ monto: 1, iva_monto: 1, moneda: 'ARS' }], 'ARS')).toEqual([])
    expect(gastosSinCotizacion([], 'ARS')).toEqual([])
  })
})
