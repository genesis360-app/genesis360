import { describe, it, expect } from 'vitest'
import { subtotalItems, totalOC, textoOC, waLinkOC, type OCPDFData } from '@/lib/ocPDF'

// Compras CO7/A6 — helpers de texto/total de la OC (el PDF en sí no se testea en jsdom)

const base: OCPDFData = {
  negocio: 'Mi Negocio', moneda: 'ARS', numeroLabel: 'S1-OC-0001', fecha: '2026-06-08',
  proveedor: { nombre: 'Proveedor SA', telefono: '+54 9 11 2345-6789' },
  items: [
    { nombre: 'Tornillos', cantidad: 100, precio_unitario: 10 },
    { nombre: 'Tuercas', cantidad: 50, precio_unitario: 20 },
  ],
}

describe('subtotalItems / totalOC', () => {
  it('subtotal suma cantidad × precio', () => {
    expect(subtotalItems(base.items)).toBe(2000)
  })
  it('total suma el envío que cobra el proveedor', () => {
    expect(totalOC({ ...base, costoEnvio: 500 })).toBe(2500)
  })
  it('🛑 aduana/comisión/otros NO entran al total que ve el proveedor (no se le pagan a él)', () => {
    const conInternos = { ...base, costoEnvio: 500, costoAduana: 300, costoComision: 50, costoOtros: 100 } as OCPDFData
    expect(totalOC(conInternos)).toBe(2500)
    expect(textoOC(conInternos)).not.toMatch(/Aduana|Comisi|Otros/)
  })
  it('el envío llega como string (numeric de Postgres) → igual suma', () => {
    expect(totalOC({ ...base, costoEnvio: '500.00' as unknown as number })).toBe(2500)
  })
})

describe('textoOC', () => {
  it('incluye número, proveedor, ítems y total', () => {
    const t = textoOC(base)
    expect(t).toContain('S1-OC-0001')
    expect(t).toContain('Proveedor SA')
    expect(t).toContain('Tornillos')
    expect(t).toContain('TOTAL')
  })
  it('incluye anticipo cuando corresponde', () => {
    const t = textoOC({ ...base, pagaConAnticipo: true, anticipoPct: 30 })
    expect(t).toMatch(/Anticipo \(30%\)/)
  })
})

describe('waLinkOC', () => {
  it('normaliza el teléfono a dígitos y codifica el texto', () => {
    const link = waLinkOC('+54 9 11 2345-6789', 'hola mundo')
    expect(link).toContain('https://wa.me/5491123456789')
    expect(link).toContain('text=hola%20mundo')
  })
  it('sin teléfono usa wa.me genérico', () => {
    expect(waLinkOC(null, 'x')).toContain('https://wa.me/?text=')
  })
})
