/**
 * Lógica pura de tiers de precio mayorista con OPERADOR (rediseño UoM Fase 2-bis, mig 306).
 *
 * Un tier declara un `operador` ('>','<','=','>=','<=') + una `cantidad` (en unidades base) + un
 * `precio` por unidad. Los tiers se evalúan en el ORDEN que el usuario los cargó (asc); gana el
 * PRIMER tier que matchea contra la cantidad total del SKU. Si ninguno aplica, el llamador usa el
 * precio base por unidad (precioTier devuelve null).
 *
 * Decisión de negocio (Fede, 2026-07-24): la cantidad que se compara es el TOTAL del SKU en el
 * carrito (agregación por SKU, no por línea) — el precio mayorista es por VOLUMEN, no por bulto.
 * La agregación la arma el POS; esta lib solo resuelve la regla contra una cantidad ya sumada.
 *
 * Fede 25/7 (punto 1, "el caso del pallet"): un tier puede ser de tipo `pct` (además del legacy
 * `precio_fijo`) y puede ENLAZARSE a una línea de empaque (`presentacion_factor` = su
 * `factor_base`). Un tier enlazado se compara contra la cantidad de MÚLTIPLOS COMPLETOS de ese
 * empaque (no unidades sueltas) — así el descuento se multiplica solo para vender 1, 2, 3…
 * pallets, sin cargar un tier por cada múltiplo posible. `resolverBloquesTier` separa el carrito
 * en el bloque que llena pallets completos + el resto suelto, y hace competir el bloque de
 * empaque contra el mejor tier normal para esa misma cantidad (mig 329 — "gana el mejor precio,
 * nunca se acumulan").
 */

export type TierOperador = '>' | '<' | '=' | '>=' | '<='
export type TierTipoValor = 'precio_fijo' | 'pct'

export interface TierMayorista {
  /** Valor de comparación en unidades base (nombre legacy `cantidad_minima`), o en MÚLTIPLOS del
   *  empaque enlazado si `presentacion_factor` está seteado (ej. "2" = desde 2 pallets). */
  cantidad_minima: number
  /** $/unidad si `tipo_valor` es 'precio_fijo' (default); % de descuento (0-100) si es 'pct'. */
  precio: number
  operador: TierOperador
  orden: number
  tipo_valor?: TierTipoValor
  /** `factor_base` de la línea de `producto_presentaciones` enlazada. null/undefined = tier normal. */
  presentacion_factor?: number | null
}

export interface BloqueTier<T extends TierMayorista = TierMayorista> {
  /** Unidades base cubiertas por este precio. */
  cantidad: number
  precioUnitario: number
  /** El tier que ganó este bloque, o null si ninguno matcheó (precio de lista). */
  tier: T | null
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100 }

/** Precio por unidad que resulta de aplicar un tier al precio de LISTA (nunca a uno ya rebajado). */
export function precioUnitarioDeTier(t: Pick<TierMayorista, 'tipo_valor' | 'precio'>, precioLista: number): number {
  if (t.tipo_valor === 'pct') {
    const pct = Math.min(100, Math.max(0, t.precio))
    return round2(precioLista * (1 - pct / 100))
  }
  return t.precio
}

/** ¿La cantidad satisface la regla `cantidad <operador> valor`? */
export function matchTier(cantidad: number, valor: number, op: TierOperador): boolean {
  switch (op) {
    case '>':  return cantidad > valor
    case '<':  return cantidad < valor
    case '=':  return cantidad === valor
    case '>=': return cantidad >= valor
    case '<=': return cantidad <= valor
    default:   return false
  }
}

/**
 * Precio por unidad del PRIMER tier (en `orden` asc) que matchea la cantidad total del SKU.
 * Devuelve null si ninguno aplica (el llamador usa el precio base por unidad). Ignora tiers con
 * datos inválidos (precio negativo, cantidad no finita).
 */
export function precioTier(tiers: TierMayorista[], cantidad: number): number | null {
  if (!tiers || tiers.length === 0) return null
  const ordenados = [...tiers].sort((a, b) => a.orden - b.orden)
  for (const t of ordenados) {
    if (!Number.isFinite(t.cantidad_minima) || !(t.precio >= 0)) continue
    if (matchTier(cantidad, t.cantidad_minima, t.operador)) return t.precio
  }
  return null
}

/** El mejor precio mayorista (el más barato) — para el canal que fuerza lista mayorista sin mirar
 *  cantidad. Ignora los tiers ENLAZADOS a empaque (dependen de comprar múltiplos completos, no
 *  tiene sentido forzarlos sin cantidad). null si no hay tiers normales válidos. */
export function mejorPrecioMayorista(tiers: TierMayorista[], precioLista: number): number | null {
  const validos = (tiers ?? []).filter(t => t.precio >= 0 && !(t.presentacion_factor && t.presentacion_factor > 0))
  if (validos.length === 0) return null
  return validos.reduce((min, t) => Math.min(min, precioUnitarioDeTier(t, precioLista)), Infinity)
}

/** El primer tier normal (no enlazado a empaque) que matchea `cantidad`, en `orden` asc — mismo
 *  criterio histórico que `precioTier` (gana el primero, no el mejor: eso no cambia acá). */
function primerTierNormalQueMatchea<T extends TierMayorista>(
  tiers: T[], cantidad: number, precioLista: number,
): { tier: T; precioUnitario: number } | null {
  const ordenados = [...tiers].sort((a, b) => a.orden - b.orden)
  for (const t of ordenados) {
    if (!Number.isFinite(t.cantidad_minima) || !(t.precio >= 0)) continue
    if (matchTier(cantidad, t.cantidad_minima, t.operador)) {
      return { tier: t, precioUnitario: precioUnitarioDeTier(t, precioLista) }
    }
  }
  return null
}

