import { describe, it, expect } from 'vitest'
import { stockPorProducto } from '../../src/lib/stockPorProducto'

// GO 2026-10-08: Productos e Inventario siguen el selector de sucursal. El total ya no es el de todas las sucursales.
describe('stockPorProducto', () => {
  const VENDIBLE = 'ev-ok', CUARENTENA = 'ev-cuar'

  it('avanzado: disponible = estados vendibles − reservado; total = todo, en cualquier estado', () => {
    const r = stockPorProducto([
      { producto_id: 'p1', cantidad: 10, cantidad_reservada: 2, estado_id: VENDIBLE },
      { producto_id: 'p1', cantidad: 5, estado_id: CUARENTENA },
    ], new Set([VENDIBLE]))
    expect(r.disponible.p1).toBe(8)
    expect(r.total.p1).toBe(15)
  })

  it('básico (sin estados): todo es vendible', () => {
    const r = stockPorProducto([{ producto_id: 'p1', cantidad: 4, cantidad_reservada: 1, estado_id: null }], null)
    expect(r.disponible.p1).toBe(3)
    expect(r.total.p1).toBe(4)
  })

  it('el numeric de Postgres llega como string', () => {
    const r = stockPorProducto([{ producto_id: 'p1', cantidad: '6.0000', cantidad_reservada: '1.0000', estado_id: null }], null)
    expect(r.total.p1).toBe(6)
    expect(r.disponible.p1).toBe(5)
  })

  it('con series cuenta las series activas, no la cantidad', () => {
    const r = stockPorProducto([{
      producto_id: 'p1', cantidad: 99, estado_id: VENDIBLE,
      inventario_series: [{ activo: true }, { activo: true }, { activo: false }],
    }], new Set([VENDIBLE]))
    expect(r.total.p1).toBe(2)
    expect(r.disponible.p1).toBe(2)
  })

  it('cantidad negativa o basura no resta', () => {
    const r = stockPorProducto([{ producto_id: 'p1', cantidad: -3, estado_id: null }, { producto_id: 'p1', cantidad: 'x', estado_id: null }], null)
    expect(r.total.p1).toBe(0)
  })

  it('producto sin líneas no aparece (= 0 en esa sucursal)', () => {
    expect(stockPorProducto([], null).total.p9).toBeUndefined()
  })
})
