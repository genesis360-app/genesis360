import { describe, it, expect } from 'vitest'
import {
  detectarTipoComprobante,
  calcularIvaDesglose,
  calcularImportes,
  esComprobanteSinIVA,
  determinarReceptor,
  buildQrAfipUrl,
  UMBRAL_FACTURA_B_DEFAULT,
} from '@/lib/facturacionLogic'

// Plan: tests/specs/facturacion.plan.md

// ── 1. Auto-detección del tipo de comprobante ───────────────────────────────────
describe('detectarTipoComprobante', () => {
  it('FAC-TIPO-01 emisor Monotributista → C (sin importar receptor)', () => {
    expect(detectarTipoComprobante('Monotributista', 'RI')).toBe('C')
    expect(detectarTipoComprobante('Monotributista', 'CF')).toBe('C')
  })
  it('FAC-TIPO-02 emisor RI + receptor RI → A', () => {
    expect(detectarTipoComprobante('RI', 'RI')).toBe('A')
  })
  it('FAC-TIPO-03 emisor RI + receptor CF → B', () => {
    expect(detectarTipoComprobante('RI', 'CF')).toBe('B')
  })
  it('FAC-TIPO-04 emisor RI + receptor Monotributista → B', () => {
    expect(detectarTipoComprobante('RI', 'Monotributista')).toBe('B')
  })
  it('FAC-TIPO-05 emisor RI + receptor sin dato → B', () => {
    expect(detectarTipoComprobante('RI', undefined)).toBe('B')
  })
  it('FAC-TIPO-06 emisor sin dato → B (default seguro)', () => {
    expect(detectarTipoComprobante(undefined, 'CF')).toBe('B')
  })
})

