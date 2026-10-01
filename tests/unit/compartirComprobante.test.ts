// Compartir comprobantes por WhatsApp (src/lib/compartirComprobante.ts, src/hooks/useEnviarPorWhatsApp.ts, mig 451).
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ tenant: null }) }))
import { generarCodigoCompartido, mensajeComprobante, urlCompartido, urlWhatsApp } from '@/lib/compartirComprobante'
import { etiquetaFiscal } from '@/hooks/useEnviarPorWhatsApp'
import { construirTicketPDF } from '@/lib/ticketPDF'

describe('código y link', () => {
  it('128 bits en hex (32), distintos cada vez — lo que exige la base', () => {
    const a = generarCodigoCompartido(), b = generarCodigoCompartido()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
  it('el link apunta a /c/<código> de la base dada (producción), sin doble barra', () => {
    expect(urlCompartido('abc', 'https://app.genesis360.pro/')).toBe('https://app.genesis360.pro/c/abc')
  })
})

describe('mensaje de WhatsApp', () => {
  it('saluda por el primer nombre, dice qué es, de quién, el total y el link', () => {
    const m = mensajeComprobante({ tipo: 'factura', negocio: 'Almacén Ejemplo', cliente: 'Ana María Pérez', etiqueta: 'Factura B 0001-00000023', total: 15000.5, url: 'https://x/c/1' })
    expect(m).toContain('Hola Ana!')
    expect(m).toContain('tu factura de Almacén Ejemplo (Factura B 0001-00000023)')
    expect(m).toMatch(/por \$15\.000,50/)
    expect(m).toContain('https://x/c/1')
  })
  it('sin cliente ni total no inventa datos', () => {
    const m = mensajeComprobante({ tipo: 'ticket', negocio: 'N', etiqueta: 'Venta #9', total: null, url: 'u' })
    expect(m.startsWith('Hola!')).toBe(true)
    expect(m).not.toContain('por $')
  })
  it('con teléfono abre ese chat; sin teléfono deja elegir el contacto con el mensaje escrito', () => {
    expect(urlWhatsApp('011 15-4444-5555', 'hola')).toBe('https://api.whatsapp.com/send?phone=5491144445555&text=hola')
    expect(urlWhatsApp(null, 'hola que tal')).toBe('https://api.whatsapp.com/send?text=hola%20que%20tal')
  })
})

describe('etiquetaFiscal', () => {
  it('factura y NC con punto de venta y número completos', () => {
    expect(etiquetaFiscal({ tipo_comprobante: 'B', punto_venta: 3, numero_comprobante: 23 })).toBe('Factura B 0003-00000023')
    expect(etiquetaFiscal({ tipo_comprobante: 'NC-A', punto_venta: 1, numero_comprobante: 4 })).toBe('Nota de crédito A 0001-00000004')
  })
})

describe('PDF del ticket', () => {
  it('se arma con ítems, total y leyenda de no fiscal', () => {
    const doc = construirTicketPDF({
      negocio: 'Almacén Ejemplo', etiqueta: 'Venta #12', fecha: '2026-10-01T15:00:00Z',
      items: [{ nombre: 'Yerba 1kg', cantidad: 2, subtotal: 7000 }], total: 7000, medio_pago: 'Efectivo',
    })
    const texto = (doc as any).internal.pages.flat().join(' ')
    expect(texto).toContain('Almacén Ejemplo')
    expect(texto).toContain('Comprobante no válido como factura')
    expect(texto).toContain('TOTAL')
  })
})
