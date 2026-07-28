import { describe, it, expect } from 'vitest'
import {
  familiaPermiteDecimales, unidadPermiteDecimales, convertirFisica,
  unidadesDeFamilia, unidadBaseDeFamilia, agruparPorFamilia, mapearLegacyAFisica,
  FAMILIAS_FISICAS, PRESETS_RUBRO,
  type UnidadFisica,
} from '@/lib/unidadMedidaFisica'

// Espejo del seed de las migs 303/308 (subconjunto usado por los tests, incluye familia 'area').
const UNIDADES: UnidadFisica[] = [
  { id: 'u',   familia: 'conteo',   nombre: 'Unidad',         simbolo: 'u',   factor_base_familia: 1,       es_base_familia: true,  permite_decimales: false, activo: true },
  { id: 'doc', familia: 'conteo',   nombre: 'Docena',         simbolo: 'doc', factor_base_familia: 12,      es_base_familia: false, permite_decimales: false, activo: false },
  { id: 'mg',  familia: 'peso',     nombre: 'Miligramo',      simbolo: 'mg',  factor_base_familia: 0.001,   es_base_familia: false, permite_decimales: true,  activo: true },
  { id: 'g',   familia: 'peso',     nombre: 'Gramo',          simbolo: 'g',   factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true,  activo: true },
  { id: 'kg',  familia: 'peso',     nombre: 'Kilogramo',      simbolo: 'kg',  factor_base_familia: 1000,    es_base_familia: false, permite_decimales: true,  activo: true },
  { id: 't',   familia: 'peso',     nombre: 'Tonelada',       simbolo: 't',   factor_base_familia: 1000000, es_base_familia: false, permite_decimales: true,  activo: true },
  { id: 'ml',  familia: 'volumen',  nombre: 'Mililitro',      simbolo: 'ml',  factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true,  activo: true },
  { id: 'L',   familia: 'volumen',  nombre: 'Litro',          simbolo: 'L',   factor_base_familia: 1000,    es_base_familia: false, permite_decimales: true,  activo: true },
  { id: 'm',   familia: 'longitud', nombre: 'Metro',          simbolo: 'm',   factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true,  activo: true },
  { id: 'cm',  familia: 'longitud', nombre: 'Centímetro',     simbolo: 'cm',  factor_base_familia: 0.01,    es_base_familia: false, permite_decimales: true,  activo: true },
  { id: 'm2',  familia: 'area',     nombre: 'Metro cuadrado', simbolo: 'm²',  factor_base_familia: 1,       es_base_familia: true,  permite_decimales: true,  activo: true },
  { id: 'cm2', familia: 'area',     nombre: 'Centímetro cuadrado', simbolo: 'cm²', factor_base_familia: 0.0001, es_base_familia: false, permite_decimales: true, activo: false },
]

const kg = UNIDADES.find(u => u.id === 'kg')!
const g = UNIDADES.find(u => u.id === 'g')!
const ml = UNIDADES.find(u => u.id === 'ml')!
const u = UNIDADES.find(u => u.id === 'u')!
const m2 = UNIDADES.find(u => u.id === 'm2')!
const cm2 = UNIDADES.find(u => u.id === 'cm2')!

describe('unidadMedidaFisica — decimales por familia', () => {
  it('conteo NO admite decimales; peso/volumen/longitud/area SÍ', () => {
    expect(familiaPermiteDecimales('conteo')).toBe(false)
    expect(familiaPermiteDecimales('peso')).toBe(true)
    expect(familiaPermiteDecimales('volumen')).toBe(true)
    expect(familiaPermiteDecimales('longitud')).toBe(true)
    expect(familiaPermiteDecimales('area')).toBe(true)
  })
  it('unidadPermiteDecimales deriva de la familia (no del flag guardado)', () => {
    expect(unidadPermiteDecimales(u)).toBe(false)
    expect(unidadPermiteDecimales(kg)).toBe(true)
    expect(unidadPermiteDecimales(m2)).toBe(true)
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
  it('área: m² → cm² (×10000) y cm² → m² (÷10000)', () => {
    expect(convertirFisica(1, m2, cm2)).toBe(10000)
    expect(convertirFisica(20000, cm2, m2)).toBe(2)
  })
  it('mata el ruido de punto flotante', () => {
    const mg = UNIDADES.find(x => x.id === 'mg')!
    expect(convertirFisica(0.001, g, mg)).toBe(1)
  })
  it('familias distintas → null (no se convierte peso a volumen ni longitud a área)', () => {
    expect(convertirFisica(1, kg, ml)).toBeNull()
    expect(convertirFisica(1, g, u)).toBeNull()
    expect(convertirFisica(1, m2, kg)).toBeNull()
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
    expect(unidadBaseDeFamilia(UNIDADES, 'area')?.nombre).toBe('Metro cuadrado')
  })
  it('agruparPorFamilia agrupa las 5 familias (incluye area sin romper)', () => {
    const grp = agruparPorFamilia(UNIDADES)
    expect(grp.peso).toHaveLength(4)
    expect(grp.volumen).toHaveLength(2)
    expect(grp.conteo).toHaveLength(2)
    expect(grp.area).toHaveLength(2)
  })
  it('FAMILIAS_FISICAS incluye las 5 familias', () => {
    expect(FAMILIAS_FISICAS).toContain('area')
    expect(FAMILIAS_FISICAS).toHaveLength(5)
  })
})

describe('unidadMedidaFisica — presets por rubro (Fase 1-bis)', () => {
  it('cada preset tiene label y al menos una unidad, siempre incluye Unidad', () => {
    expect(PRESETS_RUBRO.length).toBeGreaterThan(0)
    for (const p of PRESETS_RUBRO) {
      expect(p.label.trim()).not.toBe('')
      expect(p.unidades.length).toBeGreaterThan(0)
      expect(p.unidades).toContain('Unidad')
    }
  })
})

describe('unidadMedidaFisica — mapearLegacyAFisica (espejo del backfill SQL)', () => {
  it('matchea por nombre y por símbolo, case-insensitive', () => {
    expect(mapearLegacyAFisica('Kilogramo', UNIDADES)?.id).toBe('kg')
    expect(mapearLegacyAFisica('kg', UNIDADES)?.id).toBe('kg')
    expect(mapearLegacyAFisica('UNIDAD', UNIDADES)?.id).toBe('u')
  })
  it('resuelve alias legacy (gr→Gramo, lt→Litro)', () => {
    expect(mapearLegacyAFisica('gr', UNIDADES)?.nombre).toBe('Gramo')
    expect(mapearLegacyAFisica('lt', UNIDADES)?.nombre).toBe('Litro')
  })
  it('empaque/custom (caja/pack) → null (no es unidad física)', () => {
    expect(mapearLegacyAFisica('caja', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica('pack', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica('', UNIDADES)).toBeNull()
    expect(mapearLegacyAFisica(null, UNIDADES)).toBeNull()
  })
})
