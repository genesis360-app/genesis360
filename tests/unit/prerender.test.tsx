// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderizar } from '@/entry-prerender'
import { RUTAS_PRERENDER } from '@/lib/prerender'
import { FAQ, FAQ_CONSTRUCCION } from '@/components/landing/contenido'
import { RUBROS } from '@/components/landing/rubros'

// Landing 2.0, Fase 1 (SEO/GEO): lo que reciben Google y los buscadores con IA es el HTML que arma scripts/prerender.mjs
// con esta misma función. Si una página deja de renderizar en el servidor (p. ej. alguien usa `window` al importar un
// componente), el build se rompe o publica una página vacía — este test lo frena antes.
describe('pre-render de páginas públicas', () => {
  const paginas = renderizar()

  it('renderiza exactamente las rutas que App sabe destapar', () => {
    expect(paginas.map(p => p.meta.ruta)).toEqual(RUTAS_PRERENDER)
  })

  it('la home trae el contenido real, sin JavaScript', () => {
    const home = paginas.find(p => p.meta.ruta === '/')!
    expect(home.html).toContain('Vendé, cobrá y sabé')
    expect(home.html).toContain('Una IA que trabaja para vos')
    expect(home.html).toContain('Gastón Otranto')
    expect(home.html).toContain('Federico Messina')
    for (const { q } of FAQ) expect(home.html).toContain(q)
  })

  it('la página de Construcción habla el idioma del rubro (doc 04: no es la home con otro nombre)', () => {
    const p = paginas.find(x => x.meta.ruta === '/para/construccion')!
    expect(p.html).toContain('El sistema de gestión para ferreterías y corralones')
    for (const { q } of FAQ_CONSTRUCCION) expect(p.html).toContain(q)
    const ld = p.meta.jsonLd as any[]
    expect(ld.map(o => o['@type'])).toEqual(['BreadcrumbList', 'FAQPage'])
  })

  it('cada página por rubro tiene su propio contenido, no el de otro rubro (doc 04 §4)', () => {
    for (const r of RUBROS) {
      const p = paginas.find(x => x.meta.ruta === `/para/${r.slug}`)!
      expect(p.html).toContain(r.h1)
      for (const { q } of r.faq) expect(p.html).toContain(q)
      for (const otro of RUBROS.filter(o => o.slug !== r.slug)) expect(p.html).not.toContain(otro.h1)
    }
  })

  it('la importación masiva no se promete en el plan Básico', () => {
    const resp = FAQ.find(f => /datos que ya tengo/.test(f.q))!.a
    expect(resp).toMatch(/plan Pro/)
  })

  it('cada página tiene título y descripción propios', () => {
    const titulos = new Set(paginas.map(p => p.meta.titulo))
    expect(titulos.size).toBe(paginas.length)
    for (const { meta } of paginas) {
      expect(meta.titulo.length).toBeGreaterThan(10)
      expect(meta.descripcion.length).toBeGreaterThan(20)
      expect(meta.descripcion.length).toBeLessThanOrEqual(170)
    }
  })

  it('los datos estructurados son JSON válido y la FAQ coincide con la de la página', () => {
    const home = paginas.find(p => p.meta.ruta === '/')!
    const ld = JSON.parse(JSON.stringify(home.meta.jsonLd)) as any[]
    expect(ld.map(o => o['@type'])).toEqual(['Organization', 'SoftwareApplication', 'FAQPage'])
    const faq = ld.find(o => o['@type'] === 'FAQPage')
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(FAQ.map(f => f.q))
    const software = ld.find(o => o['@type'] === 'SoftwareApplication')
    for (const offer of software.offers) {
      expect(Number(offer.price)).toBeGreaterThan(0)
      expect(offer.priceCurrency).toBe('ARS')
    }
  })

  it('las páginas públicas no muestran datos personales del titular (decisión de GO 2026-10-06)', () => {
    for (const { html } of paginas) {
      expect(html).not.toMatch(/42237416|Falc[oó]n|Ezequiel/i)
    }
    const terminos = paginas.find(p => p.meta.ruta === '/terminos')!.html
    expect(terminos).toContain('hola@genesis360.pro')
  })

  it('no anuncia el agente de WhatsApp mientras Meta no apruebe la app (decisión de GO)', () => {
    for (const { html } of paginas) expect(html).not.toMatch(/agente de whatsapp/i)
  })
})
