import { describe, it, expect } from 'vitest'
import {
  cantidadParaPrecio, itemsParaMotor, mapaPreciosMotor, precioServidorVigente, estadoPreciosCarrito,
} from '@/lib/motorPrecio'

const A = 'aaaaaaaa-0000-0000-0000-000000000000'
const B = 'bbbbbbbb-0000-0000-0000-000000000000'

describe('motorPrecio — armado del pedido al motor', () => {
  it('suma la cantidad por SKU en todo el carrito (el mayorista es por volumen, mig 306)', () => {
    const items = itemsParaMotor([
      { producto_id: B, cantidad: 2 }, { producto_id: A, cantidad: 60 }, { producto_id: A, cantidad: 40 },
    ])
    expect(items).toEqual([
      { key: A, producto_id: A, cantidad: 100 },
      { key: B, producto_id: B, cantidad: 2 },
    ])
  })

  it('con series cuenta las elegidas, no la cantidad tipeada', () => {
    expect(cantidadParaPrecio({ producto_id: A, cantidad: 3, tiene_series: true, series_seleccionadas: ['x'] })).toBe(1)
  })

  it('cantidad inválida (NaN, negativa) cuenta 0 — nunca manda basura al motor', () => {
    expect(cantidadParaPrecio({ producto_id: A, cantidad: NaN })).toBe(0)
    expect(cantidadParaPrecio({ producto_id: A, cantidad: -2 })).toBe(0)
  })

  it('el orden del carrito no cambia la clave de la consulta', () => {
    const x = itemsParaMotor([{ producto_id: A, cantidad: 1 }, { producto_id: B, cantidad: 1 }])
    const y = itemsParaMotor([{ producto_id: B, cantidad: 1 }, { producto_id: A, cantidad: 1 }])
    expect(JSON.stringify(x)).toBe(JSON.stringify(y))
  })
})

describe('motorPrecio — respuesta del servidor', () => {
  it('normaliza numeric como string (gotcha REGLA #0)', () => {
    const m = mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: '100', precio_unitario: '70.00', precio_base: '70', precio_lista: '100.00', mecanismo: 'tier' }] })
    expect(m[A].precio_unitario).toBe(70)
    expect(m[A].cantidad_sku).toBe(100)
    expect(m[A].error).toBeUndefined()
  })

  it('una línea sin precio y sin error se marca como error (no se cobra)', () => {
    const m = mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: 1 }] })
    expect(m[A].error).toBe('Sin precio')
  })

  it('precio 0 es un precio válido, no un error', () => {
    const m = mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: 1, precio_unitario: 0 }] })
    expect(m[A].error).toBeUndefined()
    expect(precioServidorVigente(m, A, 1)?.precio_unitario).toBe(0)
  })

  it('un precio calculado para OTRA cantidad no vale (cambió el carrito)', () => {
    const m = mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: 10, precio_unitario: 80 }] })
    expect(precioServidorVigente(m, A, 10)?.precio_unitario).toBe(80)
    expect(precioServidorVigente(m, A, 9)).toBeNull()
  })
})

describe('motorPrecio — ¿se puede cobrar?', () => {
  const mapa = mapaPreciosMotor({ lineas: [
    { key: A, producto_id: A, cantidad_sku: 100, precio_unitario: 70 },
    { key: B, producto_id: B, cantidad_sku: 2, precio_unitario: 5 },
  ] })
  const cart = [{ producto_id: A, cantidad: 60 }, { producto_id: A, cantidad: 40 }, { producto_id: B, cantidad: 2 }]

  it('listo cuando todas las líneas tienen precio vigente', () => {
    expect(estadoPreciosCarrito(cart, mapa, { cargando: false })).toEqual({ listo: true })
  })

  it('calculando si un SKU todavía no tiene precio para su cantidad actual', () => {
    expect(estadoPreciosCarrito([...cart, { producto_id: A, cantidad: 1 }], mapa, { cargando: true }))
      .toEqual({ listo: false, motivo: 'calculando' })
  })

  it('calculando mientras hay una consulta en curso aunque los precios parezcan vigentes', () => {
    expect(estadoPreciosCarrito(cart, mapa, { cargando: true })).toEqual({ listo: false, motivo: 'calculando' })
  })

  it('sin conexión con el servidor: no se cobra (PL-5 = A)', () => {
    const e = estadoPreciosCarrito(cart, undefined, { cargando: false, errorConsulta: 'Failed to fetch' })
    expect(e.listo).toBe(false)
  })

  it('un producto con error (p. ej. USD sin cotización) bloquea y dice cuál', () => {
    const m = mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: 1, error: 'El producto tiene precio en dólares y no hay cotización del dólar BNA' }] })
    const e = estadoPreciosCarrito([{ producto_id: A, cantidad: 1 }], m, { cargando: false })
    expect(e).toMatchObject({ listo: false, motivo: 'error', productoId: A })
  })

  it('carrito vacío no bloquea nada', () => {
    expect(estadoPreciosCarrito([], undefined, { cargando: false, errorConsulta: 'x' })).toEqual({ listo: true })
  })
})
