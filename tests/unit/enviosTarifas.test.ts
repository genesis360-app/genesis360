import { describe, it, expect } from 'vitest'
import {
  costoEnvioPropio, cobroCliente, envioGratis, diferenciaReal,
  normalizarReglasGratis, envioGratisAplica, describirReglaGratis,
} from '@/lib/enviosTarifas'

// Envíos EN4 — costos y tarifas

describe('costoEnvioPropio (B1/B2/B3)', () => {
  it('km × $/km × factor', () => {
    expect(costoEnvioPropio(10, { costoKm: 100, factorKm: 1.35 })).toBe(1350)
  })
  it('factor default 1.35 si no se pasa', () => {
    expect(costoEnvioPropio(10, { costoKm: 100 })).toBe(1350)
  })
  it('costo mínimo pisa el resultado', () => {
    expect(costoEnvioPropio(1, { costoKm: 100, factorKm: 1, costoMinimo: 500 })).toBe(500)
  })
  it('tramos escalonados ignoran el $/km', () => {
    const tramos = [{ hasta: 5, precio: 800 }, { hasta: 10, precio: 1200 }]
    expect(costoEnvioPropio(3, { costoKm: 999, tramos })).toBe(800)
    expect(costoEnvioPropio(8, { costoKm: 999, tramos })).toBe(1200)
    expect(costoEnvioPropio(50, { costoKm: 999, tramos })).toBe(1200) // sobre el último tramo
  })
  it('recargo por franja horaria suma', () => {
    const recargoHorario = [{ desde: '18:00', hasta: '22:00', recargo: 300 }]
    expect(costoEnvioPropio(10, { costoKm: 100, factorKm: 1, recargoHorario }, '19:30')).toBe(1300)
    expect(costoEnvioPropio(10, { costoKm: 100, factorKm: 1, recargoHorario }, '12:00')).toBe(1000)
  })
})

describe('cobroCliente (B4)', () => {
  it('cliente_100 → costo tal cual', () => {
    expect(cobroCliente(1000, 'cliente_100', {})).toBe(1000)
  })
  it('cliente_margen → costo + margen %', () => {
    expect(cobroCliente(1000, 'cliente_margen', { margenPct: 20 })).toBe(1200)
  })
  it('subsidio → gratis si la venta supera el umbral', () => {
    expect(cobroCliente(1000, 'subsidio', { subsidioUmbral: 50000 }, 60000)).toBe(0)
    expect(cobroCliente(1000, 'subsidio', { subsidioUmbral: 50000 }, 40000)).toBe(1000)
  })
})

describe('envioGratis (B5)', () => {
  it('gratis por monto mínimo', () => {
    expect(envioGratis({ montoMinimo: 50000 }, { totalVenta: 60000 })).toBe(true)
    expect(envioGratis({ montoMinimo: 50000 }, { totalVenta: 40000 })).toBe(false)
  })
  it('gratis por etiqueta de cliente (case-insensitive)', () => {
    expect(envioGratis({ etiquetas: ['Mayorista'] }, { etiquetasCliente: ['mayorista'] })).toBe(true)
    expect(envioGratis({ etiquetas: ['VIP'] }, { etiquetasCliente: ['Minorista'] })).toBe(false)
  })
  it('gratis por promo vigente', () => {
    expect(envioGratis({ promoDesde: '2026-06-01', promoHasta: '2026-06-30' }, { fecha: '2026-06-15' })).toBe(true)
    expect(envioGratis({ promoDesde: '2026-06-01', promoHasta: '2026-06-30' }, { fecha: '2026-07-01' })).toBe(false)
  })
  it('sin reglas → no gratis', () => {
    expect(envioGratis(null, { totalVenta: 999999 })).toBe(false)
  })
})

