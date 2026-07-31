import { describe, it, expect } from 'vitest'
import {
  factorBaseDe, filaBase, validarPresentaciones, construirPayload, filasAForm,
  resumenArbol, presentacionesComoNiveles, profundidadDe, agruparPorNivel,
  type PresentacionRow, type PresentacionFila,
} from '@/lib/presentaciones'

// Fase 5 del rediseño UoM (mig 310): el empaque es un ÁRBOL genealógico y admite HERMANAS
// (Caja-12 y Caja-10 del mismo producto). 🛑 Regla #0: la conversión a unidad base tiene que ser
// exacta y entera — el stock se guarda en la unidad base.

const row = (p: Partial<PresentacionRow> & { key: string }): PresentacionRow => ({
  etiqueta: p.key, nombre_empaque_id: '', padre_key: null, cantidad_padre: '',
  peso: '', alto: '', ancho: '', largo: '', ...p,
})

/** unidad(1) → Caja(12) → Pallet(216); hermana Caja-10(10) → Pallet-360(360). Caso real de DEV. */
const arbolLeche = (): PresentacionRow[] => [
  row({ key: 'u', etiqueta: 'unidad' }),
  row({ key: 'c12', etiqueta: 'Caja-12', padre_key: 'u', cantidad_padre: '12' }),
  row({ key: 'p216', etiqueta: 'Pallet-216', padre_key: 'c12', cantidad_padre: '18' }),
  row({ key: 'c10', etiqueta: 'Caja-10', padre_key: 'u', cantidad_padre: '10' }),
  row({ key: 'p360', etiqueta: 'Pallet-360', padre_key: 'c10', cantidad_padre: '36' }),
]

describe('factorBaseDe', () => {
  it('resuelve la equivalencia subiendo la cadena', () => {
    const rows = arbolLeche()
    expect(factorBaseDe(rows[0], rows)).toBe(1)
    expect(factorBaseDe(rows[1], rows)).toBe(12)
    expect(factorBaseDe(rows[2], rows)).toBe(216)   // 12 × 18
  })

  it('resuelve las HERMANAS de forma independiente', () => {
    const rows = arbolLeche()
    expect(factorBaseDe(rows[3], rows)).toBe(10)
    expect(factorBaseDe(rows[4], rows)).toBe(360)   // 10 × 36
  })

  it('devuelve null si la cadena está incompleta o el valor es inválido', () => {
    const rows = [row({ key: 'u' }), row({ key: 'c', padre_key: 'u', cantidad_padre: '' })]
    expect(factorBaseDe(rows[1], rows)).toBeNull()

    const huerfana = [row({ key: 'u' }), row({ key: 'c', padre_key: 'no-existe', cantidad_padre: '5' })]
    expect(factorBaseDe(huerfana[1], huerfana)).toBeNull()
  })

  it('no se cuelga con un ciclo', () => {
    const rows = [
      row({ key: 'a', padre_key: 'b', cantidad_padre: '2' }),
      row({ key: 'b', padre_key: 'a', cantidad_padre: '3' }),
    ]
    expect(factorBaseDe(rows[0], rows)).toBeNull()
  })
})

// Agrupación visual por nivel del editor (Fede 25/7, punto 4: burbujas violeta + "NB").
// Puramente de presentación — no cambia el árbol ni el payload que se guarda.
describe('profundidadDe', () => {
  it('la base es profundidad 0 (NB)', () => {
    const rows = arbolLeche()
    expect(profundidadDe(rows[0], rows)).toBe(0)
  })

  it('sube un nivel por cada salto de padre, aunque sea por una rama hermana distinta', () => {
    const rows = arbolLeche()
    expect(profundidadDe(rows.find(r => r.key === 'c12')!, rows)).toBe(1)
    expect(profundidadDe(rows.find(r => r.key === 'c10')!, rows)).toBe(1)
    expect(profundidadDe(rows.find(r => r.key === 'p216')!, rows)).toBe(2)
    expect(profundidadDe(rows.find(r => r.key === 'p360')!, rows)).toBe(2)
  })
})

describe('agruparPorNivel', () => {
  it('agrupa por profundidad y ordena hermanas de MENOR a MAYOR cantidad de unidades base', () => {
    const grupos = agruparPorNivel(arbolLeche())
    expect(grupos.map(g => g.nivel)).toEqual([0, 1, 2])
    expect(grupos[0].filas.map(r => r.etiqueta)).toEqual(['unidad'])
    // Caja-10 (factor 10) antes que Caja-12 (factor 12), aunque se cargó después en el array.
    expect(grupos[1].filas.map(r => r.etiqueta)).toEqual(['Caja-10', 'Caja-12'])
    expect(grupos[2].filas.map(r => r.etiqueta)).toEqual(['Pallet-216', 'Pallet-360'])
  })

  it('una línea nueva del mismo tipo de empaque que una ya cargada cae en la misma burbuja', () => {
    // Simula agregar "Caja-15" ya con Caja-10 en el nivel 1 (mismo padre_key que le asignaría
    // el auto-match por nombre_empaque_id en el componente).
    const rows = [
      ...arbolLeche(),
      row({ key: 'c15', etiqueta: 'Caja-15', padre_key: 'u', cantidad_padre: '15' }),
    ]
    const grupos = agruparPorNivel(rows)
    expect(grupos[1].filas.map(r => r.etiqueta)).toEqual(['Caja-10', 'Caja-12', 'Caja-15'])
  })
})

