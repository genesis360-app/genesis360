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

import { etiquetaCategoria, textoCartelPrecio, evaluarTopeDescuento } from '@/lib/motorPrecio'
import { calcularDescuentoEstadoLinea } from '@/lib/descuentoEstado'

describe('Fase 4 — categoría (casos de referencia del relevamiento)', () => {
  // Bidón: lista $100, tier "10 o más a $80". El motor ya resolvió el precio; acá se valida lo que muestra el POS.
  const linea = (o: Record<string, unknown>) => mapaPreciosMotor({ lineas: [{ key: A, producto_id: A, cantidad_sku: 12, precio_lista: 100, ...o }] })[A]

  it('A1 empate (cat 20 % vs tier $80): se informa la categoría y el cartel explica que no se suman', () => {
    const p = linea({ precio_unitario: 80, mecanismo: 'categoria', precio_sin_categoria: 80, mecanismo_sin_categoria: 'tier', categoria_nombre: 'Colocadores', categoria_pct: 20, precio_categoria: 80, estado_compite: true })
    expect(etiquetaCategoria(p)).toBe('Categoría Colocadores: −20 % sobre lista')
    expect(textoCartelPrecio(p, 'Bidón 20 L')).toMatch(/se aplica el 20 % de la categoría Colocadores \(\$80\)\. No se suma al precio por cantidad \(\$80\)/)
  })

  it('A1 gana el tier ($60 vs cat $80): sin etiqueta de categoría, el cartel dice que el tier es mejor', () => {
    const p = linea({ precio_unitario: 60, mecanismo: 'tier', precio_sin_categoria: 60, mecanismo_sin_categoria: 'tier', categoria_nombre: 'Colocadores', categoria_pct: 20, precio_categoria: 80, estado_compite: true })
    expect(etiquetaCategoria(p)).toBeNull()
    expect(textoCartelPrecio(p, 'Bidón 20 L')).toMatch(/se aplica el precio por cantidad \(\$60\), que es mejor que el 20 % de la categoría/)
  })

  it('A1 sin tier en juego (5 u, cat 20 %): etiqueta sí, cartel no (no compitió nada)', () => {
    const p = linea({ cantidad_sku: 5, precio_unitario: 80, mecanismo: 'categoria', precio_sin_categoria: 100, mecanismo_sin_categoria: 'lista', categoria_nombre: 'Colocadores', categoria_pct: 20, precio_categoria: 80 })
    expect(etiquetaCategoria(p)).not.toBeNull()
    expect(textoCartelPrecio(p, 'Bidón 20 L')).toBeNull()
  })

  it('cliente sin categoría: ni etiqueta ni cartel', () => {
    const p = linea({ precio_unitario: 80, mecanismo: 'tier', precio_sin_categoria: 80, mecanismo_sin_categoria: 'tier' })
    expect(etiquetaCategoria(p)).toBeNull()
    expect(textoCartelPrecio(p, 'Bidón 20 L')).toBeNull()
    expect(p.estado_compite).toBe(false)
  })

  it('A2: 4 bidones de un lote con 15 % y la línea a $80 → el estado no se aplica (cartel lo dice)', () => {
    const fuentes = [{ cantidad: 8, estado_descuento_pct: null }, { cantidad: 4, estado_nombre: 'Próximo a vencer', estado_descuento_pct: 15 }]
    expect(calcularDescuentoEstadoLinea(fuentes, 80, { precioLista: 100 }).monto).toBe(0)
    const p = linea({ precio_unitario: 80, mecanismo: 'categoria', precio_sin_categoria: 80, mecanismo_sin_categoria: 'tier', categoria_nombre: 'Colocadores', categoria_pct: 20, precio_categoria: 80 })
    expect(textoCartelPrecio(p, 'Bidón 20 L', { nombre: 'Próximo a vencer', pct: 15, perdio: true })).toMatch(/lote "Próximo a vencer" \(15 %\)/)
  })

  it('A2: con 25 % esos 4 salen a $75 ($5 menos c/u = $20)', () => {
    const fuentes = [{ cantidad: 8, estado_descuento_pct: null }, { cantidad: 4, estado_nombre: 'Próximo a vencer', estado_descuento_pct: 25 }]
    expect(calcularDescuentoEstadoLinea(fuentes, 80, { precioLista: 100 }).monto).toBe(20)
  })

  it('sin categoría el estado se sigue ACUMULANDO sobre el precio (como hoy): 4 × $80 × 15 % = $48', () => {
    const fuentes = [{ cantidad: 4, estado_nombre: 'Próximo a vencer', estado_descuento_pct: 15 }]
    expect(calcularDescuentoEstadoLinea(fuentes, 80).monto).toBe(48)
    expect(calcularDescuentoEstadoLinea(fuentes, 80, null).monto).toBe(48)
  })
})

describe('Fase 4 — tope de descuento acumulado (A4 + PL-1)', () => {
  it('sin tope configurado no rige', () => {
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 12 }], 600, null)).toMatchObject({ rige: false, excede: false })
  })
  it('12 u a $80 con lista $100 = 20 %: con tope 15 excede, con tope 20 no (en el borde pasa)', () => {
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 12 }], 960, 15)).toEqual({ rige: true, excede: true, descuentoPct: 20 })
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 12 }], 960, 20).excede).toBe(false)
  })
  it('el tope llega como string (numeric de Postgres)', () => {
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 1 }], 70, '25' as unknown as number).excede).toBe(true)
  })
  it('tope 0: cualquier descuento excede', () => {
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 1 }], 99, 0).excede).toBe(true)
    expect(evaluarTopeDescuento([{ precioLista: 100, cantidad: 1 }], 100, 0).excede).toBe(false)
  })
})
