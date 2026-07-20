import { describe, it, expect } from 'vitest'
import {
  calcularUnidadesBase, validarNiveles, nivelesAPayload, cadenaConversion,
  convertirABase, type NivelForm, type NivelEstructuraDB,
} from '@/lib/estructuras'

// Fase 1 estructuras dinámicas (mig 282) — footprint estilo Blue Yonder.
// REGLA #0 inventario: conversiones exactas, factores enteros. Esta lib espeja las
// validaciones server-side de fn_estructura_guardar_niveles.

const nivel = (over: Partial<NivelForm> = {}): NivelForm => ({
  unidad_medida_id: 'udm-1', factor: '', peso: '', alto: '', ancho: '', largo: '', ...over,
})

const nivelDB = (over: Partial<NivelEstructuraDB> = {}): NivelEstructuraDB => ({
  id: 'n1', estructura_id: 'e1', unidad_medida_id: 'udm-1', orden: 1,
  factor: 1, unidades_base: 1, unidades_medida: { nombre: 'Unidad', simbolo: 'u' }, ...over,
})

describe('calcularUnidadesBase', () => {
  it('cadena unidad→caja→pallet: producto acumulado', () => {
    expect(calcularUnidadesBase([1, 12, 40])).toEqual([1, 12, 480])
  })
  it('el factor del nivel base se ignora (siempre 1)', () => {
    expect(calcularUnidadesBase([999, 12])).toEqual([1, 12])
  })
  it('un solo nivel = [1]', () => {
    expect(calcularUnidadesBase([1])).toEqual([1])
  })
  it('factor no entero o < 1 → null (no se puede calcular exacto)', () => {
    expect(calcularUnidadesBase([1, 12.5])).toBeNull()
    expect(calcularUnidadesBase([1, 0])).toBeNull()
    expect(calcularUnidadesBase([1, -3])).toBeNull()
  })
  it('factor 1 en nivel intermedio es válido (display = 1 caja)', () => {
    expect(calcularUnidadesBase([1, 12, 1, 40])).toEqual([1, 12, 12, 480])
  })
})

describe('validarNiveles', () => {
  it('estructura válida de 3 niveles', () => {
    expect(validarNiveles([
      nivel(),
      nivel({ unidad_medida_id: 'udm-2', factor: '12' }),
      nivel({ unidad_medida_id: 'udm-3', factor: '40' }),
    ])).toBeNull()
  })
  it('un solo nivel base es válido (sin factor)', () => {
    expect(validarNiveles([nivel()])).toBeNull()
  })
  it('sin niveles → error', () => {
    expect(validarNiveles([])).toMatch(/al menos un nivel/)
  })
  it('nivel sin UdM → error', () => {
    expect(validarNiveles([nivel({ unidad_medida_id: '' })])).toMatch(/unidad de medida/)
  })
  it('UdM repetida → error', () => {
    expect(validarNiveles([nivel(), nivel({ factor: '12' })])).toMatch(/repetir/)
  })
  it('factor vacío, no entero o < 1 en nivel 2+ → error', () => {
    expect(validarNiveles([nivel(), nivel({ unidad_medida_id: 'udm-2', factor: '' })])).toMatch(/factor/)
    expect(validarNiveles([nivel(), nivel({ unidad_medida_id: 'udm-2', factor: '12.5' })])).toMatch(/factor/)
    expect(validarNiveles([nivel(), nivel({ unidad_medida_id: 'udm-2', factor: '0' })])).toMatch(/factor/)
  })
  it('el nivel base NO exige factor (se fuerza a 1)', () => {
    expect(validarNiveles([nivel({ factor: '' })])).toBeNull()
  })
  it('dimensiones opcionales, pero si se cargan deben ser > 0', () => {
    expect(validarNiveles([nivel({ peso: '1.5' })])).toBeNull()
    expect(validarNiveles([nivel({ peso: '0' })])).toMatch(/peso/)
    expect(validarNiveles([nivel({ alto: '-2' })])).toMatch(/alto/)
    expect(validarNiveles([nivel({ ancho: 'abc' })])).toMatch(/ancho/)
  })
})

describe('nivelesAPayload', () => {
  it('fuerza factor 1 en la base y convierte strings a números', () => {
    const p = nivelesAPayload([
      nivel({ factor: '99', peso: '0.5', alto: '10' }),
      nivel({ unidad_medida_id: 'udm-2', factor: '12', largo: '30' }),
    ])
    expect(p[0]).toEqual({
      unidad_medida_id: 'udm-1', factor: 1,
      peso_kg: 0.5, alto_cm: 10, ancho_cm: null, largo_cm: null,
    })
    expect(p[1]).toEqual({
      unidad_medida_id: 'udm-2', factor: 12,
      peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: 30,
    })
  })
  it('campos vacíos → null (no 0 ni NaN)', () => {
    const p = nivelesAPayload([nivel()])
    expect(p[0].peso_kg).toBeNull()
    expect(p[0].alto_cm).toBeNull()
  })
})

describe('cadenaConversion', () => {
  const tres = [
    nivelDB(),
    nivelDB({ id: 'n2', orden: 2, factor: 12, unidades_base: 12, unidad_medida_id: 'udm-2', unidades_medida: { nombre: 'Caja', simbolo: 'caja' } }),
    nivelDB({ id: 'n3', orden: 3, factor: 40, unidades_base: 480, unidad_medida_id: 'udm-3', unidades_medida: { nombre: 'Pallet', simbolo: 'pallet' } }),
  ]
  it('tres niveles con equivalencia acumulada', () => {
    expect(cadenaConversion(tres)).toBe('Caja = 12 × Unidad · Pallet = 40 × Caja (= 480 × Unidad)')
  })
  it('dos niveles sin paréntesis redundante', () => {
    expect(cadenaConversion(tres.slice(0, 2))).toBe('Caja = 12 × Unidad')
  })
  it('un nivel = base', () => {
    expect(cadenaConversion([nivelDB()])).toBe('Unidad (base)')
  })
  it('sin niveles', () => {
    expect(cadenaConversion([])).toBe('Sin niveles')
  })
  it('join de UdM ausente → em dash, no crash', () => {
    expect(cadenaConversion([nivelDB({ unidades_medida: null })])).toBe('— (base)')
  })
})

describe('convertirABase', () => {
  it('multiplica exacto por unidades_base', () => {
    expect(convertirABase(5, { unidades_base: 12 })).toBe(60)
    expect(convertirABase(3, { unidades_base: 480 })).toBe(1440)
    expect(convertirABase(0, { unidades_base: 12 })).toBe(0)
  })
  it('cantidad no entera o negativa → throw (nunca stock fraccionado silencioso)', () => {
    expect(() => convertirABase(1.5, { unidades_base: 12 })).toThrow()
    expect(() => convertirABase(-1, { unidades_base: 12 })).toThrow()
  })
})
