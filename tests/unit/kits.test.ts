/**
 * kits.test.ts
 * Tests unitarios para sugerirNombreKit / sugerirPrecioKit — Motor de Rotación, Opción 3 (E2/E4).
 */
import { describe, test, expect } from 'vitest'
import { sugerirNombreKit, sugerirPrecioKit } from '@/lib/kits'

describe('sugerirNombreKit', () => {
  test('un solo componente cantidad 1 → sin multiplicador', () => {
    expect(sugerirNombreKit([{ nombre: 'Fideos 500g', precio_venta: 100, cantidad: 1 }]))
      .toBe('Kit Fideos 500g')
  })

  test('componente con cantidad > 1 → antepone el multiplicador', () => {
    expect(sugerirNombreKit([{ nombre: 'Fideos 500g', precio_venta: 100, cantidad: 2 }]))
      .toBe('Kit 2× Fideos 500g')
  })

  test('varios componentes se unen con " + "', () => {
    expect(sugerirNombreKit([
      { nombre: 'Fideos 500g', precio_venta: 100, cantidad: 2 },
      { nombre: 'Salsa', precio_venta: 50, cantidad: 1 },
    ])).toBe('Kit 2× Fideos 500g + Salsa')
  })

  test('sin componentes → string vacío', () => {
    expect(sugerirNombreKit([])).toBe('')
  })
})

describe('sugerirPrecioKit', () => {
  test('suma precio × cantidad de cada componente', () => {
    expect(sugerirPrecioKit([
      { nombre: 'Fideos 500g', precio_venta: 100, cantidad: 2 },
      { nombre: 'Salsa', precio_venta: 50, cantidad: 1 },
    ])).toBe(250)
  })

  test('E4 — NO resta ningún descuento, es precio de lista completo', () => {
    // Aunque el componente esté en un estado con descuento, esta función no lo sabe ni lo aplica
    // — el descuento lo pone el mecanismo de venta en el momento, no el precio del KIT.
    expect(sugerirPrecioKit([{ nombre: 'Yogur próximo a vencer', precio_venta: 200, cantidad: 3 }]))
      .toBe(600)
  })

  test('componente sin precio cargado (null) no rompe la suma', () => {
    expect(sugerirPrecioKit([
      { nombre: 'Sin precio', precio_venta: null, cantidad: 1 },
      { nombre: 'Con precio', precio_venta: 100, cantidad: 1 },
    ])).toBe(100)
  })

  test('numeric de Postgres como string se normaliza con parseFloat', () => {
    expect(sugerirPrecioKit([{ nombre: 'X', precio_venta: '150.50' as unknown as number, cantidad: 2 }]))
      .toBeCloseTo(301, 5)
  })

  test('sin componentes → 0', () => {
    expect(sugerirPrecioKit([])).toBe(0)
  })
})
