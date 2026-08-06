import { describe, it, expect } from 'vitest'
import { breadcrumbUbicacion, descendientesDeUbicacion, ordenarArbolUbicaciones } from '@/lib/ubicacionesArbol'

// Árbol de Ubicaciones (mig 334, relevamiento 2026-08-02) — contenedora/nivel self-FK.

const arbol = [
  { id: 'gondola3', nombre: 'Góndola 3', padre_ubicacion_id: null },
  { id: 'estante2', nombre: 'Estante 2', padre_ubicacion_id: 'gondola3' },
  { id: 'balda-a', nombre: 'Balda A', padre_ubicacion_id: 'estante2' },
  { id: 'heladera', nombre: 'Heladera', padre_ubicacion_id: null },
]

describe('breadcrumbUbicacion', () => {
  const porId = new Map(arbol.map(u => [u.id, u]))
  it('nodo raíz sin padre devuelve solo su nombre', () => {
    expect(breadcrumbUbicacion('gondola3', porId)).toBe('Góndola 3')
  })
  it('nivel intermedio concatena hasta la raíz', () => {
    expect(breadcrumbUbicacion('estante2', porId)).toBe('Góndola 3 › Estante 2')
  })
  it('nivel más profundo concatena la cadena completa', () => {
    expect(breadcrumbUbicacion('balda-a', porId)).toBe('Góndola 3 › Estante 2 › Balda A')
  })
  it('id null/undefined da string vacío', () => {
    expect(breadcrumbUbicacion(null, porId)).toBe('')
    expect(breadcrumbUbicacion(undefined, porId)).toBe('')
  })
  it('id inexistente en el mapa da string vacío (no explota)', () => {
    expect(breadcrumbUbicacion('no-existe', porId)).toBe('')
  })
  it('corta a los 50 saltos si hay un ciclo mal formado en los datos (defensa, no debería pasar nunca por el guard de la DB)', () => {
    const ciclico = new Map([
      ['a', { id: 'a', nombre: 'A', padre_ubicacion_id: 'b' }],
      ['b', { id: 'b', nombre: 'B', padre_ubicacion_id: 'a' }],
    ])
    expect(() => breadcrumbUbicacion('a', ciclico)).not.toThrow()
  })
})

describe('descendientesDeUbicacion', () => {
  it('devuelve todos los hijos y nietos, no solo los directos', () => {
    const out = descendientesDeUbicacion('gondola3', arbol)
    expect(out).toEqual(new Set(['estante2', 'balda-a']))
  })
  it('un nodo hoja no tiene descendientes', () => {
    expect(descendientesDeUbicacion('balda-a', arbol)).toEqual(new Set())
  })
  it('una raíz sin hijos no tiene descendientes', () => {
    expect(descendientesDeUbicacion('heladera', arbol)).toEqual(new Set())
  })
})

describe('ordenarArbolUbicaciones', () => {
  it('cada hijo aparece inmediatamente después de su padre, con la profundidad correcta', () => {
    const out = ordenarArbolUbicaciones(arbol)
    const porNombre = Object.fromEntries(out.map(u => [u.nombre, u._depth]))
    expect(porNombre['Góndola 3']).toBe(0)
    expect(porNombre['Estante 2']).toBe(1)
    expect(porNombre['Balda A']).toBe(2)
    expect(porNombre['Heladera']).toBe(0)
    // Estante 2 tiene que aparecer INMEDIATAMENTE después de Góndola 3, antes de cualquier otra raíz.
    const idxGondola = out.findIndex(u => u.nombre === 'Góndola 3')
    const idxEstante = out.findIndex(u => u.nombre === 'Estante 2')
    const idxBalda = out.findIndex(u => u.nombre === 'Balda A')
    expect(idxEstante).toBe(idxGondola + 1)
    expect(idxBalda).toBe(idxEstante + 1)
  })
  it('ordena hermanos por prioridad y después por nombre', () => {
    const conPrioridad = [
      { id: '1', nombre: 'Zeta', padre_ubicacion_id: null, prioridad: 5 },
      { id: '2', nombre: 'Alfa', padre_ubicacion_id: null, prioridad: 1 },
      { id: '3', nombre: 'Beta', padre_ubicacion_id: null, prioridad: 1 },
    ]
    const out = ordenarArbolUbicaciones(conPrioridad)
    expect(out.map(u => u.nombre)).toEqual(['Alfa', 'Beta', 'Zeta'])
  })
  it('lista vacía no explota', () => {
    expect(ordenarArbolUbicaciones([])).toEqual([])
  })
})
