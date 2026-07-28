// Reasignación de stock "sin variante asignada" — lógica pura (Fase 4 del rediseño UoM).
//
// Cuando a un producto standalone CON stock se le crea la primera variante, ese producto pasa a ser
// una MADRE agrupadora: deja de ser vendible (el POS excluye a las madres con hijos desde la Fase 3),
// pero su stock sigue existiendo y contando en inventario. Ese stock es el "sin variante asignada":
// visible y contable, pero no vendible hasta repartirlo entre los hijos.
//
// 🛑 Regla #0: acá no se pierde ni se duplica una unidad. Estas funciones solo ARMAN y VALIDAN el
// payload; el movimiento real lo hace la RPC `fn_reasignar_stock_variante` (mig 309), que revalida
// todo server-side con las líneas bloqueadas.

export interface LineaSinAsignar {
  id: string
  lpn: string
  cantidad: number
  sucursal_nombre?: string | null
  ubicacion_nombre?: string | null
  nro_lote?: string | null
}

/** Borrador de la pantalla: `{ [lineaId]: { [hijoId]: "3" } }` (el valor es el texto del input). */
export type BorradorAsignacion = Record<string, Record<string, string>>

export interface AsignacionRPC {
  linea_id: string
  hijo_id: string
  cantidad: number
  /** Solo en productos SERIALIZADOS: qué números de serie concretos se mueven (mig 313). */
  series?: string[]
}

// ── Productos SERIALIZADOS ──────────────────────────────────────────────────────────────
// En un producto con número de serie cada unidad ES una serie concreta: no alcanza con decir
// "6 y 4", hay que decir CUÁL va a CUÁL variante o el historial de esa unidad física (garantía,
// RMA, recall) queda apuntando al SKU equivocado. Por eso acá el borrador es
// `{ [serieId]: hijoId }` en vez de cantidades.

export interface SerieDisponible {
  id: string
  nro_serie: string
  linea_id: string
}

/** Borrador serializado: a qué variante va cada serie. Sin entrada = no se mueve. */
export type BorradorSeries = Record<string, string>

/** Series de una línea que el usuario asignó a algún hijo. */
export function seriesAsignadasDeLinea(
  series: SerieDisponible[],
  borrador: BorradorSeries,
  lineaId: string,
): SerieDisponible[] {
  return series.filter(s => s.linea_id === lineaId && !!borrador[s.id])
}

/** Total de series asignadas (= unidades que se van a mover). */
export function totalSeriesAsignadas(series: SerieDisponible[], borrador: BorradorSeries): number {
  return series.filter(s => !!borrador[s.id]).length
}

/**
 * Convierte el borrador de series al payload de la RPC, agrupando por (línea, hijo).
 * El orden es estable para que el resultado sea reproducible.
 */
export function construirAsignacionesSeries(
  series: SerieDisponible[],
  borrador: BorradorSeries,
): AsignacionRPC[] {
  const grupos = new Map<string, AsignacionRPC>()
  for (const s of series) {
    const hijoId = borrador[s.id]
    if (!hijoId) continue
    const clave = `${s.linea_id}|${hijoId}`
    const actual = grupos.get(clave)
    if (actual) {
      actual.series!.push(s.id)
      actual.cantidad += 1
    } else {
      grupos.set(clave, { linea_id: s.linea_id, hijo_id: hijoId, cantidad: 1, series: [s.id] })
    }
  }
  return [...grupos.values()]
}

