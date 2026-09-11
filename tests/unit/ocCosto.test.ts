import { describe, it, expect } from 'vitest'
import { costoSugeridoOC, productoEsUsd } from '@/lib/ocCosto'

// Plan: bug reportado por Fede (2026-09-11) — "en la orden de compra no permite poner el valor por
// unidad en USD, lo convierte automáticamente a $".
// Datos reales de DEV al momento del fix: 5 productos con moneda_costo='usd', costo nativo
// US$99,99–150 y mirror ARS 150.985–231.750. Con el bug, una OC en USD por 1 unidad del primero
// quedaba en US$150.985 en vez de US$99,99.

const COTIZ = 1510  // ~la relación real entre el mirror y el nativo en los datos de DEV

const prodUsd  = { precio_costo: 150985, precio_costo_usd: 99.99, moneda_costo: 'usd' }
const prodArs  = { precio_costo: 28290, precio_costo_usd: null, moneda_costo: 'local' }

describe('productoEsUsd', () => {
  it('OCC-USD-01 reconoce el producto priceado en dólares', () => {
    expect(productoEsUsd(prodUsd)).toBe(true)
    expect(productoEsUsd(prodArs)).toBe(false)
  })
  it('OCC-USD-02 sin moneda_costo cuenta como pesos (default del schema)', () => {
    expect(productoEsUsd({})).toBe(false)
    expect(productoEsUsd({ moneda_costo: null })).toBe(false)
  })
  it('OCC-USD-03 "USD" en mayúscula también', () => {
    expect(productoEsUsd({ moneda_costo: 'USD' })).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OC en USD (OCC-OCUSD) — el caso que estaba roto
// ─────────────────────────────────────────────────────────────────────────────
describe('costoSugeridoOC — OC en dólares', () => {
  it('🛑 OCC-OCUSD-01 producto en USD → su valor NATIVO, nunca el mirror en pesos', () => {
    const r = costoSugeridoOC(prodUsd, 'USD', COTIZ)
    expect(r.valor).toBe(99.99)
    expect(r.convertido).toBe(false)
    // El bug: precargaba 150985, que la OC después mostraba como US$150.985.
    expect(r.valor).not.toBe(150985)
  })

  it('OCC-OCUSD-02 producto en pesos → se convierte, y se avisa que fue convertido', () => {
    const r = costoSugeridoOC(prodArs, 'USD', COTIZ)
    expect(r.valor).toBeCloseTo(28290 / 1510, 2)
    expect(r.convertido).toBe(true)
  })

  it('🛑 OCC-OCUSD-03 producto en pesos SIN cotización → NO precarga (no mete pesos como dólares)', () => {
    const r = costoSugeridoOC(prodArs, 'USD', 0)
    expect(r.valor).toBeNull()
    expect(r.motivo).toBe('sin_cotizacion')
  })

  it('OCC-OCUSD-04 producto en USD sin cotización → funciona igual: no hace falta convertir', () => {
    expect(costoSugeridoOC(prodUsd, 'USD', 0).valor).toBe(99.99)
  })

  it('OCC-OCUSD-05 producto sin costo cargado → null con motivo, no 0', () => {
    const r = costoSugeridoOC({ precio_costo: 0, moneda_costo: 'local' }, 'USD', COTIZ)
    expect(r.valor).toBeNull()
    expect(r.motivo).toBe('sin_costo')
  })

  it('OCC-OCUSD-06 marcado como usd pero sin precio_costo_usd → cae a convertir el mirror', () => {
    const r = costoSugeridoOC({ precio_costo: 151000, precio_costo_usd: null, moneda_costo: 'usd' }, 'USD', COTIZ)
    expect(r.valor).toBeCloseTo(100, 0)
    expect(r.convertido).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// OC en pesos (OCC-OCARS) — no se rompe lo que ya andaba
// ─────────────────────────────────────────────────────────────────────────────
describe('costoSugeridoOC — OC en pesos', () => {
  it('OCC-OCARS-01 producto en pesos → su costo, sin convertir', () => {
    const r = costoSugeridoOC(prodArs, 'ARS', COTIZ)
    expect(r).toEqual({ valor: 28290, convertido: false })
  })

  it('OCC-OCARS-02 producto en USD → el mirror en pesos, que YA está calculado (no se reconvierte)', () => {
    const r = costoSugeridoOC(prodUsd, 'ARS', COTIZ)
    expect(r.valor).toBe(150985)
    expect(r.convertido).toBe(false)
  })

  it('OCC-OCARS-03 producto en USD sin mirror → se convierte el nativo', () => {
    const r = costoSugeridoOC({ precio_costo: 0, precio_costo_usd: 100, moneda_costo: 'usd' }, 'ARS', COTIZ)
    expect(r.valor).toBe(151000)
    expect(r.convertido).toBe(true)
  })

  it('OCC-OCARS-04 sin mirror y sin cotización → null, no un 0 que parezca gratis', () => {
    const r = costoSugeridoOC({ precio_costo: 0, precio_costo_usd: 100, moneda_costo: 'usd' }, 'ARS', 0)
    expect(r.valor).toBeNull()
    expect(r.motivo).toBe('sin_cotizacion')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Robustez (OCC-ROB)
// ─────────────────────────────────────────────────────────────────────────────
describe('costoSugeridoOC — bordes', () => {
  it('OCC-ROB-01 el numeric de Postgres llega como string', () => {
    const r = costoSugeridoOC({ precio_costo: '150985.00', precio_costo_usd: '99.99', moneda_costo: 'usd' }, 'USD', COTIZ)
    expect(r.valor).toBe(99.99)
  })
  it('OCC-ROB-02 producto null/undefined no rompe', () => {
    expect(costoSugeridoOC(null, 'USD', COTIZ).valor).toBeNull()
    expect(costoSugeridoOC(undefined, 'ARS', COTIZ).valor).toBeNull()
  })
  it('OCC-ROB-03 la ida y vuelta cierra dentro del redondeo a centavos, no exacto', () => {
    // Usar UNA sola tasa garantiza que no haya spread, pero el valor sugerido se redondea a 2
    // decimales (un precio en dólares tiene centavos), y eso solo ya mueve el número al volver:
    // 28290/1510 = 18,7351… → 18,74 → ×1510 = 28.297,40.
    // El techo del error es medio centavo de dólar por la cotización. Se deja escrito para que
    // nadie lea la diferencia como un bug de conversión: es el redondeo, y es acotado.
    const aUsd = costoSugeridoOC(prodArs, 'USD', COTIZ).valor!
    const vuelta = costoSugeridoOC(
      { precio_costo: 0, precio_costo_usd: aUsd, moneda_costo: 'usd' }, 'ARS', COTIZ,
    ).valor!
    const techoDelRedondeo = COTIZ / 200        // 0,005 USD × cotización = $7,55
    expect(Math.abs(vuelta - 28290)).toBeLessThanOrEqual(techoDelRedondeo)
  })
})
