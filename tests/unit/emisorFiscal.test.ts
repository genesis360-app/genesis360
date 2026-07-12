// Tests del resolver de EMISOR FISCAL (multi-CUIT F5, Fase 2 — REGLA #0).
// Plan: tests/specs/facturacion.plan.md §10 (FAC-EMISOR) + wiki/features/multi-cuit.md.
// Espejo de la resolución de la EF emitir-factura — mantener EN SYNC.
import { describe, it, expect } from 'vitest'
import { resolverEmisorId, elegirCertificado, validarPuntoVenta } from '@/lib/emisorFiscal'

const A = 'emisor-aaa'
const B = 'emisor-bbb'
const DEF = 'emisor-default'

describe('resolverEmisorId (factura: override ?? sucursal ?? default)', () => {
  it('FAC-EMISOR-01 sin nada → default del tenant', () => {
    expect(resolverEmisorId({ esNC: false, defaultEmisorId: DEF })).toEqual({ emisorId: DEF })
  })
  it('FAC-EMISOR-02 la sucursal asignada le gana al default', () => {
    expect(resolverEmisorId({ esNC: false, sucursalEmisorId: A, defaultEmisorId: DEF }))
      .toEqual({ emisorId: A })
  })
  it('FAC-EMISOR-03 el override del body le gana a la sucursal y al default', () => {
    expect(resolverEmisorId({ esNC: false, bodyEmisorId: B, sucursalEmisorId: A, defaultEmisorId: DEF }))
      .toEqual({ emisorId: B })
  })
  it('FAC-EMISOR-04 tenant sin emisor (sin CUIT) → null (la EF corta con error claro)', () => {
    expect(resolverEmisorId({ esNC: false })).toEqual({ emisorId: null })
  })
})

describe('resolverEmisorId (NC: SIEMPRE hereda el emisor de la factura original)', () => {
  it('FAC-EMISOR-05 la NC usa el emisor de la venta, ignorando sucursal y default', () => {
    expect(resolverEmisorId({ esNC: true, ventaEmisorId: A, sucursalEmisorId: B, defaultEmisorId: DEF }))
      .toEqual({ emisorId: A })
  })
  it('FAC-EMISOR-06 body coincidente con la factura original → OK (no es error)', () => {
    expect(resolverEmisorId({ esNC: true, ventaEmisorId: A, bodyEmisorId: A })).toEqual({ emisorId: A })
  })
  it('FAC-EMISOR-07 🛑 body con OTRO emisor que la factura original → error (400, nunca cruzar CUIT)', () => {
    const r = resolverEmisorId({ esNC: true, ventaEmisorId: A, bodyEmisorId: B })
    expect(r.emisorId).toBeNull()
    expect(r.error).toMatch(/mismo emisor/i)
  })
  it('FAC-EMISOR-08 NC de venta legacy sin emisor_id → cae a la regla de factura (sucursal/default)', () => {
    expect(resolverEmisorId({ esNC: true, ventaEmisorId: null, sucursalEmisorId: A, defaultEmisorId: DEF }))
      .toEqual({ emisorId: A })
  })
})

describe('elegirCertificado (el cert de un emisor NUNCA firma por otro)', () => {
  const certA = { cert_crt_path: 'a.crt', cert_key_path: 'a.key', emisor_id: A }
  const certLegacy = { cert_crt_path: 'l.crt', cert_key_path: 'l.key', emisor_id: null }
  it('FAC-EMISOR-09 prefiere el cert propio del emisor', () => {
    expect(elegirCertificado([certLegacy, certA], A)).toBe(certA)
  })
  it('FAC-EMISOR-10 sin cert propio → fila legacy sin emisor (pre-mig 267)', () => {
    expect(elegirCertificado([certLegacy, certA], B)).toBe(certLegacy)
  })
  it('FAC-EMISOR-11 sin ningún cert aplicable → null (la EF corta con 400 antes de AFIP)', () => {
    expect(elegirCertificado([certA], B)).toBeNull()
    expect(elegirCertificado([], A)).toBeNull()
    expect(elegirCertificado(null, A)).toBeNull()
  })
})

describe('validarPuntoVenta (los PV de AFIP son POR CUIT)', () => {
  const pvs = [
    { numero: 1, emisor_id: null },   // legacy → cuenta como del default
    { numero: 2, emisor_id: A },
    { numero: '5', emisor_id: B },    // numeric de PG puede llegar string
  ]
  it('FAC-EMISOR-12 emisor default acepta sus PV legacy (sin emisor)', () => {
    expect(validarPuntoVenta(pvs, DEF, true, 1).ok).toBe(true)
  })
  it('FAC-EMISOR-13 🛑 el PV de otro emisor NO sirve (default pidiendo el PV 2 de A → 400)', () => {
    const r = validarPuntoVenta(pvs, DEF, true, 2)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/punto de venta 2/i)
  })
  it('FAC-EMISOR-14 emisor B con PV "5" (string) acepta 5 numérico', () => {
    expect(validarPuntoVenta(pvs, B, false, 5).ok).toBe(true)
    expect(validarPuntoVenta(pvs, B, false, 1).ok).toBe(false)
  })
  it('FAC-EMISOR-15 emisor sin PV configurados → permite cualquier número (legacy PV 1)', () => {
    expect(validarPuntoVenta([], A, false, 1).ok).toBe(true)
    expect(validarPuntoVenta([{ numero: 3, emisor_id: B }], A, false, 1).ok).toBe(true)
  })
})
