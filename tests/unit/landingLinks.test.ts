import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// UAT/validación de LINKS del Landing (pedido GO). Test estático: lee el source del
// LandingPage + las rutas de App.tsx y verifica que TODOS los links sean válidos —
// anchors con sección destino, rutas internas existentes, y que ningún mailto use
// <Link to="mailto:..."> (React Router lo trataría como ruta interna → no abre el
// correo y rebota al home; bug real encontrado en el plan Enterprise, 2026-06-30).

const landing = readFileSync(resolve('src/pages/LandingPage.tsx'), 'utf8')
const app = readFileSync(resolve('src/App.tsx'), 'utf8')

const matchAll = (src: string, re: RegExp) => [...src.matchAll(re)].map(m => m[1])

describe('Landing — validación de links', () => {
  it('cada anchor href="#x" tiene una sección con id="x"', () => {
    const anchors = matchAll(landing, /href="#([a-zA-Z0-9_-]+)"/g)
    const ids = new Set(matchAll(landing, /id="([a-zA-Z0-9_-]+)"/g))
    expect(anchors.length).toBeGreaterThan(0)
    const huerfanos = [...new Set(anchors)].filter(a => !ids.has(a))
    expect(huerfanos, `anchors sin sección destino: ${huerfanos.join(', ')}`).toEqual([])
  })

  it('cada <Link to="/ruta"> existe en App.tsx', () => {
    const links = matchAll(landing, /<Link\s+to="(\/[a-zA-Z0-9/_-]*)"/g)
    const rutas = new Set(matchAll(app, /path="(\/[a-zA-Z0-9/_-]*)"/g))
    rutas.add('/') // landing
    expect(links.length).toBeGreaterThan(0)
    const rotos = [...new Set(links)].filter(r => !rutas.has(r))
    expect(rotos, `<Link> a rutas inexistentes: ${rotos.join(', ')}`).toEqual([])
  })

  it('ningún mailto usa <Link to="mailto:..."> (debe ser <a href>)', () => {
    // React Router <Link to="mailto:..."> navega como ruta interna → no abre el correo.
    expect(/<Link\s+to=\{?[`'"]?mailto:/.test(landing)).toBe(false)
    expect(/<Link\s+to="mailto:/.test(landing)).toBe(false)
  })

  it('los mailto del landing apuntan a una dirección @genesis360.pro', () => {
    const mailtos = matchAll(landing, /href=\{?`?mailto:([^`"'}\s]+)/g)
    // BRAND.email se interpola (`mailto:${BRAND.email}`) → al menos un mailto explícito o interpolado debe existir
    const interpolado = /mailto:\$\{BRAND\.email\}/.test(landing) || /mailto:\$\{?BRAND\.email/.test(landing)
    expect(mailtos.length > 0 || interpolado, 'el landing debe tener al menos un contacto por mailto').toBe(true)
    const malos = mailtos.filter(m => !m.startsWith('${') && !m.includes('@genesis360.pro'))
    expect(malos, `mailto a dominio inesperado: ${malos.join(', ')}`).toEqual([])
  })
})