/** Valida el borrador serializado. Devuelve el mensaje de error o null. */
export function validarBorradorSeries(
  series: SerieDisponible[],
  borrador: BorradorSeries,
): string | null {
  // El chequeo de "ya no está disponible" va PRIMERO: si la única serie elegida es una que se
  // vendió/reservó entre medio, `totalSeriesAsignadas` la cuenta como 0 y el mensaje genérico
  // ("elegí al menos una") escondería el motivo real. Es un espejo del guard de la RPC — que
  // igual revalida, porque la UI se cachea.
  const idsDisponibles = new Set(series.map(s => s.id))
  for (const serieId of Object.keys(borrador)) {
    if (borrador[serieId] && !idsDisponibles.has(serieId)) {
      return 'Alguna de las series elegidas ya no está disponible. Refrescá la pantalla.'
    }
  }
  if (totalSeriesAsignadas(series, borrador) === 0) {
    return 'Elegí a qué variante va al menos un número de serie.'
  }
  return null
}

/** Parsea el texto de un input a entero ≥ 0 (vacío / basura → 0). */
export function cantidadDe(texto: string | undefined): number {
  const n = parseInt((texto ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Total ya asignado de una línea en el borrador. */
export function totalAsignado(borrador: BorradorAsignacion, lineaId: string): number {
  const porHijo = borrador[lineaId] ?? {}
  return Object.values(porHijo).reduce((acc, v) => acc + cantidadDe(v), 0)
}

/** Cuántas unidades de esa línea quedan sin repartir (nunca negativo en la UI: se muestra el exceso aparte). */
export function restanteDeLinea(linea: LineaSinAsignar, borrador: BorradorAsignacion): number {
  return linea.cantidad - totalAsignado(borrador, linea.id)
}

/** Suma total de unidades que la operación va a mover. */
export function totalAMover(lineas: LineaSinAsignar[], borrador: BorradorAsignacion): number {
  return lineas.reduce((acc, l) => acc + totalAsignado(borrador, l.id), 0)
}

/**
 * Convierte el borrador al payload de la RPC, salteando los ceros.
 * El orden es estable (líneas en el orden dado, hijos por id) para que el resultado sea reproducible.
 */
export function construirAsignaciones(
  lineas: LineaSinAsignar[],
  borrador: BorradorAsignacion,
): AsignacionRPC[] {
  const out: AsignacionRPC[] = []
  for (const linea of lineas) {
    const porHijo = borrador[linea.id] ?? {}
    for (const hijoId of Object.keys(porHijo).sort()) {
      const cantidad = cantidadDe(porHijo[hijoId])
      if (cantidad > 0) out.push({ linea_id: linea.id, hijo_id: hijoId, cantidad })
    }
  }
  return out
}

/**
 * Valida el borrador ANTES de mandarlo. Devuelve el mensaje de error o null si está OK.
 * Es un espejo (más amable) de los guards de la RPC — la RPC igual revalida: la UI se cachea.
 */
export function validarBorrador(
  lineas: LineaSinAsignar[],
  borrador: BorradorAsignacion,
): string | null {
  for (const linea of lineas) {
    const asignado = totalAsignado(borrador, linea.id)
    if (asignado > linea.cantidad) {
      return `El LPN ${linea.lpn} tiene ${linea.cantidad} unidades y estás repartiendo ${asignado}.`
    }
  }
  if (construirAsignaciones(lineas, borrador).length === 0) {
    return 'Poné al menos una cantidad para repartir.'
  }
  return null
}

/**
 * "Repartir en partes iguales": divide cada línea entre los hijos dados. El resto de la división
 * entera se reparte de a una unidad entre los primeros hijos, así la suma da EXACTO la cantidad de
 * la línea (nunca sobra ni falta una unidad).
 */
export function repartirEnPartesIguales(
  lineas: LineaSinAsignar[],
  hijoIds: string[],
): BorradorAsignacion {
  const out: BorradorAsignacion = {}
  if (hijoIds.length === 0) return out
  for (const linea of lineas) {
    const base = Math.floor(linea.cantidad / hijoIds.length)
    let resto = linea.cantidad % hijoIds.length
    out[linea.id] = {}
    for (const hijoId of hijoIds) {
      const extra = resto > 0 ? 1 : 0
      resto -= extra
      const cant = base + extra
      out[linea.id][hijoId] = cant > 0 ? String(cant) : ''
    }
  }
  return out
}
