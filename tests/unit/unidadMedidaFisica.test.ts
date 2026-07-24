import { describe, it, expect } from 'vitest'
import {
  familiaPermiteDecimales, unidadPermiteDecimales, convertirFisica,
  unidadesDeFamilia, unidadBaseDeFamilia, agruparPorFamilia, mapearLegacyAFisica,
  type UnidadFisica,
} from '@/lib/unidadMedidaFisica'

// Espejo del seed de la mig 303 (subconjunto usado por los tests).
const UNIDADES: UnidadFisica[] = [
  { id: 'u',  familia: 'conteo',   nombre: 'Unidad',     simbolo: 'u',  factor_base_familia: 1,       es_base_familia: true,  permite_decimales: false },
  { id: 'mg', familia: 'peso',     nombre: 'Miligramo',  simbolo: 'mg', factor_base_familia: 0.001,   es_base_familia: false, permite_decimales: true },
  { id: 'g',  familia: 'peso',     nombre: 'Gramo',      simbolo: 'g',  factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true },
  { id: 'kg', familia: 'peso',     nombre: 'Kilogramo',  simbolo: 'kg', factor_base_familia: 1000,    es_base_familia: false, permite_decimales: true },
  { id: 't',  familia: 'peso',     nombre: 'Tonelada',   simbolo: 't',  factor_base_familia: 1000000, es_base_familia: false, permite_decimales: true },
  { id: 'ml', familia: 'volumen',  nombre: 'Mililitro',  simbolo: 'ml', factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true },
  { id: 'L',  familia: 'volumen',  nombre: 'Litro',      simbolo: 'L',  factor_base_familia: 1000,    es_base_familia: false, permite_decimales: true },
  { id: 'm',  familia: 'longitud', nombre: 'Metro',      simbolo: 'm',  factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true },
  { id: 'cm', familia: 'longitud', nombre: 'Centímetro', simbolo: 'cm', factor_base_familia: 0.01,    es_base_familia: false, permite_decimales: true },
]

const kg = UNIDADES.find(u => u.id === 'kg')!
const g = UNIDADES.find(u => u.id === 'g')!
const ml = UNIDADES.find(u => u.id === 'ml')!
const u = UNIDADES.find(u => u.id === 'u')!

describe('unidadMedidaFisica — decimales por familia', () => {
  it('conteo NO admite decimales; peso/volumen/longitud SÍ', () => {
    expect(familiaPermiteDecimales('conteo')).toBe(false)
    expect(familiaPermiteDecimales('peso')).toBe(true)
    expect(familiaPermiteDecimales('volumen')).toBe(true)
    expect(familiaPermiteDecimales('longitud')).toBe(true)
  })
  it('unidadPermiteDecimales deriva de la familia (no del flag guardado)', () => {
    expect(unidadPermiteDecimales(u)).toBe(false)
    expect(unidadPermiteDecimales(kg)).toBe(true)
    expect(unidadPermiteDecimales(null)).toBe(false)
  })
})

describe('unidadMedidaFisica — convertirFisica', () => {
  it('misma unidad → misma cantidad', () => {
    expect(convertirFisica(5, kg, kg)).toBe(5)
  })
  it('kg → g (×1000) y g → kg (÷1000), exacto', () => {
    expect(convertirFisica(1, kg, g)).toBe(1000)
    expect(convertirFisica(2.5, kg, g)).toBe(2500)
    expect(convertirFisica(500, g, kg)).toBe(0.5)
  })
  it('mata el ruido de punto flotante', () => {
    // 0.001 g → mg debería dar 1 exacto, no 0.9999999
    const mg = UNIDADES.find(x => x.id === 'mg')!
    expect(convertirFisica(0.001, g, mg)).toBe(1)
  })
  it('familias distintas → null (no se convierte peso a volumen)', () => {
    expect(convertirFisica(1, kg, ml)).toBeNull()
    expect(convertirFisica(1, g, u)).toBeNull()
  })
})

describe('unidadMedidaFisica — helpers de catálogo', () => {
  it('unidadesDeFamilia ordena por factor ascendente', () => {
    expect(unidadesDeFamilia(UNIDADES, 'peso').map(x => x.nombre)).toEqual(['Miligramo', 'Gramo', 'Kilogramo', 'Tonelada'])
  })
  it('unidadBaseDeFamilia devuelve la de factor 1', () => {
    expect(unidadBaseDeFamilia(UNIDADES, 'peso')?.nombre).toBe('Gramo')
    expect(unidadBaseDeFamilia(UNIDADES, 'volumen')?.nombre).toBe('Mililitro')
    expect(unidadBaseDeFamilia(UNIDADES, 'conteo')?.nombre).toBe('Unidad')
  })
  it('agruparPorFamilia agrupa las 4 familias', () => {
    const g = agruparPorFamilia(UNIDADES)
    expect(g.peso).toHaveLength(4)
    expect(g.volumen).toHaveLength(2)
    expect(g.conteo).toHaveLength(1)
  })
})

describe('unidadMedidaFisica — mapearLegacyAFisica (espejo del backfill SQL)', () => {
  it('matchea por nombre y por símbolo, case-insensitive', () => {
    expect(mapearLegacyAFisica('Kilogramo', UNIDADES)?.id).toBe('kg')
    expect(mapearLegacyAFisica('kg', UNIDADES)?.id).toBe('kg')
    expect(mapearLegacyAFisica('UNIDAD', UNIDADES)?.id).toBe('u')
  })
  it('resuelve alias legacy (gr→Gramo, lt→Litro, mt→Metro)', () => {
    expect(mapearLegacyAFisica('gr', UNIDADES)?.nombre).toBe('Gramo')
    expect(mapearLegacyAFisica('lt', UNIDADES)?.nombre).toBe('Litro')
    expect(mapearLegacyAFisica('mt', UNIDADES)?.nombre).toBe('Metro')
  })
  it('empaque/custom (caja/pack/docena) → null (no es unidad física)', () => {
    expect(mapearLegacyAFisica('caja', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica('pack', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica('docena', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica('', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica(null, UNIDADES)).toBeNull()
  })
})
