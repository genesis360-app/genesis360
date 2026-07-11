// Tests de la lógica pura del Libro IVA Ventas con NC (REGLA #0 fiscal).
// Plan: tests/specs/facturacion.plan.md §6 (FAC-LIBRO).
//
// Contexto (hallazgo 2026-07-10): hasta v1.125 el Libro IVA Ventas / KPIs / liquidación /
// Posición IVA ignoraban las NC electrónicas emitidas → débito fiscal sobre-declarado tras
// cualquier devolución facturada. `libroIva.ts` calcula lo que la NC RESTA con la MISMA
// lógica de importes del comprobante (espejo de emitir-factura).
import { describe, it, expect } from 'vitest'
import {
  mapDevolucionNc,
  filasLibroNc,
  ivaNcTotal,
  netoNcTotal,
  debitoNeto,
  type NcEmitida,
} from '@/lib/libroIva'

// Fila cruda como la devuelve supabase (numeric de PG llega como STRING — REGLA #0 #5).
const rawNcC = {
  id: 'd1',
  nc_tipo: 'NC-C',
  nc_numero_comprobante: 7,
  nc_cae: '86280549000001',
  nc_fecha: '2026-07-10T14:30:00+00:00',
  created_at: '2026-07-08T10:00:00+00:00',
  devolucion_items: [
    { cantidad: '2', precio_unitario: '500.00', productos: { alicuota_iva: '21.00' } },
    { cantidad: 1, precio_unitario: 500, productos: { alicuota_iva: '10.50' } },
  ],
  ventas: { clientes: { nombre: 'Cliente Uno' } },
}

const ncB21: NcEmitida = {
  id: 'd2', nc_tipo: 'NC-B', nc_numero_comprobante: 12, nc_cae: 'x', fecha: '2026-07-10',
  cliente: 'Cliente Dos',
  items: [{ cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21.00' }],
}

describe('mapDevolucionNc (mapeo crudo de devoluciones → NcEmitida)', () => {
  it('FAC-LIBRO-01 mapea ítems con subtotal = precio × cantidad y alícuota del producto (numeric string)', () => {
    const nc = mapDevolucionNc(rawNcC)
    expect(nc.items).toEqual([
      { cantidad: 2, precio_unitario: 500, subtotal: 1000, alicuota_iva: '21.00' },
      { cantidad: 1, precio_unitario: 500, subtotal: 500, alicuota_iva: '10.50' },
    ])
    expect(nc.cliente).toBe('Cliente Uno')
    expect(nc.nc_cae).toBe('86280549000001')
  })
  it('FAC-LIBRO-02 la fecha del libro es nc_fecha (emisión), NO created_at (devolución)', () => {
    expect(mapDevolucionNc(rawNcC).fecha).toBe('2026-07-10')
  })
  it('FAC-LIBRO-03 sin nc_fecha (NC pre-mig 266) cae a created_at', () => {
    expect(mapDevolucionNc({ ...rawNcC, nc_fecha: null }).fecha).toBe('2026-07-08')
  })
})

describe('filasLibroNc (filas NEGATIVAS del Libro IVA Ventas)', () => {
  it('FAC-LIBRO-04 NC-C: UNA fila, todo a neto negativo, IVA 0 (no discrimina), alícuota "—"', () => {
    const filas = filasLibroNc(mapDevolucionNc(rawNcC))
    expect(filas).toEqual([{
      fecha: '2026-07-10', comprobante: 'NC-C #7', cliente: 'Cliente Uno',
      neto: -1500, alicuota: '—', iva: 0,
    }])
  })
  it('FAC-LIBRO-05 NC-B 21%: resta neto Y débito (desglose idéntico al comprobante)', () => {
    const filas = filasLibroNc(ncB21)
    expect(filas).toEqual([{
      fecha: '2026-07-10', comprobante: 'NC-B #12', cliente: 'Cliente Dos',
      neto: -1000, alicuota: '21', iva: -210,
    }])
  })
  it('FAC-LIBRO-06 NC-B multi-alícuota: una fila por alícuota, "21.00"/"10.50" normalizadas', () => {
    const nc: NcEmitida = {
      ...ncB21,
      items: [
        { cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21.00' },
        { cantidad: 1, precio_unitario: 1105, subtotal: 1105, alicuota_iva: '10.50' },
      ],
    }
    const filas = filasLibroNc(nc)
    expect(filas).toHaveLength(2)
    expect(filas.find(f => f.alicuota === '21')).toMatchObject({ neto: -1000, iva: -210 })
    expect(filas.find(f => f.alicuota === '10.5')).toMatchObject({ neto: -1000, iva: -105 })
  })
  it('FAC-LIBRO-07 nc_tipo null (caso imposible) cae a NC-C: no resta débito de más', () => {
    const filas = filasLibroNc({ ...ncB21, nc_tipo: null })
    expect(filas[0].iva).toBe(0)
  })
})

describe('ivaNcTotal / netoNcTotal / debitoNeto', () => {
  it('FAC-LIBRO-08 NC-C aporta 0 al IVA restado; NC-B aporta su IVA real', () => {
    expect(ivaNcTotal([mapDevolucionNc(rawNcC)])).toBe(0)
    expect(ivaNcTotal([ncB21])).toBe(210)
    expect(ivaNcTotal([mapDevolucionNc(rawNcC), ncB21])).toBe(210)
  })
  it('FAC-LIBRO-09 netoNcTotal: NC-C resta su total; NC-B resta su neto', () => {
    expect(netoNcTotal([mapDevolucionNc(rawNcC)])).toBe(1500)
    expect(netoNcTotal([ncB21])).toBe(1000)
  })
  it('FAC-LIBRO-10 debitoNeto = facturas − NC; puede dar negativo (período solo con NC)', () => {
    expect(debitoNeto(500, [ncB21])).toBe(290)
    expect(debitoNeto(0, [ncB21])).toBe(-210)
    expect(debitoNeto(500, [])).toBe(500)
  })
  it('FAC-LIBRO-11 redondeo a 2 decimales en agregados', () => {
    const nc: NcEmitida = {
      ...ncB21,
      items: [{ cantidad: 3, precio_unitario: 333.33, subtotal: 999.99, alicuota_iva: '21' }],
    }
    const total = ivaNcTotal([nc])
    expect(total).toBe(parseFloat(total.toFixed(2)))
    expect(total).toBeCloseTo(173.55, 2)
  })
})
