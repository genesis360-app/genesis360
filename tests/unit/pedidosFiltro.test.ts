import { describe, it, expect } from 'vitest'
import {
  parsearPildora, evaluarPildoraPedido, evaluarPildorasPedido, operadoresValidosParaCampo,
  type PedidoFiltrable,
} from '@/lib/pedidosFiltro'

describe('parsearPildora (pedidos)', () => {
  it('reconoce numero/referencia/cliente con alias', () => {
    expect(parsearPildora('Pedido:2')).toMatchObject({ campo: 'numero', valor: '2' })
    expect(parsearPildora('nro:2')).toMatchObject({ campo: 'numero', valor: '2' })
    expect(parsearPildora('ref:ABC')).toMatchObject({ campo: 'referencia', valor: 'ABC' })
    expect(parsearPildora('cliente:Fede')).toMatchObject({ campo: 'cliente', valor: 'Fede' })
  })

  it('sin dos puntos → null (queda libre)', () => {
    expect(parsearPildora('2')).toBeNull()
  })

  it('numero admite operadores numéricos (además del exacto)', () => {
    expect(operadoresValidosParaCampo('numero').map(o => o.operador))
      .toEqual(['contiene', 'no_contiene', 'mayor', 'menor', 'mayor_igual', 'menor_igual'])
  })
})

describe('evaluarPildoraPedido — GO 2026-08-12: "Pedido:2" debe ser EXACTO, no substring', () => {
  const p2: PedidoFiltrable = { numero: 2, referencia: 'REF-A', clienteNombre: 'Fede Messina' }
  const p82: PedidoFiltrable = { numero: 82, referencia: 'REF-B', clienteNombre: 'Gaston Otranto' }
  const p102: PedidoFiltrable = { numero: 102, referencia: 'REF-C', clienteNombre: 'Mario Elmono' }

  it('campo numero con operador "contiene" (":"/"=") matchea SOLO el número exacto', () => {
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(true)
    expect(evaluarPildoraPedido(p82, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(false)
    expect(evaluarPildoraPedido(p102, { id: '1', campo: 'numero', operador: 'contiene', valor: '2' })).toBe(false)
  })

  it('no_contiene es el negado exacto (no también substring)', () => {
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'numero', operador: 'no_contiene', valor: '2' })).toBe(false)
    expect(evaluarPildoraPedido(p82, { id: '1', campo: 'numero', operador: 'no_contiene', valor: '2' })).toBe(true)
  })

  it('operadores numéricos reales (mayor/menor) siguen funcionando', () => {
    expect(evaluarPildoraPedido(p82, { id: '1', campo: 'numero', operador: 'mayor', valor: '50' })).toBe(true)
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'numero', operador: 'mayor', valor: '50' })).toBe(false)
  })

  it('libre (texto suelto sin campo) sigue siendo fuzzy — igual que antes, para tipeo casual', () => {
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'libre', operador: 'contiene', valor: '2' })).toBe(true)
    expect(evaluarPildoraPedido(p82, { id: '1', campo: 'libre', operador: 'contiene', valor: '2' })).toBe(true)
  })

  it('referencia/cliente siguen siendo substring normal (no identificadores)', () => {
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'referencia', operador: 'contiene', valor: 'ref' })).toBe(true)
    expect(evaluarPildoraPedido(p2, { id: '1', campo: 'cliente', operador: 'contiene', valor: 'fede' })).toBe(true)
  })
})

describe('evaluarPildorasPedido (Y/O)', () => {
  const p: PedidoFiltrable = { numero: 2, referencia: 'REF-A', clienteNombre: 'Fede Messina' }

  it('"(Pedido):2 Y (Cliente):fede" — ambas condiciones', () => {
    expect(evaluarPildorasPedido(p, [
      { id: '1', campo: 'numero', operador: 'contiene', valor: '2' },
      { id: '2', campo: 'cliente', operador: 'contiene', valor: 'fede' },
    ], 'Y')).toBe(true)
    expect(evaluarPildorasPedido(p, [
      { id: '1', campo: 'numero', operador: 'contiene', valor: '2' },
      { id: '2', campo: 'cliente', operador: 'contiene', valor: 'zzz' },
    ], 'Y')).toBe(false)
  })
})
