import { describe, it, expect } from 'vitest'
import {
  cantidadDe, totalAsignado, restanteDeLinea, totalAMover,
  construirAsignaciones, validarBorrador, repartirEnPartesIguales,
  type LineaSinAsignar, type BorradorAsignacion,
} from '@/lib/reasignacionVariante'

// Fase 4 del rediseño UoM (mig 309): repartir el stock "sin variante asignada" de una madre
// agrupadora entre sus hijos. 🛑 Regla #0: acá no se puede perder ni duplicar una unidad.

const L = (id: string, cantidad: number): LineaSinAsignar => ({ id, lpn: `LPN-${id}`, cantidad })

describe('cantidadDe', () => {
  it('parsea enteros positivos y trata todo lo demás como 0', () => {
    expect(cantidadDe('5')).toBe(5)
    expect(cantidadDe(' 12 ')).toBe(12)
    expect(cantidadDe('')).toBe(0)
    expect(cantidadDe(undefined)).toBe(0)
    expect(cantidadDe('abc')).toBe(0)
    expect(cantidadDe('-3')).toBe(0)
    expect(cantidadDe('0')).toBe(0)
  })
})

describe('totales por línea', () => {
  const lineas = [L('a', 10), L('b', 7)]
  const borrador: BorradorAsignacion = { a: { rojo: '6', azul: '4' }, b: { rojo: '7' } }

  it('suma lo asignado de cada línea', () => {
    expect(totalAsignado(borrador, 'a')).toBe(10)
    expect(totalAsignado(borrador, 'b')).toBe(7)
    expect(totalAsignado(borrador, 'inexistente')).toBe(0)
  })

  it('calcula el restante y el total a mover', () => {
    expect(restanteDeLinea(lineas[0], borrador)).toBe(0)
    expect(restanteDeLinea(lineas[1], borrador)).toBe(0)
    expect(totalAMover(lineas, borrador)).toBe(17)
  })

  it('el restante se vuelve negativo si el usuario se pasa (la UI lo muestra como exceso)', () => {
    expect(restanteDeLinea(L('a', 10), { a: { rojo: '12' } })).toBe(-2)
  })
})

describe('validarBorrador', () => {
  const lineas = [L('a', 10)]

  it('rechaza repartir más de lo que tiene la línea', () => {
    expect(validarBorrador(lineas, { a: { rojo: '6', azul: '5' } }))
      .toMatch(/tiene 10 unidades y estás repartiendo 11/)
  })

  it('rechaza un borrador sin ninguna cantidad', () => {
    expect(validarBorrador(lineas, { a: { rojo: '', azul: '0' } }))
      .toMatch(/al menos una cantidad/)
  })

  it('acepta un reparto parcial (no obliga a vaciar la línea)', () => {
    expect(validarBorrador(lineas, { a: { rojo: '3' } })).toBeNull()
  })

  it('acepta el reparto exacto', () => {
    expect(validarBorrador(lineas, { a: { rojo: '6', azul: '4' } })).toBeNull()
  })
})

describe('construirAsignaciones', () => {
  it('saltea los ceros y los vacíos', () => {
    const out = construirAsignaciones([L('a', 10)], { a: { rojo: '6', azul: '', verde: '0' } })
    expect(out).toEqual([{ linea_id: 'a', hijo_id: 'rojo', cantidad: 6 }])
  })

  it('emite una entrada por (línea, hijo) y conserva el total', () => {
    const lineas = [L('a', 10), L('b', 7)]
    const borrador = { a: { rojo: '6', azul: '4' }, b: { rojo: '7' } }
    const out = construirAsignaciones(lineas, borrador)
    expect(out).toHaveLength(3)
    expect(out.reduce((s, x) => s + x.cantidad, 0)).toBe(17)
  })

  it('ignora líneas que no están en la lista (no manda basura al server)', () => {
    const out = construirAsignaciones([L('a', 5)], { a: { rojo: '5' }, fantasma: { rojo: '99' } })
    expect(out).toEqual([{ linea_id: 'a', hijo_id: 'rojo', cantidad: 5 }])
  })
})

describe('repartirEnPartesIguales', () => {
  it('reparte exacto cuando divide justo', () => {
    const b = repartirEnPartesIguales([L('a', 9)], ['x', 'y', 'z'])
    expect(totalAsignado(b, 'a')).toBe(9)
    expect(b.a).toEqual({ x: '3', y: '3', z: '3' })
  })

  it('🛑 con resto, NO pierde ni inventa unidades: el sobrante va de a uno a los primeros', () => {
    const b = repartirEnPartesIguales([L('a', 10)], ['x', 'y', 'z'])
    expect(totalAsignado(b, 'a')).toBe(10)
    expect(b.a).toEqual({ x: '4', y: '3', z: '3' })
  })

  it('cuando hay menos unidades que hijos, reparte 1 a los primeros y deja el resto vacío', () => {
    const b = repartirEnPartesIguales([L('a', 2)], ['x', 'y', 'z'])
    expect(totalAsignado(b, 'a')).toBe(2)
    expect(b.a).toEqual({ x: '1', y: '1', z: '' })
  })

  it('reparte cada línea por separado y el total global se conserva', () => {
    const lineas = [L('a', 10), L('b', 7)]
    const b = repartirEnPartesIguales(lineas, ['x', 'y'])
    expect(totalAMover(lineas, b)).toBe(17)
    expect(validarBorrador(lineas, b)).toBeNull()
  })

  it('sin hijos no reparte nada (no puede quedar stock asignado a nadie)', () => {
    expect(repartirEnPartesIguales([L('a', 10)], [])).toEqual({})
  })
})
