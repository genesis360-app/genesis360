import { describe, it, expect } from 'vitest'
import {
  parsearPildora, evaluarPildoraVenta, evaluarPildorasVenta,
  type VentaFiltrable,
} from '@/lib/ventasFiltro'

describe('parsearPildora (ventas)', () => {
  it('reconoce numero/cliente con alias', () => {
    expect(parsearPildora('Venta:2')).toMatchObject({ campo: 'numero', valor: '2' })
    expect(parsearPildora('nro:2')).toMatchObject({ campo: 'numero', valor: '2' })
    expect(parsearPildora('cliente:Fede')).toMatchObject({ campo: 'cliente', valor: 'Fede' })
  })

  it('sin dos puntos → null (queda libre)', () => {
    expect(parsearPildora('2')).toBeNull()
  })
})

describe('evaluarPildoraVenta — "Venta:2" debe ser EXACTO, no substring', () => {
  const v2: VentaFiltrable = { numero: 2, clienteNombre: 'Fede Messina' }
  const v12: VentaFiltrable = { numero: 12, clienteNombre: 'Gaston Otranto' }
  const v201: VentaFiltrable = { numero: 201, clienteNombre: 'Mario Elmono' }

  it('campo numero con operador "contiene" (":"/"=") matchea SOLO el número exacto', () => {
    expect(evaluarPildoraVenta(v2, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(true)
    expect(evaluarPildoraVenta(v12, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(false)
    expect(evaluarPildoraVenta(v201, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(false)
  })

  it('libre (texto suelto) sigue siendo fuzzy', () => {
    expect(evaluarPildoraVenta(v12, { id: '1', campo: 'libre', operador: 'contiene', valor: '2' })).toBe(true)
  })

  it('cliente sigue siendo substring normal', () => {
    expect(evaluarPildoraVenta(v2, { id: '1', campo: 'cliente', operador: 'contiene', valor: 'fede' })).toBe(true)
  })
})

describe('evaluarPildorasVenta (Y/O)', () => {
  const v: VentaFiltrable = { numero: 2, clienteNombre: 'Fede Messina' }

  it('"(Venta):2 Y (Cliente):fede"', () => {
    expect(evaluarPildorasVenta(v, [
      { id: '1', campo: 'numero', operador: 'contiene', valor: '2' },
      { id: '2', campo: 'cliente', operador: 'contiene', valor: 'fede' },
    ], 'Y')).toBe(true)
  })
})