// ── 2. Desglose de IVA por alícuota ─────────────────────────────────────────────
describe('calcularIvaDesglose', () => {
  it('FAC-IVA-01 1 ítem 21% (subtotal 1210) → neto 1000, IVA 210', () => {
    const d = calcularIvaDesglose([{ cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21' }])
    expect(d.totalNeto).toBe(1000)
    expect(d.totalIVA).toBe(210)
    expect(d.impTotal).toBe(1210)
    expect(d.iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }])
  })
  it('FAC-IVA-02 multi-alícuota (21% + 10.5%) → neto 2000, IVA 315', () => {
    const d = calcularIvaDesglose([
      { cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21' },
      { cantidad: 1, precio_unitario: 1105, subtotal: 1105, alicuota_iva: '10.5' },
    ])
    expect(d.totalNeto).toBe(2000)
    expect(d.totalIVA).toBe(315)
    expect(d.impTotal).toBe(2315)
    expect(d.iva.find(x => x.Id === 5)).toEqual({ Id: 5, BaseImp: 1000, Importe: 210 })
    expect(d.iva.find(x => x.Id === 4)).toEqual({ Id: 4, BaseImp: 1000, Importe: 105 })
  })
  it('FAC-IVA-03 exento → IVA 0, neto = subtotal, Id 3', () => {
    const d = calcularIvaDesglose([{ cantidad: 1, precio_unitario: 1000, subtotal: 1000, alicuota_iva: 'exento' }])
    expect(d.totalIVA).toBe(0)
    expect(d.totalNeto).toBe(1000)
    expect(d.iva).toEqual([{ Id: 3, BaseImp: 1000, Importe: 0 }])
  })
  it('FAC-IVA-04 0% → IVA 0, Id 3', () => {
    const d = calcularIvaDesglose([{ cantidad: 1, precio_unitario: 500, subtotal: 500, alicuota_iva: '0' }])
    expect(d.totalIVA).toBe(0)
    expect(d.iva[0].Id).toBe(3)
  })
  it('FAC-IVA-05 sin subtotal → usa precio_unitario × cantidad', () => {
    const d = calcularIvaDesglose([{ cantidad: 2, precio_unitario: 100, alicuota_iva: '21' }])
    // subtotal 200 → neto 165.29, iva 34.71
    expect(d.totalNeto).toBe(165.29)
    expect(d.totalIVA).toBe(34.71)
    expect(d.impTotal).toBe(200)
  })
  it('FAC-IVA-06 alícuota numérica 21 equivale al string "21"', () => {
    const num = calcularIvaDesglose([{ cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: 21 }])
    const str = calcularIvaDesglose([{ cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21' }])
    expect(num).toEqual(str)
  })
  it('FAC-IVA-07 impTotal SIEMPRE = neto + IVA (invariante anti error AFIP 10048)', () => {
    const d = calcularIvaDesglose([
      { cantidad: 3, precio_unitario: 333.33, subtotal: 999.99, alicuota_iva: '21' },
      { cantidad: 1, precio_unitario: 77.77, subtotal: 77.77, alicuota_iva: '10.5' },
    ])
    expect(d.impTotal).toBe(parseFloat((d.totalNeto + d.totalIVA).toFixed(2)))
  })
})

// ── 2.bis Importes según tipo (Factura C no discrimina IVA) ──────────────────────
describe('calcularImportes / esComprobanteSinIVA', () => {
  const items = [
    { cantidad: 1, precio_unitario: 1210, subtotal: 1210, alicuota_iva: '21' },
    { cantidad: 2, precio_unitario: 100, subtotal: 200, alicuota_iva: '21' },
  ]
  it('FAC-C-01 esComprobanteSinIVA true solo para C y NC-C', () => {
    expect(esComprobanteSinIVA('C')).toBe(true)
    expect(esComprobanteSinIVA('NC-C')).toBe(true)
    expect(esComprobanteSinIVA('B')).toBe(false)
    expect(esComprobanteSinIVA('A')).toBe(false)
    expect(esComprobanteSinIVA('NC-B')).toBe(false)
  })
  it('FAC-C-02 Factura C: ImpNeto = ImpTotal, ImpIVA 0, sin array Iva', () => {
    const r = calcularImportes(items, 'C')
    expect(r.impTotal).toBe(1410)
    expect(r.impNeto).toBe(1410)
    expect(r.impIVA).toBe(0)
    expect(r.iva).toEqual([])
  })
  it('FAC-C-03 Factura B: discrimina IVA (neto+iva)', () => {
    const r = calcularImportes(items, 'B')
    expect(r.impIVA).toBeGreaterThan(0)
    expect(r.impTotal).toBe(parseFloat((r.impNeto + r.impIVA).toFixed(2)))
    expect(r.iva.length).toBe(1) // todo 21%
  })
})

// ── 3. Documento del receptor ───────────────────────────────────────────────────
describe('determinarReceptor', () => {
  it('FAC-DOC-01 Factura B bajo umbral, CF → 99/0/condId 5', () => {
    const r = determinarReceptor('B', 5000, { condicion_iva_receptor: 'CF' })
    expect(r).toEqual({ docTipo: 99, docNro: 0, condicionIvaReceptorId: 5 })
  })
  it('FAC-DOC-02 Factura B ≥ umbral con DNI → 96 / DNI sin puntos', () => {
    const r = determinarReceptor('B', 100000, { dni: '30.123.456', condicion_iva_receptor: 'CF' })
    expect(r.docTipo).toBe(96)
    expect(r.docNro).toBe(30123456)
  })
  it('FAC-DOC-03 Factura B ≥ umbral sin DNI → 99/0', () => {
    const r = determinarReceptor('B', 100000, { condicion_iva_receptor: 'CF' })
    expect(r.docTipo).toBe(99)
    expect(r.docNro).toBe(0)
  })
  it('FAC-DOC-04 Factura A con CUIT → 80 / CUIT sin guiones', () => {
    const r = determinarReceptor('A', 5000, { cuit_receptor: '30-71234567-8', condicion_iva_receptor: 'RI' })
    expect(r.docTipo).toBe(80)
    expect(r.docNro).toBe(30712345678)
    expect(r.condicionIvaReceptorId).toBe(1)
  })
  it('FAC-DOC-05 Factura A sin CUIT → lanza error', () => {
    expect(() => determinarReceptor('A', 5000, { condicion_iva_receptor: 'RI' })).toThrow(/CUIT/)
  })
  it('FAC-DOC-06 condicionIvaReceptorId mapea RI/CF/Mono/Exento', () => {
    expect(determinarReceptor('B', 0, { condicion_iva_receptor: 'RI' }).condicionIvaReceptorId).toBe(1)
    expect(determinarReceptor('B', 0, { condicion_iva_receptor: 'CF' }).condicionIvaReceptorId).toBe(5)
    expect(determinarReceptor('B', 0, { condicion_iva_receptor: 'Monotributista' }).condicionIvaReceptorId).toBe(4)
    expect(determinarReceptor('B', 0, { condicion_iva_receptor: 'Exento' }).condicionIvaReceptorId).toBe(2)
    expect(determinarReceptor('B', 0, null).condicionIvaReceptorId).toBe(5) // default CF
  })
  it('FAC-DOC-07 umbral configurable por tenant respetado', () => {
    // umbral bajo (1000): venta de 5000 con DNI ya exige DNI
    const r = determinarReceptor('B', 5000, { dni: '20111222', condicion_iva_receptor: 'CF' }, 1000)
    expect(r.docTipo).toBe(96)
    // con el umbral default (68305.16) la misma venta sería CF
    const r2 = determinarReceptor('B', 5000, { dni: '20111222', condicion_iva_receptor: 'CF' })
    expect(r2.docTipo).toBe(99)
    expect(UMBRAL_FACTURA_B_DEFAULT).toBeGreaterThan(5000)
  })
})

// ── 4. QR fiscal RG 4291 ────────────────────────────────────────────────────────
describe('buildQrAfipUrl', () => {
  const base = {
    fecha: '2026-06-13T10:30:00.000Z',
    emisorCuit: '20-40937847-2',
    puntoVenta: 1,
    tipoComprobante: 'B',
    numeroComprobante: 24,
    importe: 1210,
    cae: '86170057489609',
  }
  const decode = (url: string) => JSON.parse(atob(url.split('?p=')[1]))

  it('FAC-QR-01 URL con prefijo AFIP + payload base64 decodable', () => {
    const url = buildQrAfipUrl(base)
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true)
    expect(() => decode(url)).not.toThrow()
  })
  it('FAC-QR-02 campos del payload', () => {
    const p = decode(buildQrAfipUrl(base))
    expect(p.ver).toBe(1)
    expect(p.fecha).toBe('2026-06-13')
    expect(p.cuit).toBe(20409378472)
    expect(p.ptoVta).toBe(1)
    expect(p.tipoCmp).toBe(6) // B
    expect(p.nroCmp).toBe(24)
    expect(p.importe).toBe(1210)
    expect(p.moneda).toBe('PES')
    expect(p.tipoCodAut).toBe('E')
    expect(p.codAut).toBe(86170057489609)
  })
  it('FAC-QR-03 receptor CUIT (11 díg) → tipoDocRec 80', () => {
    const p = decode(buildQrAfipUrl({ ...base, receptorCuitDni: '30-71234567-8' }))
    expect(p.tipoDocRec).toBe(80)
    expect(p.nroDocRec).toBe(30712345678)
  })
  it('FAC-QR-04 receptor DNI (8 díg) → tipoDocRec 96', () => {
    const p = decode(buildQrAfipUrl({ ...base, receptorCuitDni: '30.123.456' }))
    expect(p.tipoDocRec).toBe(96)
    expect(p.nroDocRec).toBe(30123456)
  })
  it('FAC-QR-05 receptor vacío → tipoDocRec 99, nroDocRec 0', () => {
    const p = decode(buildQrAfipUrl(base))
    expect(p.tipoDocRec).toBe(99)
    expect(p.nroDocRec).toBe(0)
  })
})
