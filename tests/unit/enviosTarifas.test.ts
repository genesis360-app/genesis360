import { describe, it, expect } from 'vitest'
import {
  costoEnvioPropio, cobroCliente, envioGratis, diferenciaReal,
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
