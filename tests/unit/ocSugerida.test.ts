// Cobertura de la "OC sugerida" (auto-draft de OC desde stock bajo mínimo).
// Fuente: src/lib/ocSugerida.ts (extraída de AlertasPage.generarOCsSugeridas).
// Plan: tests/specs/oc-sugerida.plan.md.
//
// ⚠ La función replica el comportamiento ACTUAL (con bugs conocidos). Estos tests:
//  (a) LOCKEAN el comportamiento actual para detectar regresiones, y
//  (b) documentan explícitamente los bugs (nombres con 🐛) + el caso reportado por GO.
// Los `it.todo` de abajo describen el comportamiento ESPERADO tras el fix (a revisar
// una vez cerrado el tema de facturación — GO 2026-07-12).
import { describe, it, expect } from 'vitest'
import { armarOCsSugeridas, type AlertaLowStock, type ProveedorProductoLite } from '@/lib/ocSugerida'

const prod = (id: string, nombre: string, actual: number, minimo: number): AlertaLowStock =>
  ({ id, nombre, stock_actual: actual, stock_minimo: minimo })
const pp = (producto_id: string, proveedor_id: string, precio: number | null, min: number | null): ProveedorProductoLite =>
  ({ producto_id, proveedor_id, precio_compra: precio, cantidad_minima: min })

describe('armarOCsSugeridas — comportamiento actual (lock de regresión)', () => {
  it('OC-SUG-01 agrupa por proveedor y calcula el faltante = mínimo − actual', () => {
    const r = armarOCsSugeridas(
      [prod('p1', 'Coca', 2, 10), prod('p2', 'Pan', 0, 5)],
      [pp('p1', 'provA', 100, null), pp('p2', 'provA', 50, null)],
    )
    expect(r.sinProveedor).toEqual([])
    expect(r.ocs).toHaveLength(1)               // ambos del mismo proveedor → 1 OC
    expect(r.ocs[0].proveedor_id).toBe('provA')
    expect(r.ocs[0].items).toEqual([
      { producto_id: 'p1', cantidad: 8, precio: 100 },  // 10 − 2
      { producto_id: 'p2', cantidad: 5, precio: 50 },   // 5 − 0
    ])
  })

  it('OC-SUG-02 productos de proveedores distintos → una OC por proveedor', () => {
    const r = armarOCsSugeridas(
      [prod('p1', 'Coca', 0, 3), prod('p2', 'Pan', 0, 3)],
      [pp('p1', 'provA', 10, null), pp('p2', 'provB', 20, null)],
    )
    expect(r.ocs).toHaveLength(2)
    expect(r.ocs.map(o => o.proveedor_id).sort()).toEqual(['provA', 'provB'])
  })

  it('OC-SUG-03 producto sin proveedor asociado → va a sinProveedor (no entra a ninguna OC)', () => {
    const r = armarOCsSugeridas([prod('p1', 'Sin Prov', 0, 5)], [])
    expect(r.ocs).toEqual([])
    expect(r.sinProveedor).toEqual(['Sin Prov'])
  })

  it('OC-SUG-04 cantidad mínima: nunca pide menos que cantidad_minima del proveedor, ni menos de 1', () => {
    // faltante 1 pero cantidad_minima 6 → pide 6
    const r = armarOCsSugeridas([prod('p1', 'X', 9, 10)], [pp('p1', 'provA', 5, 6)])
    expect(r.ocs[0].items[0].cantidad).toBe(6)
    // ya cubierto (actual ≥ mínimo) → faltante 0, sin cantidad_minima → mínimo 1
    const r2 = armarOCsSugeridas([prod('p2', 'Y', 10, 10)], [pp('p2', 'provA', 5, null)])
    expect(r2.ocs[0].items[0].cantidad).toBe(1)
  })

  it('🐛 OC-SUG-BUG1 (reportado GO 2026-07-12) genera UNA LÍNEA POR ALERTA → dos alertas del mismo SKU = líneas DUPLICADAS', () => {
    // Dos alertas del MISMO producto p1 (p.ej. una por sucursal): hoy salen 2 líneas iguales
    // en vez de una sola consolidada con la cantidad total. Lockea el bug hasta corregirlo.
    const r = armarOCsSugeridas(
      [prod('p1', 'Coca', 0, 2), prod('p1', 'Coca', 0, 2)],
      [pp('p1', 'provA', 100, null)],
    )
    expect(r.ocs).toHaveLength(1)
    expect(r.ocs[0].items).toHaveLength(2)                 // ← BUG: deberían ser 1
    expect(r.ocs[0].items).toEqual([
      { producto_id: 'p1', cantidad: 2, precio: 100 },
      { producto_id: 'p1', cantidad: 2, precio: 100 },
    ])
  })

  it('🐛 OC-SUG-BUG5 precio null cuando el proveedor_producto no tiene precio_compra', () => {
    const r = armarOCsSugeridas([prod('p1', 'X', 0, 3)], [pp('p1', 'provA', null, null)])
    expect(r.ocs[0].items[0].precio).toBeNull()   // ← la OC sale con línea sin precio
  })
})

// Comportamiento ESPERADO tras el fix (a implementar cuando se cierre facturación).
describe('🐛 fixes pendientes de la OC sugerida (GO 2026-07-12) — a revisar', () => {
  it.todo('BUG1: consolidar por producto → una sola línea por SKU con la cantidad TOTAL')
  it.todo('BUG2: usar el stock POR SUCURSAL (no el global del maestro) para el faltante')
  it.todo('BUG3: elegir el proveedor de forma determinística (preferido / más barato), no el primero')
  it.todo('BUG4: no duplicar OC/ítems contra OC abiertas ya existentes (dedup con productosConOC)')
  it.todo('BUG5: sin precio_compra → avisar / bloquear en vez de emitir la OC con precio nulo')
})