describe('diferenciaReal (B6)', () => {
  it('real menor → a favor', () => {
    expect(diferenciaReal(1000, 800)).toEqual({ tipo: 'a_favor', monto: 200 })
  })
  it('real mayor → pérdida', () => {
    expect(diferenciaReal(1000, 1300)).toEqual({ tipo: 'perdida', monto: 300 })
  })
  it('diferencia despreciable → neutro', () => {
    expect(diferenciaReal(1000, 1000.2)).toEqual({ tipo: 'neutro', monto: 0 })
  })
})

// ── B5 v2 — envío gratis multi-regla (punto 7 backlog Fede/GO) ───────────────────────────

describe('normalizarReglasGratis', () => {
  it('shape nuevo { reglas: [...] } pasa con saneo', () => {
    const out = normalizarReglasGratis({ reglas: [{ montoMinimo: 50000, maxKm: 10 }] })
    expect(out).toEqual([{ montoMinimo: 50000, etiquetas: null, desde: null, hasta: null, maxKm: 10 }])
  })
  it('shape legacy (plano, semántica OR) se parte en reglas independientes', () => {
    const out = normalizarReglasGratis({ montoMinimo: 50000, etiquetas: ['VIP'], promoDesde: '2026-06-01', promoHasta: '2026-06-30' })
    expect(out).toHaveLength(3)
    expect(out[0].montoMinimo).toBe(50000)
    expect(out[1].etiquetas).toEqual(['VIP'])
    expect(out[2]).toMatchObject({ desde: '2026-06-01', hasta: '2026-06-30' })
  })
  it('reglas vacías / basura → []', () => {
    expect(normalizarReglasGratis(null)).toEqual([])
    expect(normalizarReglasGratis({})).toEqual([])
    expect(normalizarReglasGratis({ reglas: [{}] })).toEqual([])          // regla sin condiciones se descarta
    expect(normalizarReglasGratis({ montoMinimo: 0 })).toEqual([])
  })
})

describe('envioGratisAplica (AND adentro de la regla, OR entre reglas)', () => {
  it('regla con monto Y km: ambas deben cumplirse', () => {
    const reglas = [{ montoMinimo: 50000, maxKm: 10 }]
    expect(envioGratisAplica(reglas, { totalVenta: 60000, km: 5 }).aplica).toBe(true)
    expect(envioGratisAplica(reglas, { totalVenta: 60000, km: 15 }).aplica).toBe(false)  // lejos
    expect(envioGratisAplica(reglas, { totalVenta: 40000, km: 5 }).aplica).toBe(false)   // poca compra
  })
  it('km desconocido con regla de maxKm → NO aplica (fail-closed)', () => {
    expect(envioGratisAplica([{ montoMinimo: 1000, maxKm: 10 }], { totalVenta: 5000, km: null }).aplica).toBe(false)
  })
  it('OR entre reglas: la segunda salva', () => {
    const reglas = [{ montoMinimo: 999999 }, { etiquetas: ['VIP'] }]
    const r = envioGratisAplica(reglas, { totalVenta: 100, etiquetasCliente: ['vip'] })
    expect(r.aplica).toBe(true)
    expect(r.regla?.etiquetas).toEqual(['VIP'])
  })
  it('vigencia por fecha inclusive', () => {
    const reglas = [{ desde: '2026-07-01', hasta: '2026-07-31' }]
    expect(envioGratisAplica(reglas, { fecha: '2026-07-31' }).aplica).toBe(true)
    expect(envioGratisAplica(reglas, { fecha: '2026-08-01' }).aplica).toBe(false)
    expect(envioGratisAplica(reglas, { fecha: undefined }).aplica).toBe(false)
  })
  it('sin reglas → nunca gratis', () => {
    expect(envioGratisAplica([], { totalVenta: 999999 }).aplica).toBe(false)
  })
})

describe('describirReglaGratis', () => {
  it('combina condiciones en texto humano', () => {
    expect(describirReglaGratis({ montoMinimo: 50000, maxKm: 10 })).toBe('compras desde $50.000 · hasta 10 km')
    expect(describirReglaGratis({ etiquetas: ['VIP', 'Mayorista'] })).toBe('clientes VIP/Mayorista')
  })
})
