import { describe, it, expect } from 'vitest'
import {
  parsearPildora, evaluarPildoraProducto, evaluarPildorasProducto, operadoresValidosParaCampo,
  type ProductoFiltrable,
} from '@/lib/productosFiltro'

describe('parsearPildora (productos)', () => {
  it('reconoce nombre/sku/código con alias', () => {
    expect(parsearPildora('Nombre:coca')).toMatchObject({ campo: 'nombre', valor: 'coca' })
    expect(parsearPildora('sku:43')).toMatchObject({ campo: 'sku', valor: '43' })
    expect(parsearPildora('barras:770123')).toMatchObject({ campo: 'codigo', valor: '770123' })
  })

  it('sin dos puntos → null (queda libre)', () => {
    expect(parsearPildora('coca cola')).toBeNull()
  })

  it('campos de producto son todos de texto (sin operadores numéricos)', () => {
    expect(operadoresValidosParaCampo('nombre').map(o => o.operador)).toEqual(['contiene', 'no_contiene'])
  })
})

describe('evaluarPildoraProducto', () => {
  const p: ProductoFiltrable = { nombre: 'Coca Cola 2.5L', sku: 'SKU-4312', codigoBarras: '7801610001523' }

  it('libre matchea por nombre, sku o código', () => {
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'libre', operador: 'contiene', valor: 'coca' })).toBe(true)
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'libre', operador: 'contiene', valor: 'sku-43' })).toBe(true)
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'libre', operador: 'contiene', valor: '780161' })).toBe(true)
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'libre', operador: 'contiene', valor: 'zzz' })).toBe(false)
  })

  it('campo explícito solo matchea ESE campo', () => {
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'sku', operador: 'contiene', valor: 'coca' })).toBe(false)
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'codigo', operador: 'contiene', valor: '780161' })).toBe(true)
  })

  it('no_contiene es el negado exacto', () => {
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'nombre', operador: 'no_contiene', valor: 'coca' })).toBe(false)
    expect(evaluarPildoraProducto(p, { id: '1', campo: 'nombre', operador: 'no_contiene', valor: 'pepsi' })).toBe(true)
  })
})

describe('evaluarPildorasProducto (Y/O)', () => {
  const p: ProductoFiltrable = { nombre: 'Coca Cola 2.5L', sku: 'SKU-4312', codigoBarras: null }

  it('"(Nombre):coca Y (SKU):4312" — ambas condiciones sobre el mismo producto', () => {
    expect(evaluarPildorasProducto(p, [
      { id: '1', campo: 'nombre', operador: 'contiene', valor: 'coca' },
      { id: '2', campo: 'sku', operador: 'contiene', valor: '4312' },
    ], 'Y')).toBe(true)
    expect(evaluarPildorasProducto(p, [
      { id: '1', campo: 'nombre', operador: 'contiene', valor: 'coca' },
      { id: '2', campo: 'sku', operador: 'contiene', valor: 'zzz' },
    ], 'Y')).toBe(false)
  })

  it('combinador O alcanza con una', () => {
    expect(evaluarPildorasProducto(p, [
      { id: '1', campo: 'nombre', operador: 'contiene', valor: 'zzz' },
      { id: '2', campo: 'sku', operador: 'contiene', valor: '4312' },
    ], 'O')).toBe(true)
  })
})
