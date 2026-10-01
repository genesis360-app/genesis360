// cotizacionFiscal — convertir a pesos un gasto en moneda extranjera, para el Libro IVA.
//
// ⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR CON UN CONTADOR MATRICULADO. Viene de una consulta de
// GO a una IA que se presentó como contador (2026-09-13) y se adopta como criterio de trabajo. Todo
// lo de acá cambia si un contador real dice otra cosa.
//
// ── El criterio ─────────────────────────────────────────────────────────────────────────────
// 1. Un gasto en moneda extranjera SÍ genera crédito fiscal computable (art. 12 Ley 23.349), si
//    está vinculado a la actividad gravada y tiene comprobante válido con IVA discriminado.
// 2. La DDJJ va obligatoriamente en PESOS (art. 96 Ley 11.683).
// 3. Tipo de cambio: **BNA VENDEDOR del día hábil ANTERIOR** a la fecha del comprobante. En
//    importación de servicios (reverse charge), el del día hábil anterior al PAGO.
//
// ── 🛑 La trampa que hay que tener presente ─────────────────────────────────────────────────
// Desde D-1 fase 2 (2026-09-26) el resto del sistema también usa el vendedor divisa BNA del día
// hábil anterior (`src/lib/cotizacionBna.ts`) — pero el de **HOY**. Lo fiscal pide el del día hábil
// anterior a la fecha **del comprobante**, que puede ser otro día. Mismo criterio, otra fecha: usar
// la tasa operativa de hoy para un comprobante de la semana pasada falsea la posición de IVA.
//
// Por eso la tasa se guarda POR GASTO (`gastos.cotizacion_fiscal`, mig 414) y no se deriva de
// `tenants.cotizacion_usd*`, que es un valor de HOY y se mueve.

/**
 * El día hábil anterior a una fecha: retrocede un día y, si cae sábado o domingo, sigue
 * retrocediendo hasta el viernes.
 *
 * ⚠️ **No contempla feriados**: no hay calendario de feriados cargado en el sistema. Un comprobante
 * del día siguiente a un feriado va a proponer una fecha en la que el BNA no publicó cotización, y
 * quien carga el gasto tiene que corregirla a mano. Por eso el campo del formulario es editable y
 * la fecha se guarda junto con la tasa: para que después se pueda auditar cuál se usó.
 */
export function diaHabilAnterior(fecha: Date | string): Date {
  const base = typeof fecha === 'string' ? new Date(`${fecha.slice(0, 10)}T12:00:00`) : new Date(fecha)
  if (isNaN(base.getTime())) return new Date(NaN)
  const d = new Date(base)
  d.setDate(d.getDate() - 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d
}

/** `YYYY-MM-DD` en hora local (no `toISOString`, que corre la fecha por la zona horaria). */
export function aFechaISO(d: Date): string {
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface GastoConvertible {
  monto: number | string | null | undefined
  iva_monto?: number | string | null | undefined
  moneda?: string | null
  cotizacion_fiscal?: number | string | null
}

export interface ConversionFiscal {
  /** Monto en la moneda del libro (pesos). */
  monto: number
  /** IVA en la moneda del libro. */
  iva: number
  /** `true` si hubo que convertir (el gasto estaba en otra moneda). */
  convertido: boolean
  /** Por qué NO se pudo convertir, si aplica. */
  problema: 'sin_cotizacion' | null
}

const num = (v: unknown): number => {
  // El `numeric` de Postgres llega como string ("21.00"): parsear siempre antes de operar.
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Lleva un gasto a la moneda del libro.
 *
 * Si ya está en esa moneda, pasa tal cual. Si está en otra y tiene cotización fiscal, se convierte
 * (monto **e IVA**: el `iva_monto` está expresado en la moneda del gasto, así que va por la misma
 * tasa). Si está en otra y NO tiene cotización, **no se inventa una**: se devuelve el problema para
 * que la pantalla lo muestre y el comprobante quede fuera del libro hasta que alguien la cargue.
 */
export function convertirGastoAMonedaLibro(
  g: GastoConvertible,
  monedaLibro: string | null | undefined,
): ConversionFiscal {
  const libro = (monedaLibro ?? 'ARS').toUpperCase()
  const suya = (g.moneda ?? libro).toUpperCase()
  const monto = num(g.monto)
  const iva = num(g.iva_monto)

  if (suya === libro) return { monto, iva, convertido: false, problema: null }

  const tasa = num(g.cotizacion_fiscal)
  if (tasa <= 0) return { monto: 0, iva: 0, convertido: false, problema: 'sin_cotizacion' }

  return { monto: monto * tasa, iva: iva * tasa, convertido: true, problema: null }
}

/** Los gastos que NO pueden entrar al libro por falta de cotización, agrupados por moneda. */
export function gastosSinCotizacion<T extends GastoConvertible>(
  gastos: T[] | null | undefined,
  monedaLibro: string | null | undefined,
): { moneda: string; cantidad: number; iva: number }[] {
  const acc = new Map<string, { moneda: string; cantidad: number; iva: number }>()
  for (const g of gastos ?? []) {
    if (convertirGastoAMonedaLibro(g, monedaLibro).problema !== 'sin_cotizacion') continue
    const m = (g.moneda ?? '').toUpperCase() || '—'
    const fila = acc.get(m) ?? { moneda: m, cantidad: 0, iva: 0 }
    fila.cantidad++
    fila.iva += num(g.iva_monto)
    acc.set(m, fila)
  }
  return [...acc.values()].sort((a, b) => a.moneda.localeCompare(b.moneda))
}

/**
 * El IVA crédito computable de un período, ya llevado a la moneda del libro.
 *
 * 🛑 REGLA #0 — existe para que el KPI del Panel, la posición de los últimos 12 meses y la tabla
 * del Libro IVA Compras salgan del MISMO cálculo. Antes cada uno hacía el suyo: la tabla filtraba
 * los gastos en otra moneda y avisaba, pero el KPI y el historial sumaban su `iva_monto` crudo
 * —un IVA de US$210 entraba como $210 de crédito fiscal—. Dos pantallas de la misma sesión decían
 * cosas distintas sobre la misma plata, y la que se usa para liquidar era la equivocada.
 *
 * Los que no tienen cotización NO se suman ni se estiman: salen aparte para que la pantalla los
 * muestre. Un crédito fiscal que no entra tiene que verse, no desaparecer.
 */
export function creditoFiscalCompras<T extends GastoConvertible>(
  gastos: T[] | null | undefined,
  monedaLibro: string | null | undefined,
): { credito: number; sinCotizacion: { moneda: string; cantidad: number; iva: number }[] } {
  let credito = 0
  for (const g of gastos ?? []) {
    const c = convertirGastoAMonedaLibro(g, monedaLibro)
    if (c.problema === null) credito += c.iva
  }
  return { credito, sinCotizacion: gastosSinCotizacion(gastos, monedaLibro) }
}
