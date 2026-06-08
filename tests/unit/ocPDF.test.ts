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
  it('total suma accesorios', () => {
    expect(totalOC({ ...base, costoEnvio: 500, costoOtros: 100 })).toBe(2600)
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
