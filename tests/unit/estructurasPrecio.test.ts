import { describe, it, expect } from 'vitest'
import { precioPresentacion, nivelesAPayload, validarNiveles, type NivelForm } from '@/lib/estructuras'

// Rediseño UoM Fase 2-bis chunk 2 (mig 307) — el empaque es LOGÍSTICA PURA, sin precio propio.
// El precio de una presentación es SIEMPRE precio_base (por unidad) × factor_base; se eliminaron
// los overrides de precio por nivel/presentación (mig 286/287/304). El precio por volumen se
// expresa con tiers (mig 306, src/lib/tiers.ts), NO con un override de bulto.

describe('precioPresentacion', () => {
  it('presentación base (factor 1) → devuelve el precio base', () => {
    expect(precioPresentacion(100, 1)).toBe(100)
  })

  it('deriva SIEMPRE del precio base × factor_base', () => {
    // Base $100/unidad. Caja ×12 → 1200. Pallet ×480 → 48000.
    expect(precioPresentacion(100, 12)).toBe(1200)
    expect(precioPresentacion(100, 480)).toBe(48000)
  })

  it('redondea a 2 decimales al derivar (drift controlado)', () => {
    // Base 583.33 (Coca back-calc). Caja ×6 → 3499.98; Pallet ×162 → 94499.46.
    expect(precioPresentacion(583.33, 6)).toBe(3499.98)
    expect(precioPresentacion(583.33, 162)).toBe(94499.46)
  })

  it('funciona igual para costo (misma función, es solo un número)', () => {
    expect(precioPresentacion(60, 12)).toBe(720)
  })
})

describe('nivelesAPayload — empaque sin precio (mig 307)', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '' }

  it('el payload NO incluye precio_venta/precio_costo (empaque logística pura)', () => {
    // índice 0 = base (factor forzado a 1); índice 1 = Caja ×12
    const payload = nivelesAPayload([base, { ...base, unidad_medida_id: 'u2', factor: '12' }])
    for (const p of payload) {
      expect(p).not.toHaveProperty('precio_venta')
      expect(p).not.toHaveProperty('precio_costo')
    }
    expect(payload[1].factor).toBe(12)
  })
})

describe('validarNiveles — ya no valida precio por nivel', () => {
  const base: NivelForm = { unidad_medida_id: 'u1', factor: '1', peso: '', alto: '', ancho: '', largo: '' }

  it('un nivel base válido pasa', () => {
    expect(validarNiveles([base])).toBeNull()
  })
  it('sigue validando factor entero ≥ 1 de los niveles no-base', () => {
    expect(validarNiveles([base, { ...base, unidad_medida_id: 'u2', factor: '0' }])).toMatch(/factor/)
  })
})
