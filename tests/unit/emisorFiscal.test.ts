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

// ─── Identidad para COMPROBANTES (cutover mig 271 / v1.133.0 — fuente única) ─────────────
// El bug real que estos tests guardan: con multi-CUIT, el CAE sale con el CUIT del EMISOR de
// la venta pero el PDF imprimía la identidad del TENANT → papel ≠ AFIP.
import { elegirIdentidadEmisor, puntoVentaDelEmisor } from '@/lib/emisorFiscal'

describe('elegirIdentidadEmisor (identidad que imprime el comprobante)', () => {
  const eDef = { id: DEF, es_default: true, cuit: '23-32031506-9' }
  const eA   = { id: A,   es_default: false, cuit: '20-42237416-8' }
  const eB   = { id: B,   es_default: false, cuit: '23-18383448-9' }
  const rows = [eDef, eA, eB]

  it('FAC-IDENT-01 🛑 la venta emitida por un emisor ADICIONAL imprime SU identidad, no la del default', () => {
    expect(elegirIdentidadEmisor(rows, { ventaEmisorId: A })).toBe(eA)
  })
  it('FAC-IDENT-02 el emisor de la VENTA gana sobre el de la sucursal (histórico manda)', () => {
    expect(elegirIdentidadEmisor(rows, { ventaEmisorId: A, sucursalEmisorId: B })).toBe(eA)
  })
  it('FAC-IDENT-03 sin emisor en la venta (presupuesto/remito) → el de la sucursal', () => {
    expect(elegirIdentidadEmisor(rows, { sucursalEmisorId: B })).toBe(eB)
  })
  it('FAC-IDENT-04 sin venta ni sucursal → el default del tenant', () => {
    expect(elegirIdentidadEmisor(rows, {})).toBe(eDef)
  })
  it('FAC-IDENT-05 🛑 regla #7: el emisor de la venta se respeta aunque HOY esté inactivo', () => {
    const eAInactivo = { ...eA, activo: false }
    expect(elegirIdentidadEmisor([eDef, eAInactivo], { ventaEmisorId: A })).toBe(eAInactivo)
  })
  it('FAC-IDENT-06 emisor_id de la venta que ya no existe (borrado) → cae al default, no revienta', () => {
    expect(elegirIdentidadEmisor([eDef], { ventaEmisorId: 'emisor-borrado' })).toBe(eDef)
  })
  it('FAC-IDENT-07 tenant sin ningún emisor (sin CUIT) → null (el caller decide el fallback)', () => {
    expect(elegirIdentidadEmisor([], { ventaEmisorId: A })).toBeNull()
    expect(elegirIdentidadEmisor(null, {})).toBeNull()
  })
})

describe('puntoVentaDelEmisor (el PV impreso es POR CUIT)', () => {
  const pvs = [
    { numero: 4, emisor_id: A },
    { numero: 1, emisor_id: null },   // legacy → del default
    { numero: '2', emisor_id: A },    // numeric de PG llega string
  ]
  it('FAC-IDENT-08 🛑 el PV impreso es el del EMISOR de la venta (antes: limit(1) del tenant entero)', () => {
    expect(puntoVentaDelEmisor(pvs, A, false)).toBe(2)
  })
  it('FAC-IDENT-09 el default toma sus filas legacy sin emisor', () => {
    expect(puntoVentaDelEmisor(pvs, DEF, true)).toBe(1)
  })
  it('FAC-IDENT-10 emisor sin PV configurado → null (el caller decide el fallback legacy 1)', () => {
    expect(puntoVentaDelEmisor(pvs, B, false)).toBeNull()
    expect(puntoVentaDelEmisor([], A, false)).toBeNull()
  })
})
