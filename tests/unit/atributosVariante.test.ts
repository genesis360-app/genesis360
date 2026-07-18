import { describe, it, expect } from 'vitest'
import { atributosDeLinea, atributoAmbiguoEnLineas, filtrarLineasPorAtributo } from '../../src/lib/atributosVariante'

describe('atributosDeLinea', () => {
  it('devuelve solo los atributos con valor cargado', () => {
    const r = atributosDeLinea({ talle: 'M', color: null, encaje: undefined, formato: '', sabor_aroma: 'Vainilla' })
    expect(r.map(a => a.key)).toEqual(['talle', 'sabor_aroma'])
  })

  it('línea sin ningún atributo → array vacío', () => {
    expect(atributosDeLinea({})).toEqual([])
  })
})

describe('atributoAmbiguoEnLineas', () => {
  it('sin líneas → no hay ambigüedad', () => {
    expect(atributoAmbiguoEnLineas([])).toBeNull()
  })

  it('un solo valor en stock → no hace falta elegir', () => {
    expect(atributoAmbiguoEnLineas([{ talle: 'M' }, { talle: 'M' }])).toBeNull()
  })

  it('dos valores distintos → ambiguo, devuelve el atributo y su label', () => {
    const r = atributoAmbiguoEnLineas([{ talle: 'S' }, { talle: 'M' }])
    expect(r).toEqual({ key: 'talle', label: 'Talle' })
  })

  it('revisa los atributos en orden — talle antes que color', () => {
    const r = atributoAmbiguoEnLineas([{ talle: 'S', color: 'Rojo' }, { talle: 'M', color: 'Azul' }])
    expect(r?.key).toBe('talle')
  })

  it('null/undefined no cuentan como valor distinto', () => {
    expect(atributoAmbiguoEnLineas([{ talle: 'M' }, { talle: null }, { talle: undefined }])).toBeNull()
  })
})

describe('filtrarLineasPorAtributo', () => {
  const lineas = [
    { id: 'L1', talle: 'S' },
    { id: 'L2', talle: 'M' },
    { id: 'L3', talle: 'M', color: 'Rojo' },
  ]

  it('sin selección → devuelve todas las líneas', () => {
    expect(filtrarLineasPorAtributo(lineas, {})).toHaveLength(3)
  })

  it('filtra por un solo atributo seleccionado', () => {
    const r = filtrarLineasPorAtributo(lineas, { talle: 'M' })
    expect(r.map(l => l.id)).toEqual(['L2', 'L3'])
  })

  it('filtra por múltiples atributos — deben coincidir TODOS', () => {
    const r = filtrarLineasPorAtributo(lineas, { talle: 'M', color: 'Rojo' })
    expect(r.map(l => l.id)).toEqual(['L3'])
  })

  it('selección que no matchea ninguna línea → array vacío (nunca cae a "cualquiera")', () => {
    expect(filtrarLineasPorAtributo(lineas, { talle: 'XL' })).toEqual([])
  })

  it('valores vacíos en la selección no filtran (equivale a no seleccionado)', () => {
    const r = filtrarLineasPorAtributo(lineas, { talle: '', color: undefined })
    expect(r).toHaveLength(3)
  })
})
