import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsearDivisasBna, fechaBna } from '../../supabase/functions/_shared/bnaDivisas'

// D-1 (mig 439): el POS convierte USD→ARS al VENDEDOR DIVISA del BNA del día hábil anterior.
// Fixture = HTML REAL de bna.com.ar/Personas del 2026-09-25 (pestañas billetes + divisas), no armado a
// mano: la página trae PRIMERO la tabla de billetes, con otra cotización del dólar.
const html = readFileSync(resolve(__dirname, '../fixtures/bna_personas_2026-09-25.html'), 'utf8')

describe('parsearDivisasBna — HTML real del 25/09/2026', () => {
  const r = parsearDivisasBna(html)
  const usd = r.find(c => c.moneda === 'USD')!

  it('🛑 toma la tabla de DIVISAS, no la de billetes', () => {
    // Billetes ese día: 1495 / 1545. Divisas: 1516,50 / 1525,50 (la de la RG 5616).
    expect(usd.compra).toBe(1516.5)
    expect(usd.venta).toBe(1525.5)
  })

  it('la fecha es la que publica el BNA, en ISO', () => {
    expect(usd.fecha).toBe('2026-09-25')
  })

  it('trae euro y libra; ignora las filas con * (otra escala: sería una tasa inventada)', () => {
    expect(r.map(c => c.moneda).sort()).toEqual(['EUR', 'GBP', 'USD'])
    expect(r.find(c => c.moneda === 'EUR')!.venta).toBe(1739.8328)
  })
})

describe('parsearDivisasBna — un cambio de formato hace ruido, no guarda a medias', () => {
  it('sin la tabla de divisas → error', () => {
    expect(() => parsearDivisasBna('<html><div id="billetes"></div></html>')).toThrow(/tabla de divisas/)
  })

  it('sin fecha legible → error', () => {
    const roto = html.replace(/(id="divisas"[\s\S]*?class="fechaCot">)[^<]*/, '$1hoy')
    expect(() => parsearDivisasBna(roto)).toThrow(/fecha/)
  })

  it('sin el dólar → error', () => {
    const sinUsd = html.replace(/(id="divisas"[\s\S]*?)Dolar U\.S\.A/, '$1Otra Moneda')
    expect(() => parsearDivisasBna(sinUsd)).toThrow(/dólar/)
  })

  it('compra mayor que venta → error (formato que no entendemos)', () => {
    const invertido = html.replace(/(id="divisas"[\s\S]*?Dolar U\.S\.A<\/td>\s*<td>)1516\.5000/, '$19999.0000')
    expect(() => parsearDivisasBna(invertido)).toThrow(/inválidos/)
  })
})

describe('fechaBna', () => {
  it('d/m/aaaa sin ceros → ISO', () => {
    expect(fechaBna('5/1/2026')).toBe('2026-01-05')
  })
  it('fecha imposible → null', () => {
    expect(fechaBna('31/2/2026')).toBeNull()
    expect(fechaBna('2026-09-25')).toBeNull()
  })
})
