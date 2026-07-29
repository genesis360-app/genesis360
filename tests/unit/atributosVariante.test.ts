import { describe, it, expect } from 'vitest'
import {
  atributosDeLinea, atributoAmbiguoEnLineas, filtrarLineasPorAtributo,
  tieneAtributosVariante, motivoBloqueoAtributosVariante, motivoBloqueoCrearVariante,
  CAMPOS_ATRIBUTO_VARIANTE,
} from '../../src/lib/atributosVariante'

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

// ── Un producto usa UN modelo de variante, no dos (mig 314) ──────────────────────────────
// Espejo del CHECK `chk_productos_variante_sin_atributos` + trigger `trg_productos_variante_atributos`.

describe('tieneAtributosVariante', () => {
  it('producto sin ningún atributo → false', () => {
    expect(tieneAtributosVariante({})).toBe(false)
    expect(tieneAtributosVariante({ tiene_talle: false, tiene_color: false })).toBe(false)
  })

  it('null / undefined → false (no rompe con un producto todavía sin cargar)', () => {
    expect(tieneAtributosVariante(null)).toBe(false)
    expect(tieneAtributosVariante(undefined)).toBe(false)
  })

  it('cualquiera de los 5 campos alcanza', () => {
    for (const campo of CAMPOS_ATRIBUTO_VARIANTE) {
      expect(tieneAtributosVariante({ [campo]: true })).toBe(true)
    }
  })

  it('los 5 campos son exactamente los del CHECK de la mig 314 — ni pais_origen ni lote/serie', () => {
    expect([...CAMPOS_ATRIBUTO_VARIANTE]).toEqual(
      ['tiene_talle', 'tiene_color', 'tiene_encaje', 'tiene_formato', 'tiene_sabor_aroma'],
    )
  })
})

describe('motivoBloqueoAtributosVariante', () => {
  it('producto standalone → se pueden tocar (el modelo de atributos sigue vivo)', () => {
    expect(motivoBloqueoAtributosVariante({ esHijo: false, esMadre: false })).toBeNull()
  })

  it('un hijo ya es un SKU separado → bloqueado', () => {
    const r = motivoBloqueoAtributosVariante({ esHijo: true, esMadre: false })
    expect(r).toContain('SKU separado')
  })

  it('una madre agrupadora → bloqueado, nombrando cuántas variantes tiene', () => {
    const r = motivoBloqueoAtributosVariante({ esHijo: false, esMadre: true, cantidadHijos: 3 })
    expect(r).toContain('3 variantes')
  })

  it('una sola variante → singular', () => {
    const r = motivoBloqueoAtributosVariante({ esHijo: false, esMadre: true, cantidadHijos: 1 })
    expect(r).toContain('1 variante')
    expect(r).not.toContain('1 variantes')
  })
})

describe('motivoBloqueoCrearVariante', () => {
  it('producto sin atributos → se le puede crear una variante', () => {
    expect(motivoBloqueoCrearVariante({ nombre: 'Remera' })).toBeNull()
  })

  it('producto con un atributo activo → bloqueado, nombrando el producto', () => {
    const r = motivoBloqueoCrearVariante({ nombre: 'Remera Nike', tiene_color: true })
    expect(r).toContain('"Remera Nike"')
    expect(r).toContain('Apagá los Atributos de variante')
  })

  it('sin nombre cargado no rompe ni deja un texto vacío entre comillas', () => {
    const r = motivoBloqueoCrearVariante({ nombre: '   ', tiene_talle: true })
    expect(r).toContain('Este producto')
  })

  it('null → no bloquea (todavía no cargó el producto)', () => {
    expect(motivoBloqueoCrearVariante(null)).toBeNull()
  })
})
