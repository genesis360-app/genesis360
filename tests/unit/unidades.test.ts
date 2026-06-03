import { describe, it, expect } from 'vitest'
import { convertirUnidad, unidadesCompatibles, tieneConversion, formatUnidad } from '@/lib/unidades'

// Plan: tests/specs/inventario.plan.md

// ─────────────────────────────────────────────────────────────────────────────
// Sección 1 — Conversión (INV-CONV) 🔴
// ─────────────────────────────────────────────────────────────────────────────
describe('convertirUnidad', () => {
  it('INV-CONV-01 kg → gr', () => expect(convertirUnidad(1.5, 'kg', 'gr')).toBe(1500))
  it('INV-CONV-02 gr → kg', () => expect(convertirUnidad(500, 'gr', 'kg')).toBe(0.5))
  it('INV-CONV-03 lt → ml', () => expect(convertirUnidad(2, 'lt', 'ml')).toBe(2000))
  it('INV-CONV-04 misma unidad → sin tocar', () => expect(convertirUnidad(7, 'kg', 'kg')).toBe(7))
  it('INV-CONV-05 case-insensitive', () => expect(convertirUnidad(1, 'KG', 'GR')).toBe(1000))
  it('INV-CONV-06 par no soportado → null', () => expect(convertirUnidad(1, 'kg', 'lt')).toBeNull())
  it('INV-CONV-07 unidad desconocida → null', () => expect(convertirUnidad(1, 'u', 'kg')).toBeNull())
  it('INV-CONV-08 precisión sin floating error', () => expect(convertirUnidad(0.001, 'kg', 'gr')).toBe(1))
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 2 — Compatibilidad (INV-COMP) 🟡
// ─────────────────────────────────────────────────────────────────────────────
describe('unidadesCompatibles', () => {
  it('INV-COMP-01 kg → [gr]', () => expect(unidadesCompatibles('kg')).toEqual(['gr']))
  it('INV-COMP-02 lt → [ml]', () => expect(unidadesCompatibles('lt')).toEqual(['ml']))
  it('INV-COMP-03 sin conversión → []', () => expect(unidadesCompatibles('u')).toEqual([]))
  it('INV-COMP-04 case-insensitive', () => expect(unidadesCompatibles('KG')).toEqual(['gr']))
})

describe('tieneConversion', () => {
  it('INV-COMP-05 kg↔gr → true', () => expect(tieneConversion('kg', 'gr')).toBe(true))
  it('INV-COMP-06 misma unidad → true', () => expect(tieneConversion('kg', 'kg')).toBe(true))
  it('INV-COMP-07 kg↔lt → false', () => expect(tieneConversion('kg', 'lt')).toBe(false))
})

// ─────────────────────────────────────────────────────────────────────────────
// Sección 3 — Formato (INV-FMT) 🟡
// ─────────────────────────────────────────────────────────────────────────────
describe('formatUnidad', () => {
  it('INV-FMT-01 decimal es-AR', () => expect(formatUnidad(1.5, 'kg')).toBe('1,5 kg'))
  it('INV-FMT-02 miles es-AR', () => expect(formatUnidad(1000, 'gr')).toBe('1.000 gr'))
})