/**
 * Resuelve el precio por BLOQUES de una cantidad total de un SKU (Fede 25/7, punto 1).
 *
 * Si hay un tier enlazado a una presentación (`presentacion_factor`) cuyos MÚLTIPLOS COMPLETOS
 * matchean su regla (ej. "≥ 1 pallet"), separa esa porción como un bloque propio — el resto
 * (unidades sueltas que no llegan a completar otro múltiplo) se evalúa aparte contra los tiers
 * NORMALES. El bloque de empaque compite contra el mejor tier normal que también aplique a esa
 * misma cantidad: "gana el mejor precio, nunca se acumulan" (regla transversal del pedido). Si no
 * hay ningún tier enlazado que matchee, devuelve un único bloque (comportamiento de siempre).
 *
 * Entre varios tiers ENLAZADOS que matcheen a la vez (ej. uno por Caja y otro por Pallet), gana el
 * de mejor precio unitario — es la misma familia de descuento "por empaque", tiene sentido que
 * compitan entre sí igual que compite contra el tier normal.
 */
export function resolverBloquesTier<T extends TierMayorista>(
  tiers: T[], cantidadTotal: number, precioLista: number,
): BloqueTier<T>[] {
  if (!(cantidadTotal > 0)) return []
  const validos = (tiers ?? []).filter(t => Number.isFinite(t.cantidad_minima) && t.precio >= 0)
  const ligados = validos.filter(t => t.presentacion_factor && t.presentacion_factor > 0)
  const normales = validos.filter(t => !(t.presentacion_factor && t.presentacion_factor > 0))

  let mejorLigado: { tier: T; cantidadBloque: number; precioUnitario: number } | null = null
  for (const t of ligados) {
    const factor = t.presentacion_factor as number
    const nMultiplos = Math.floor(cantidadTotal / factor)
    if (nMultiplos < 1 || !matchTier(nMultiplos, t.cantidad_minima, t.operador)) continue
    const precioUnitario = precioUnitarioDeTier(t, precioLista)
    if (!mejorLigado || precioUnitario < mejorLigado.precioUnitario) {
      mejorLigado = { tier: t, cantidadBloque: nMultiplos * factor, precioUnitario }
    }
  }

  if (!mejorLigado) {
    const normal = primerTierNormalQueMatchea(normales, cantidadTotal, precioLista)
    return [{ cantidad: cantidadTotal, precioUnitario: normal?.precioUnitario ?? precioLista, tier: normal?.tier ?? null }]
  }

  const normalParaBloqueEmpaque = primerTierNormalQueMatchea(normales, mejorLigado.cantidadBloque, precioLista)
  const bloqueEmpaqueGanaNormal = normalParaBloqueEmpaque && normalParaBloqueEmpaque.precioUnitario < mejorLigado.precioUnitario

  const bloques: BloqueTier<T>[] = [
    bloqueEmpaqueGanaNormal
      ? { cantidad: mejorLigado.cantidadBloque, precioUnitario: normalParaBloqueEmpaque!.precioUnitario, tier: normalParaBloqueEmpaque!.tier }
      : { cantidad: mejorLigado.cantidadBloque, precioUnitario: mejorLigado.precioUnitario, tier: mejorLigado.tier },
  ]

  const resto = Math.round((cantidadTotal - mejorLigado.cantidadBloque) * 1e6) / 1e6
  if (resto > 0) {
    const normalParaResto = primerTierNormalQueMatchea(normales, resto, precioLista)
    bloques.push({ cantidad: resto, precioUnitario: normalParaResto?.precioUnitario ?? precioLista, tier: normalParaResto?.tier ?? null })
  }
  return bloques
}

/**
 * Precio unitario ÚNICO "equivalente" a los bloques de `resolverBloquesTier` — el promedio
 * ponderado por cantidad. Existe para integrarse sin romper nada en un cálculo que hoy multiplica
 * "un precio × la cantidad de la línea" (`getItemSubtotal`): aplicado a CUALQUIER reparto de la
 * misma cantidad total entre varias líneas del carrito, `Σ cantidad_línea × este precio` da
 * EXACTO lo mismo que sumar los bloques reales — la plata total nunca cambia aunque la UI no
 * muestre las líneas separadas por bloque. Para un tier normal (sin enlace a empaque) da lo mismo
 * que el `precioTier` de siempre, porque `resolverBloquesTier` devuelve un solo bloque.
 */
export function precioBlendedTier<T extends TierMayorista>(
  tiers: T[], cantidadTotal: number, precioLista: number,
): number {
  if (!(cantidadTotal > 0)) return precioLista
  const bloques = resolverBloquesTier(tiers, cantidadTotal, precioLista)
  if (bloques.length === 0) return precioLista
  const totalCobrado = bloques.reduce((s, b) => s + b.cantidad * b.precioUnitario, 0)
  return round2(totalCobrado / cantidadTotal)
}

/** Etiqueta corta del operador para la UI. */
export const OPERADORES_TIER: { valor: TierOperador; label: string }[] = [
  { valor: '>=', label: '≥ (o más)' },
  { valor: '=',  label: '= (exacto)' },
  { valor: '>',  label: '> (más de)' },
  { valor: '<=', label: '≤ (o menos)' },
  { valor: '<',  label: '< (menos de)' },
]
