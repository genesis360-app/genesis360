import { describe, it, expect } from 'vitest'
import {
  agruparPagosPorCourier, desgloseIvaFlete, requiereDobleFirma,
  diffFactura, totalRegistrado, type EnvioPago,
} from '@/lib/enviosCourierPago'

// Envíos EN1 — pagos a courier contables + conciliación

const env = (id: string, courier: string | null, costo: number, suc: string | null = null): EnvioPago =>
  ({ id, courier, costo_cotizado: costo, sucursal_id: suc })

describe('agruparPagosPorCourier (C2)', () => {
  it('agrupa por courier, suma totales y junta ids', () => {
    const g = agruparPagosPorCourier([
      env('a', 'Andreani', 1000), env('b', 'OCA', 500), env('c', 'Andreani', 250),
    ])
    expect(g).toHaveLength(2)
    const andreani = g.find(x => x.courier === 'Andreani')!
    expect(andreani.total).toBe(1250)
    expect(andreani.ids).toEqual(['a', 'c'])
    expect(g.find(x => x.courier === 'OCA')!.total).toBe(500)
  })
  it('toma la primera sucursal no nula del grupo', () => {
    const g = agruparPagosPorCourier([env('a', 'OCA', 100, null), env('b', 'OCA', 100, 'suc-1')])
    expect(g[0].sucursalId).toBe('suc-1')
  })
  it('courier nulo/vacío cae a "Courier"', () => {
    expect(agruparPagosPorCourier([env('a', null, 100)])[0].courier).toBe('Courier')
    expect(agruparPagosPorCourier([env('a', '  ', 100)])[0].courier).toBe('Courier')
  })
  it('costo nulo cuenta como 0', () => {
    const g = agruparPagosPorCourier([{ id: 'a', courier: 'OCA', costo_cotizado: null }])
    expect(g[0].total).toBe(0)
  })
})

describe('desgloseIvaFlete (C2)', () => {
  it('extrae el IVA crédito fiscal de un monto bruto al 21%', () => {
    // 1210 bruto al 21% → neto 1000, iva 210
    expect(desgloseIvaFlete(1210, 21)).toEqual({ neto: 1000, iva: 210 })
  })
  it('pct 0 o monto 0 → sin IVA', () => {
    expect(desgloseIvaFlete(1000, 0)).toEqual({ neto: 1000, iva: 0 })
    expect(desgloseIvaFlete(0, 21)).toEqual({ neto: 0, iva: 0 })
  })
  it('redondea a 2 decimales', () => {
    const r = desgloseIvaFlete(1000, 21)
    expect(r.neto + r.iva).toBeCloseTo(1000, 2)
  })
})

describe('requiereDobleFirma (C4)', () => {
  it('umbral 0 → nunca exige', () => {
    expect(requiereDobleFirma(999999, 0)).toBe(false)
    expect(requiereDobleFirma(100, null)).toBe(false)
  })
  it('exige cuando total ≥ umbral', () => {
    expect(requiereDobleFirma(50000, 50000)).toBe(true)
    expect(requiereDobleFirma(60000, 50000)).toBe(true)
    expect(requiereDobleFirma(49999, 50000)).toBe(false)
  })
})

describe('diffFactura (C3)', () => {
  it('sin diferencia dentro de tolerancia', () => {
    expect(diffFactura(1000, 1000)).toEqual({ diff: 0, hayDiferencia: false, pct: 0 })
  })
  it('courier facturó de más → diff positiva, alerta', () => {
    const r = diffFactura(1200, 1000)
    expect(r.diff).toBe(200)
    expect(r.hayDiferencia).toBe(true)
    expect(r.pct).toBe(20)
  })
  it('courier facturó de menos → diff negativa', () => {
    expect(diffFactura(900, 1000).diff).toBe(-100)
  })
  it('registrado 0 con facturado > 0 → 100%', () => {
    expect(diffFactura(500, 0).pct).toBe(100)
  })
})

describe('totalRegistrado (C3)', () => {
  it('suma el costo cotizado de los envíos', () => {
    expect(totalRegistrado([env('a', 'OCA', 100), env('b', 'OCA', 250.5)])).toBe(350.5)
  })
})
