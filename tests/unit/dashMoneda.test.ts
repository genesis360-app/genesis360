import { describe, it, expect } from 'vitest'
import {
  convDash, symDash, fmtDash, fmtUsdDash,
  sumarPorMonedaNativa, aVistaPesos, totalDelModo, separarVentasUsd, usdCobradoDeMedioPago,
} from '@/lib/dashMoneda'

// Plan: G1 — "modo real" del Dashboard (3ra opción del filtro Moneda, pedido de Fede).
// Referencia del criterio: [[reference_dashboard_calculos_money]] + REGLA #0.

// ─────────────────────────────────────────────────────────────────────────────
// Formato y conversión (DM-FMT)
// ─────────────────────────────────────────────────────────────────────────────
describe('convDash / symDash / fmtDash', () => {
  it('DM-FMT-01 ARS no convierte', () => {
    expect(convDash('ARS', 1500)).toBe(1)
    expect(symDash('ARS')).toBe('$')
  })
  it('DM-FMT-02 USD divide por la cotización de hoy', () => {
    expect(convDash('USD', 1500)).toBe(1500)
    expect(fmtDash(150000, 'USD', 1500)).toBe('U$D 100')
  })
  it('DM-FMT-03 REAL nunca convierte, aunque haya cotización cargada', () => {
    expect(convDash('REAL', 1500)).toBe(1)
    expect(symDash('REAL')).toBe('$')
    expect(fmtDash(150000, 'REAL', 1500)).toBe(fmtDash(150000, 'ARS', 1500))
  })
  it('DM-FMT-04 USD sin cotización cargada NO divide por 0 ni por 1 en silencio: cae a 1', () => {
    expect(convDash('USD', 0)).toBe(1)
    expect(Number.isFinite(parseFloat(fmtDash(150000, 'USD', 0).replace(/\D/g, '')))).toBe(true)
  })
  it('DM-FMT-05 fmtUsdDash marca dólares de verdad, sin convertir', () => {
    expect(fmtUsdDash(450)).toBe('US$450')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sumarPorMonedaNativa (DM-SUM) — la pata que hoy NO existe en DashGastosArea
// ─────────────────────────────────────────────────────────────────────────────
describe('sumarPorMonedaNativa', () => {
  const rows = [
    { monto: 1000, moneda: 'ARS' },
    { monto: 100, moneda: 'USD' },
    { monto: 500, moneda: 'ARS' },
    { monto: 50, moneda: 'USD' },
  ]
  it('DM-SUM-01 nunca mezcla monedas en un solo acumulador', () => {
    const s = sumarPorMonedaNativa(rows, r => r.monto, r => r.moneda)
    expect(s).toEqual({ ars: 1500, usd: 150, cantArs: 2, cantUsd: 2 })
  })
  it('DM-SUM-02 el numeric de Postgres llega como string y se normaliza', () => {
    const s = sumarPorMonedaNativa(
      [{ monto: '1000.50', moneda: 'ARS' }, { monto: '100.25', moneda: 'USD' }],
      r => r.monto, r => r.moneda,
    )
    expect(s.ars).toBeCloseTo(1000.5, 2)
    expect(s.usd).toBeCloseTo(100.25, 2)
  })
  it('DM-SUM-03 moneda ausente/null cuenta como pesos (default de la DB)', () => {
    const s = sumarPorMonedaNativa(
      [{ monto: 100, moneda: null }, { monto: 200, moneda: undefined }],
      r => r.monto, r => r.moneda,
    )
    expect(s).toEqual({ ars: 300, usd: 0, cantArs: 2, cantUsd: 0 })
  })
  it('DM-SUM-04 "usd" en minúscula también es dólares', () => {
    const s = sumarPorMonedaNativa([{ monto: 10, moneda: 'usd' }], r => r.monto, r => r.moneda)
    expect(s.usd).toBe(10)
  })
  it('DM-SUM-05 lista vacía o nula no rompe', () => {
    expect(sumarPorMonedaNativa(null, (r: any) => r.monto, (r: any) => r.moneda))
      .toEqual({ ars: 0, usd: 0, cantArs: 0, cantUsd: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// aVistaPesos / totalDelModo (DM-VP) — REGLA #0: plata que no se puede convertir NO desaparece
// ─────────────────────────────────────────────────────────────────────────────
describe('aVistaPesos', () => {
  it('DM-VP-01 convierte los dólares a la cotización dada y suma', () => {
    const r = aVistaPesos({ ars: 1000, usd: 100, cantArs: 1, cantUsd: 1 }, 1500)
    expect(r).toEqual({ total: 151000, usdSinConvertir: 0 })
  })
  it('DM-VP-02 sin cotización cargada NO suma dólares como si fueran pesos', () => {
    const r = aVistaPesos({ ars: 1000, usd: 100, cantArs: 1, cantUsd: 1 }, 0)
    expect(r.total).toBe(1000)
    expect(r.usdSinConvertir).toBe(100)
  })
  it('DM-VP-03 sin dólares, la cotización es irrelevante', () => {
    expect(aVistaPesos({ ars: 1000, usd: 0, cantArs: 1, cantUsd: 0 }, 0))
      .toEqual({ total: 1000, usdSinConvertir: 0 })
  })
})

describe('totalDelModo', () => {
  const s = { ars: 1000, usd: 100, cantArs: 1, cantUsd: 1 }
  it('DM-VP-04 ARS y USD parten de la vista en pesos (el modo divide después)', () => {
    expect(totalDelModo(s, 'ARS', 1500)).toBe(151000)
    expect(totalDelModo(s, 'USD', 1500)).toBe(151000)
  })
  it('DM-VP-05 REAL devuelve SOLO los pesos — los dólares van por su propio número', () => {
    expect(totalDelModo(s, 'REAL', 1500)).toBe(1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// separarVentasUsd (DM-VTA)
// ─────────────────────────────────────────────────────────────────────────────
describe('separarVentasUsd', () => {
  it('DM-VTA-01 separa por cotizacion_usd no nula', () => {
    const r = separarVentasUsd([
      { id: 'a', total: 1000, cotizacion_usd: null },
      { id: 'b', total: 688500, cotizacion_usd: 1530 },
      { id: 'c', total: 500 },
    ])
    expect(r.ars.map(v => v.id)).toEqual(['a', 'c'])
    expect(r.conUsd.map(v => v.id)).toEqual(['b'])
  })
  it('DM-VTA-02 el numeric string también cuenta como venta con USD', () => {
    const r = separarVentasUsd([{ id: 'b', cotizacion_usd: '1530.00' }])
    expect(r.conUsd).toHaveLength(1)
  })
  it('DM-VTA-03 una cotización en 0 no es una venta en USD (no hubo conversión real)', () => {
    const r = separarVentasUsd([{ id: 'a', cotizacion_usd: 0 }])
    expect(r.ars).toHaveLength(1)
    expect(r.conUsd).toHaveLength(0)
  })
  it('DM-VTA-04 lista vacía o nula no rompe', () => {
    expect(separarVentasUsd(null)).toEqual({ ars: [], conUsd: [] })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// usdCobradoDeMedioPago (DM-MP) — la única cifra en dólares REALES de una venta
// ─────────────────────────────────────────────────────────────────────────────
describe('usdCobradoDeMedioPago', () => {
  it('DM-MP-01 suma el monto_usd de los medios en dólares', () => {
    const mp = JSON.stringify([
      { tipo: 'Efectivo USD', monto: 153000, monto_usd: 100 },
      { tipo: 'Efectivo', monto: 5000 },
    ])
    expect(usdCobradoDeMedioPago(mp)).toBe(100)
  })
  it('DM-MP-02 un medio sin monto_usd cuenta 0 — no se inventa dividiendo por la cotización', () => {
    const mp = JSON.stringify([{ tipo: 'Transferencia', monto: 688500 }])
    expect(usdCobradoDeMedioPago(mp)).toBe(0)
  })
  it('DM-MP-03 varios medios en dólares se acumulan', () => {
    const mp = JSON.stringify([
      { tipo: 'Efectivo USD', monto: 76500, monto_usd: 50 },
      { tipo: 'Efectivo USD', monto: 76500, monto_usd: '50.00' },
    ])
    expect(usdCobradoDeMedioPago(mp)).toBe(100)
  })
  it('DM-MP-04 JSON roto, null o forma inesperada devuelven 0 sin tirar', () => {
    expect(usdCobradoDeMedioPago('{no json')).toBe(0)
    expect(usdCobradoDeMedioPago(null)).toBe(0)
    expect(usdCobradoDeMedioPago('{"tipo":"Efectivo"}')).toBe(0)
  })
  it('DM-MP-05 acepta el array ya parseado, no solo el string', () => {
    expect(usdCobradoDeMedioPago([{ tipo: 'Efectivo USD', monto_usd: 25 }])).toBe(25)
  })
  it('DM-MP-06 un monto_usd negativo no resta del total cobrado', () => {
    expect(usdCobradoDeMedioPago([{ monto_usd: -50 }, { monto_usd: 10 }])).toBe(10)
  })
})
