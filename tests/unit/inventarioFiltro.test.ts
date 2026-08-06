import { describe, it, expect } from 'vitest'
import {
  parsearPildora, evaluarPildoraLinea, evaluarPildorasLinea, productoMatcheaPildoras,
  type LineaFiltrable, type PildoraInventario,
} from '@/lib/inventarioFiltro'

describe('parsearPildora (inventario)', () => {
  it('reconoce los 5 campos', () => {
    expect(parsearPildora('Producto:coca')).toMatchObject({ campo: 'producto' })
    expect(parsearPildora('sku:43')).toMatchObject({ campo: 'sku' })
    expect(parsearPildora('barras:770123')).toMatchObject({ campo: 'codigo' })
    expect(parsearPildora('LPN:LPN-001')).toMatchObject({ campo: 'lpn' })
    expect(parsearPildora('ubic:Depósito')).toMatchObject({ campo: 'ubicacion' })
  })
})

describe('evaluarPildoraLinea', () => {
  const l: LineaFiltrable = {
    productoNombre: 'Coca Cola 2.5L', sku: 'SKU-4312', codigoBarras: '7801610001523',
    lpn: 'LPN-20260806-ABC', ubicacionNombre: 'Depósito Central',
  }

  it('libre matchea por cualquiera de los 5 campos', () => {
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'libre', operador: 'contiene', valor: 'coca' })).toBe(true)
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'libre', operador: 'contiene', valor: 'lpn-2026' })).toBe(true)
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'libre', operador: 'contiene', valor: 'depósito' })).toBe(true)
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'libre', operador: 'contiene', valor: 'zzz' })).toBe(false)
  })

  it('campo explícito solo matchea ESE campo', () => {
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'lpn', operador: 'contiene', valor: 'depósito' })).toBe(false)
    expect(evaluarPildoraLinea(l, { id: '1', campo: 'ubicacion', operador: 'contiene', valor: 'depósito' })).toBe(true)
  })
})

describe('evaluarPildorasLinea (Y exige ambos en la MISMA línea)', () => {
  const l: LineaFiltrable = {
    productoNombre: 'Coca Cola', sku: 'SKU-1', codigoBarras: null, lpn: 'LPN-A', ubicacionNombre: 'Depósito',
  }
  const enDeposito: PildoraInventario = { id: '1', campo: 'ubicacion', operador: 'contiene', valor: 'depósito' }
  const lpnA: PildoraInventario = { id: '2', campo: 'lpn', operador: 'contiene', valor: 'lpn-a' }
  const lpnZ: PildoraInventario = { id: '3', campo: 'lpn', operador: 'contiene', valor: 'zzz' }

  it('Y: ambas condiciones sobre la misma línea', () => {
    expect(evaluarPildorasLinea(l, [enDeposito, lpnA], 'Y')).toBe(true)
    expect(evaluarPildorasLinea(l, [enDeposito, lpnZ], 'Y')).toBe(false)
  })
})

describe('productoMatcheaPildoras (agrupa por producto, exige ambas píldoras en UNA línea)', () => {
  const producto = { nombre: 'Coca Cola 2.5L', sku: 'SKU-1', codigoBarras: null }
  const lineas = [
    { lpn: 'LPN-ROJO', ubicacionNombre: 'Depósito' },
    { lpn: 'LPN-AZUL', ubicacionNombre: 'Local' },
  ]

  it('"(Ubicación):Depósito Y (LPN):AZUL" no matchea — están en líneas DISTINTAS', () => {
    const pildoras: PildoraInventario[] = [
      { id: '1', campo: 'ubicacion', operador: 'contiene', valor: 'depósito' },
      { id: '2', campo: 'lpn', operador: 'contiene', valor: 'azul' },
    ]
    expect(productoMatcheaPildoras(producto, lineas, pildoras, 'Y')).toBe(false)
  })

  it('"(Ubicación):Depósito Y (LPN):ROJO" matchea — misma línea', () => {
    const pildoras: PildoraInventario[] = [
      { id: '1', campo: 'ubicacion', operador: 'contiene', valor: 'depósito' },
      { id: '2', campo: 'lpn', operador: 'contiene', valor: 'rojo' },
    ]
    expect(productoMatcheaPildoras(producto, lineas, pildoras, 'Y')).toBe(true)
  })

  it('con combinador O, alcanza con que una línea matchee una sola condición', () => {
    const pildoras: PildoraInventario[] = [
      { id: '1', campo: 'lpn', operador: 'contiene', valor: 'zzz' },
      { id: '2', campo: 'ubicacion', operador: 'contiene', valor: 'local' },
    ]
    expect(productoMatcheaPildoras(producto, lineas, pildoras, 'O')).toBe(true)
  })

  it('producto sin líneas solo matchea por producto/sku/código', () => {
    const pildoras: PildoraInventario[] = [{ id: '1', campo: 'producto', operador: 'contiene', valor: 'coca' }]
    expect(productoMatcheaPildoras(producto, [], pildoras, 'Y')).toBe(true)
    const pildorasLpn: PildoraInventario[] = [{ id: '1', campo: 'lpn', operador: 'contiene', valor: 'x' }]
    expect(productoMatcheaPildoras(producto, [], pildorasLpn, 'Y')).toBe(false)
  })
})
