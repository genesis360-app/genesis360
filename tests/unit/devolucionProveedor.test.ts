import { describe, it, expect } from 'vitest'
import { montoDevolucion, validarDevolucion } from '@/lib/devolucionProveedor'

// Compras CO4 — devolución a proveedor

describe('montoDevolucion', () => {
  it('suma cantidad × costo', () => {
    expect(montoDevolucion([{ cantidad: 2, costo_unitario: 100 }, { cantidad: 1, costo_unitario: 50 }])).toBe(250)
  })
  it('ignora negativos', () => {
    expect(montoDevolucion([{ cantidad: -2, costo_unitario: 100 }, { cantidad: 3, costo_unitario: 10 }])).toBe(30)
  })
  it('redondea a 2 decimales', () => {
    expect(montoDevolucion([{ cantidad: 3, costo_unitario: 10.333 }])).toBe(31)
  })
})

describe('validarDevolucion', () => {
  const base = {
    proveedorId: 'p1', motivo: 'Producto roto / dañado', forma: 'credito_cc' as const,
    items: [{ producto_id: 'a', cantidad: 2, stockDisponible: 10, nombre: 'A' }],
  }
  it('caso válido', () => {
    expect(validarDevolucion(base)).toEqual({ ok: true })
  })
  it('sin proveedor', () => {
    expect(validarDevolucion({ ...base, proveedorId: null }).ok).toBe(false)
  })
  it('sin motivo', () => {
    expect(validarDevolucion({ ...base, motivo: '' }).ok).toBe(false)
  })
  it('sin forma', () => {
    expect(validarDevolucion({ ...base, forma: null as any }).ok).toBe(false)
  })
  it('sin ítems con cantidad', () => {
    expect(validarDevolucion({ ...base, items: [{ producto_id: 'a', cantidad: 0, stockDisponible: 10 }] }).ok).toBe(false)
  })
  it('cantidad supera el stock disponible', () => {
    const r = validarDevolucion({ ...base, items: [{ producto_id: 'a', cantidad: 20, stockDisponible: 10, nombre: 'A' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('stock suficiente')
  })
})
