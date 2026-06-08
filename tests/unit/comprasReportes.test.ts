import { describe, it, expect } from 'vitest'
import {
  saldoOC, comprasPorProveedor, calificarProveedor, topProductosComprados,
  agingPagos, ocsVencidas, evolucionCostos, type OCReporte, type OCItemReporte,
} from '@/lib/comprasReportes'

// Compras CO8 — reportes + calificación de proveedor

const ocs: OCReporte[] = [
  { id: '1', proveedor_id: 'p1', proveedor_nombre: 'Prov 1', estado: 'recibida', monto_total: 1000, monto_pagado: 1000, created_at: '2026-06-01T10:00:00' },
  { id: '2', proveedor_id: 'p1', proveedor_nombre: 'Prov 1', estado: 'recibida', monto_total: 500, monto_pagado: 0, created_at: '2026-06-02T10:00:00' },
  { id: '3', proveedor_id: 'p2', proveedor_nombre: 'Prov 2', estado: 'enviada', monto_total: 800, monto_pagado: 0, fecha_esperada: '2026-06-01', created_at: '2026-05-20T10:00:00' },
  { id: '4', proveedor_id: 'p2', proveedor_nombre: 'Prov 2', estado: 'cancelada', monto_total: 9999, created_at: '2026-06-01T10:00:00' },
]

describe('saldoOC', () => {
  it('total - pagado - descuento', () => {
    expect(saldoOC({ id: 'x', estado: 'confirmada', monto_total: 1000, monto_pagado: 300, monto_descuento: 100, created_at: '' })).toBe(600)
  })
})

describe('comprasPorProveedor + calificación (G1/E4)', () => {
  const res = comprasPorProveedor(ocs)
  it('ignora canceladas y agrupa por proveedor', () => {
    expect(res.length).toBe(2)
    const p1 = res.find(r => r.proveedor_id === 'p1')!
    expect(p1.cantidadOCs).toBe(2)
    expect(p1.montoTotal).toBe(1500)
    expect(p1.recibidas).toBe(2)
    expect(p1.cumplimientoPct).toBe(100)
    expect(p1.score).toBe('A')
  })
  it('proveedor sin recibidas → score bajo', () => {
    const p2 = res.find(r => r.proveedor_id === 'p2')!
    expect(p2.cumplimientoPct).toBe(0)
    expect(p2.score).toBe('—')
  })
  it('ordena por monto desc', () => {
    expect(res[0].proveedor_id).toBe('p1')
  })
})

describe('calificarProveedor', () => {
  it('umbrales A/B/C', () => {
    expect(calificarProveedor(90)).toBe('A')
    expect(calificarProveedor(70)).toBe('B')
    expect(calificarProveedor(30)).toBe('C')
    expect(calificarProveedor(0)).toBe('—')
  })
})

describe('topProductosComprados (G1)', () => {
  const items: OCItemReporte[] = [
    { producto_id: 'a', producto_nombre: 'A', cantidad: 10, precio_unitario: 100 },
    { producto_id: 'a', producto_nombre: 'A', cantidad: 5, precio_unitario: 100 },
    { producto_id: 'b', producto_nombre: 'B', cantidad: 1, precio_unitario: 50 },
  ]
  it('agrega por producto y ordena por monto', () => {
    const r = topProductosComprados(items)
    expect(r[0].producto_id).toBe('a')
    expect(r[0].cantidad).toBe(15)
    expect(r[0].monto).toBe(1500)
  })
})

describe('agingPagos (G1)', () => {
  it('agrupa saldos por antigüedad', () => {
    const r = agingPagos(ocs, '2026-06-08')
    // OC2 saldo 500 (creada 2026-06-02 → 6 días) + OC3 saldo 800 (creada 2026-05-20 → 19 días) = ambas 0-30
    expect(r.bucket_0_30).toBe(1300)
    expect(r.total).toBe(1300)
  })
  it('ignora canceladas y sin saldo', () => {
    const r = agingPagos([{ id: 'z', estado: 'cancelada', monto_total: 100, created_at: '2026-01-01T00:00:00' }], '2026-06-08')
    expect(r.total).toBe(0)
  })
})

describe('ocsVencidas (G1)', () => {
  it('enviadas/confirmadas con fecha esperada pasada', () => {
    const r = ocsVencidas(ocs, '2026-06-08')
    expect(r.length).toBe(1)
    expect(r[0].id).toBe('3')
  })
})

describe('evolucionCostos (G1)', () => {
  const items: OCItemReporte[] = [
    { producto_id: 'a', producto_nombre: 'A', cantidad: 1, precio_unitario: 100, fecha: '2026-01-01' },
    { producto_id: 'a', producto_nombre: 'A', cantidad: 1, precio_unitario: 150, fecha: '2026-06-01' },
    { producto_id: 'b', producto_nombre: 'B', cantidad: 1, precio_unitario: 50, fecha: '2026-01-01' },
  ]
  it('calcula variación entre primer y último precio (>= 2 compras)', () => {
    const r = evolucionCostos(items)
    expect(r.length).toBe(1)  // b tiene 1 sola compra
    expect(r[0].producto_id).toBe('a')
    expect(r[0].primerPrecio).toBe(100)
    expect(r[0].ultimoPrecio).toBe(150)
    expect(r[0].variacionPct).toBe(50)
  })
})