describe('filaBase', () => {
  it('es la única sin padre', () => {
    expect(filaBase(arbolLeche())?.key).toBe('u')
    expect(filaBase([])).toBeNull()
  })
})

describe('validarPresentaciones', () => {
  it('acepta el árbol con hermanas', () => {
    expect(validarPresentaciones(arbolLeche())).toBeNull()
  })

  it('exige exactamente una base', () => {
    expect(validarPresentaciones([])).toMatch(/al menos la presentación base/)
    expect(validarPresentaciones([row({ key: 'a' }), row({ key: 'b' })]))
      .toMatch(/exactamente una presentación base/)
  })

  it('rechaza nombres repetidos y vacíos', () => {
    const dup = [row({ key: 'u', etiqueta: 'Unidad' }), row({ key: 'c', etiqueta: 'Unidad', padre_key: 'u', cantidad_padre: '6' })]
    expect(validarPresentaciones(dup)).toMatch(/dos presentaciones llamadas/)

    const vacio = [row({ key: 'u', etiqueta: '' })]
    expect(validarPresentaciones(vacio)).toMatch(/necesitan un nombre/)
  })

  it('🛑 exige contener 2 o más del padre (una caja de 1 unidad no es un empaque)', () => {
    const rows = [row({ key: 'u', etiqueta: 'Unidad' }), row({ key: 'c', etiqueta: 'Caja', padre_key: 'u', cantidad_padre: '1' })]
    expect(validarPresentaciones(rows)).toMatch(/2 o más/)
  })

  it('🛑 rechaza cantidades no enteras (la conversión a base tiene que ser exacta)', () => {
    const rows = [row({ key: 'u', etiqueta: 'Unidad' }), row({ key: 'c', etiqueta: 'Caja', padre_key: 'u', cantidad_padre: '2.5' })]
    expect(validarPresentaciones(rows)).toMatch(/2 o más/)
  })

  it('rechaza dos presentaciones que equivalen a lo mismo (misma cosa, dos nombres)', () => {
    const rows = [
      row({ key: 'u', etiqueta: 'Unidad' }),
      row({ key: 'a', etiqueta: 'Caja', padre_key: 'u', cantidad_padre: '12' }),
      row({ key: 'b', etiqueta: 'Cajón', padre_key: 'u', cantidad_padre: '12' }),
    ]
    expect(validarPresentaciones(rows)).toMatch(/mismas 12 unidades base/)
  })

  it('rechaza dimensiones ≤ 0', () => {
    const rows = [row({ key: 'u', etiqueta: 'Unidad', peso: '0' })]
    expect(validarPresentaciones(rows)).toMatch(/el peso tiene que ser mayor a 0/)
  })

  // ── Cubicaje activo (mig 322): las medidas dejan de ser opcionales ─────────────────
  it('sin cubicaje, las medidas vacías se aceptan (el que no lo usa no las carga)', () => {
    expect(validarPresentaciones(arbolLeche())).toBeNull()
  })

  it('🛑 con cubicaje, una presentación sin medir hace que el volumen ocupado quede corto → se exige', () => {
    expect(validarPresentaciones(arbolLeche(), true)).toMatch(/el cubicaje está activado/)
  })

  it('con cubicaje, nombra el campo que falta y dónde desactivarlo', () => {
    const rows = [row({ key: 'u', etiqueta: 'Unidad', peso: '1', alto: '10', ancho: '10', largo: '' })]
    const err = validarPresentaciones(rows, true)
    expect(err).toMatch(/el largo/)
    expect(err).toMatch(/Configuración → Inventario/)
  })

  it('con cubicaje y TODAS las medidas cargadas, valida igual que siempre', () => {
    const medida = { peso: '1', alto: '10', ancho: '10', largo: '10' }
    const rows = [
      row({ key: 'u', etiqueta: 'Unidad', ...medida }),
      row({ key: 'c', etiqueta: 'Caja', padre_key: 'u', cantidad_padre: '12', ...medida, alto: '30' }),
    ]
    expect(validarPresentaciones(rows, true)).toBeNull()
  })
})

