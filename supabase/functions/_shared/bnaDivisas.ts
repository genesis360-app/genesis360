// D-1 (mig 439) — parser de la tabla pública de DIVISAS de bna.com.ar/Personas. Lógica pura, sin I/O:
// la usa la EF `cotizacion-bna` y la testea vitest (tests/unit/bnaDivisas.test.ts).
//
// La tabla trae en el encabezado la FECHA de la cotización (ej. "25/9/2026") y una fila por moneda
// con compra y venta. Las filas marcadas con "*" (Franco Suizo, Yen, Dólar Canadiense…) se cotizan
// por cada 100 unidades o con otra convención: se IGNORAN a propósito — una tasa mal escalada es
// una tasa inventada (D5). Solo se toman las monedas de MONEDAS_BNA.

export const MONEDAS_BNA: Record<string, string> = {
  'dolar u.s.a': 'USD',
  'euro': 'EUR',
  'libra esterlina': 'GBP',
}

export interface CotizacionBna {
  fecha: string // YYYY-MM-DD
  moneda: string
  compra: number
  venta: number
}

const limpiar = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

/** "25/9/2026" → "2026-09-25". `null` si no es una fecha válida. */
export function fechaBna(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const dt = new Date(iso + 'T12:00:00Z')
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null
  return iso
}

/**
 * Extrae las cotizaciones de la pestaña "divisas". Lanza si no encuentra la tabla, la fecha o el
 * dólar: un cambio de formato de la página tiene que hacer ruido, no guardar nada a medias.
 */
export function parsearDivisasBna(html: string): CotizacionBna[] {
  const ini = html.indexOf('id="divisas"')
  if (ini < 0) throw new Error('BNA: no se encontró la tabla de divisas')
  const fin = html.indexOf('</table>', ini)
  const bloque = html.slice(ini, fin < 0 ? undefined : fin)

  const fechaTxt = bloque.match(/<th[^>]*class="fechaCot"[^>]*>([\s\S]*?)<\/th>/)
  const fecha = fechaTxt ? fechaBna(limpiar(fechaTxt[1])) : null
  if (!fecha) throw new Error('BNA: no se pudo leer la fecha de la cotización de divisas')

  const out: CotizacionBna[] = []
  for (const fila of bloque.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => limpiar(c[1]))
    if (celdas.length < 3) continue
    const nombre = celdas[0].toLowerCase()
    if (nombre.includes('*')) continue
    const moneda = MONEDAS_BNA[nombre]
    if (!moneda) continue
    const compra = Number(celdas[1])
    const venta = Number(celdas[2])
    // Sanidad mínima: positivas y compra ≤ venta. Cualquier otra cosa es un formato que no entendemos.
    if (!Number.isFinite(compra) || !Number.isFinite(venta) || compra <= 0 || venta <= 0 || compra > venta) {
      throw new Error(`BNA: valores inválidos para ${moneda} (${celdas[1]} / ${celdas[2]})`)
    }
    out.push({ fecha, moneda, compra, venta })
  }
  if (!out.some(c => c.moneda === 'USD')) throw new Error('BNA: la tabla de divisas no trae el dólar')
  return out
}
