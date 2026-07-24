import { describe, it, expect } from 'vitest'
import { precioPresentacion, nivelesAPayload, validarNiveles, type NivelForm } from '@/lib/estructuras'

// Rediseño UoM Fase 2 (mig 304) — precio canónico por unidad BASE + overrides por presentación.
// Reemplaza el modelo de ancla por posición (precioEfectivoNivel/ordenAnclaEfectivo, mig 286/287),
// que se eliminó junto con productos.nivel_precio_orden (bug F3).

describe('precioPresentacion', () => {
  it('presentación base (factor 1) → devuelve el precio base', () => {
    expect(precioPresentacion(100, 1, null)).toBe(100)
  })

  it('sin override → deriva del precio base × factor_base', () => {
    // Base $100/unidad. Caja ×12 → 1200. Pallet ×480 → 48000.
    expect(precioPresentacion(100, 12, null)).toBe(1200)
    expect(precioPresentacion(100, 480, null)).toBe(48000)
  })

  it('con override → se usa tal cual, sin importar el factor', () => {
    expect(precioPresentacion(100, 12, 1080)).toBe(1080)
  })

  it('override de un nivel NO afecta a otros (cada presentación es independiente)', () => {
    // La Caja tiene override 5000, pero el Pallet (sin override) sigue derivando del base.
    expect(precioPresentacion(100, 12, 5000)).toBe(5000)
    expect(precioPresentacion(100, 480, null)).toBe(48000)
  })

  it('redondea a 2 decimales al derivar (drift controlado)', () => {
    // Base 583.33 (Coca back-calc). Caja ×6 → 3499.98; Pallet ×162 → 94499.46.
    expect(precioPresentacion(583.33, 6, null)).toBe(3499.98)
    expect(precioPresentacion(583.33, 162, null)).toBe(94499.46)
  })

  it('override 0 es válido (no se confunde con null/derivar)', () => {
    expect(precioPresentacion(100, 12, 0)).toBe(0)
  })

  it('funciona igual para costo (misma función, es solo un número)', () => {
    expect(precioPresentacion(60, 12, null)).toBe(720)
  })
})

describe('nivelesAPayload — precio_venta/precio_costo', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '', precioVenta: '', precioCosto: '' }

  it('vacío → null (deriva del base)', () => {
    const [p] = nivelesAPayload([base])
    expect(p.precio_venta).toBeNull()
    expect(p.precio_costo).toBeNull()
  })
  it('con valor → se manda como number (override)', () => {
    const [p] = nivelesAPayload([{ ...base, precioVenta: '1080', precioCosto: '650' }])
    expect(p.precio_venta).toBe(1080)
    expect(p.precio_costo).toBe(650)
  })
})

describe('validarNiveles — precio_venta/precio_costo negativos', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '', precioVenta: '', precioCosto: '' }

  it('precio negativo rechaza', () => {
    expect(validarNiveles([{ ...base, precioVenta: '-10' }])).toMatch(/precio de venta/)
  })
  it('costo negativo rechaza', () => {
    expect(validarNiveles([{ ...base, precioCosto: '-1' }])).toMatch(/costo/)
  })
  it('0 es válido (no negativo)', () => {
    expect(validarNiveles([{ ...base, precioVenta: '0', precioCosto: '0' }])).toBeNull()
  })
})