describe('construirPayload', () => {
  it('ordena para que el padre venga siempre ANTES que sus hijos', () => {
    // Se pasa desordenado a propósito: el pallet antes que su caja.
    const rows = [
      row({ key: 'p', etiqueta: 'Pallet', padre_key: 'c', cantidad_padre: '18' }),
      row({ key: 'u', etiqueta: 'unidad' }),
      row({ key: 'c', etiqueta: 'Caja', padre_key: 'u', cantidad_padre: '12' }),
    ]
    const payload = construirPayload(rows)!
    expect(payload.map(p => p.etiqueta)).toEqual(['unidad', 'Caja', 'Pallet'])
    // El padre se referencia por índice ANTERIOR → imposible armar un ciclo
    payload.forEach((p, i) => { if (p.padre_idx !== null) expect(p.padre_idx).toBeLessThan(i) })
  })

  it('🛑 emite los factores RESUELTOS en unidades base', () => {
    const payload = construirPayload(arbolLeche())!
    const porEtiqueta = Object.fromEntries(payload.map(p => [p.etiqueta, p.factor_base]))
    expect(porEtiqueta).toEqual({
      unidad: 1, 'Caja-12': 12, 'Pallet-216': 216, 'Caja-10': 10, 'Pallet-360': 360,
    })
  })

  it('la base va con padre_idx null y factor 1', () => {
    const payload = construirPayload(arbolLeche())!
    expect(payload[0]).toMatchObject({ padre_idx: null, factor_base: 1 })
  })

  it('devuelve null si quedan filas huérfanas', () => {
    const rows = [row({ key: 'u' }), row({ key: 'x', padre_key: 'no-existe', cantidad_padre: '3' })]
    expect(construirPayload(rows)).toBeNull()
  })

  it('convierte dimensiones vacías en null', () => {
    const payload = construirPayload([row({ key: 'u', etiqueta: 'Unidad', peso: '1.5' })])!
    expect(payload[0]).toMatchObject({ peso_kg: 1.5, alto_cm: null, ancho_cm: null, largo_cm: null })
  })
})

describe('filasAForm', () => {
  const filas: PresentacionFila[] = [
    { id: 'u', etiqueta: 'unidad', nombre_empaque_id: null, factor_base: 1, es_base: true, padre_linea_id: null, orden: 0, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
    { id: 'c', etiqueta: 'Caja-12', nombre_empaque_id: 'em1', factor_base: 12, es_base: false, padre_linea_id: 'u', orden: 1, peso_kg: 5, alto_cm: null, ancho_cm: null, largo_cm: null },
    { id: 'p', etiqueta: 'Pallet', nombre_empaque_id: 'em2', factor_base: 216, es_base: false, padre_linea_id: 'c', orden: 2, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
  ]

  it('deriva "cuántas del padre contiene" desde los factores guardados', () => {
    const rows = filasAForm(filas)
    expect(rows.map(r => r.cantidad_padre)).toEqual(['', '12', '18'])   // 216 / 12 = 18
  })

  it('es ida y vuelta: reconstruye los mismos factores', () => {
    const rows = filasAForm(filas)
    const payload = construirPayload(rows)!
    expect(payload.map(p => p.factor_base)).toEqual([1, 12, 216])
  })
})

describe('presentacionesComoNiveles (adaptador para los selectores de UoM)', () => {
  it('🛑 mapea factor_base → unidades_base sin tocar el número, ordenado de menor a mayor', () => {
    const filas: PresentacionFila[] = [
      { id: 'p', etiqueta: 'Pallet', nombre_empaque_id: 'e2', factor_base: 216, es_base: false, padre_linea_id: 'c', orden: 2, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
      { id: 'u', etiqueta: 'unidad', nombre_empaque_id: null, factor_base: 1, es_base: true, padre_linea_id: null, orden: 0, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
      { id: 'c', etiqueta: 'Caja-12', nombre_empaque_id: 'e1', factor_base: 12, es_base: false, padre_linea_id: 'u', orden: 1, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
    ]
    const niveles = presentacionesComoNiveles(filas)
    expect(niveles.map(n => n.unidades_base)).toEqual([1, 12, 216])
    expect(niveles.map(n => n.unidades_medida.nombre)).toEqual(['unidad', 'Caja-12', 'Pallet'])
  })

  it('🛑 la presentación BASE devuelve unidad_medida_id NULL, nunca "" (rompía el INSERT del LPN)', () => {
    // Bug real cazado por los e2e 103/104: `inventario_lineas.unidad_medida_id` es uuid y los
    // consumidores hacen `?? null`, que NO atrapa un string vacío → el ingreso de stock fallaba.
    const filas: PresentacionFila[] = [
      { id: 'u', etiqueta: 'unidad', nombre_empaque_id: null, factor_base: 1, es_base: true, padre_linea_id: null, orden: 0, peso_kg: null, alto_cm: null, ancho_cm: null, largo_cm: null },
    ]
    expect(presentacionesComoNiveles(filas)[0].unidad_medida_id).toBeNull()
  })
})

describe('resumenArbol', () => {
  it('describe la cadena en palabras', () => {
    const r = resumenArbol(arbolLeche())
    expect(r).toContain('Caja-12 = 12 × unidad')
    expect(r).toContain('Pallet-216 = 18 × Caja-12')
    expect(r).toContain('Caja-10 = 10 × unidad')
  })

  it('con solo la base dice que es la base', () => {
    expect(resumenArbol([row({ key: 'u', etiqueta: 'Kilogramo' })])).toBe('Kilogramo (base)')
  })
})
