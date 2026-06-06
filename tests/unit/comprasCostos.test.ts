import { describe, it, expect } from 'vitest'
import { cambioCostoPct, superaAlertaCosto, totalOCconAccesorios } from '@/lib/comprasCostos'

// Compras CO3 — costos (E1 alerta de cambio, E2 total con accesorios)

describe('cambioCostoPct (E1)', () => {
  it('subida del 25%', () => {
    expect(cambioCostoPct(100, 125)).toBe(25)
  })
  it('baja del 10%', () => {
    expect(cambioCostoPct(100, 90)).toBe(-10)
  })
  it('sin costo previo y hay nuevo → 100% (es nuevo)', () => {
    expect(cambioCostoPct(0, 50)).toBe(100)
  })
  it('sin costo previo ni nuevo → 0', () => {
    expect(cambioCostoPct(0, 0)).toBe(0)
  })
})

describe('superaAlertaCosto (E1)', () => {
  it('supera el umbral → true', () => {
    expect(superaAlertaCosto(100, 120, 10)).toBe(true)   // +20% >= 10%
    expect(superaAlertaCosto(100, 80, 10)).toBe(true)    // -20% >= 10%
  })
  it('no supera el umbral → false', () => {
    expect(superaAlertaCosto(100, 105, 10)).toBe(false)  // +5% < 10%
  })
  it('borde exacto → true', () => {
    expect(superaAlertaCosto(100, 110, 10)).toBe(true)
  })
  it('sin costo previo o sin costo nuevo → no alerta (no es cambio)', () => {
    expect(superaAlertaCosto(0, 50, 10)).toBe(false)
    expect(superaAlertaCosto(50, 0, 10)).toBe(false)
  })
})

describe('totalOCconAccesorios (E2)', () => {
  it('suma ítems + todos los accesorios', () => {
    expect(totalOCconAccesorios({ subtotalItems: 1000, costoEnvio: 100, costoAduana: 50, costoComision: 30, costoOtros: 20 })).toBe(1200)
  })
  it('accesorios nulos no rompen', () => {
    expect(totalOCconAccesorios({ subtotalItems: 1000 })).toBe(1000)
  })
})
