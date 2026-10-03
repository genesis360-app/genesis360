/**
 * Motor ÚNICO de precio — lado del POS (B2 / Fase 3, mig 467).
 *
 * El precio unitario efectivo de cada línea (lista/USD + tier por cantidad + empaque + lista por canal + redondeo del
 * negocio) lo calcula la base con `fn_precios_lineas`. El POS le manda UNA línea por SKU con la cantidad total del
 * carrito (el mayorista es por volumen, mig 306) y usa lo que vuelve. `tiers.ts` queda solo para MOSTRAR un número
 * mientras llega la respuesta: no se cobra ni se guarda una venta hasta que todas las líneas tienen precio del
 * servidor para la cantidad actual (PL-5 = A: sin servidor no hay precio, nunca se inventa).
 *
 * Fuera del motor (se aplican DESPUÉS, como siempre): descuento manual/combo, estado del LPN, descuento general,
 * cupón y promo por medio de pago.
 */

export type MecanismoPrecio = 'lista' | 'tier' | 'empaque' | 'canal_mayorista' | 'categoria'
export type ListaCanal = 'minorista' | 'mayorista' | null

export interface PrecioMotorLinea {
  key: string
  producto_id: string
  cantidad_sku: number
  precio_lista?: number
  precio_base?: number
  precio_unitario?: number
  mecanismo?: MecanismoPrecio
  es_usd?: boolean
  error?: string
  // Fase 4 (mig 468) — categoría del cliente
  /** Precio y mecanismo que habría sin la categoría (lo que compitió y perdió, para el cartel). */
  precio_sin_categoria?: number
  mecanismo_sin_categoria?: MecanismoPrecio
  /** Cliente con categoría ACTIVA: el descuento por estado compite contra la lista en vez de sumarse (A2). */
  estado_compite?: boolean
  categoria_id?: string | null
  categoria_nombre?: string | null
  /** % de la categoría para el producto; undefined = sin cargar. */
  categoria_pct?: number
  precio_categoria?: number
}

export interface ItemCarritoParaMotor {
  producto_id: string
  cantidad: number
  tiene_series?: boolean
  series_seleccionadas?: unknown[]
}

/** Cantidad que cuenta para el precio: con series, las elegidas; si no, la cantidad (unidades base). */
export function cantidadParaPrecio(item: ItemCarritoParaMotor): number {
  const c = item.tiene_series ? (item.series_seleccionadas?.length ?? 0) : Number(item.cantidad)
  return Number.isFinite(c) && c > 0 ? c : 0
}

/** Una línea por SKU con la cantidad TOTAL del carrito, en orden estable (para la clave de la consulta). */
export function itemsParaMotor(cart: ItemCarritoParaMotor[]): { key: string; producto_id: string; cantidad: number }[] {
  const totales = new Map<string, number>()
  for (const i of cart) totales.set(i.producto_id, (totales.get(i.producto_id) ?? 0) + cantidadParaPrecio(i))
  return [...totales.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([producto_id, cantidad]) => ({ key: producto_id, producto_id, cantidad: Math.round(cantidad * 1e6) / 1e6 }))
}

/** Normaliza la respuesta de `fn_precios_lineas` (el `numeric` llega como número o string) a un mapa por producto. */
export function mapaPreciosMotor(respuesta: unknown): Record<string, PrecioMotorLinea> {
  const lineas = (respuesta as { lineas?: unknown[] } | null)?.lineas ?? []
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) ? n : undefined
  }
  const out: Record<string, PrecioMotorLinea> = {}
  for (const raw of lineas as Record<string, unknown>[]) {
    const pid = String(raw.producto_id ?? '')
    if (!pid) continue
    const precio = num(raw.precio_unitario)
    out[pid] = {
      key: String(raw.key ?? pid),
      producto_id: pid,
      cantidad_sku: num(raw.cantidad_sku) ?? 0,
      precio_lista: num(raw.precio_lista),
      precio_base: num(raw.precio_base),
      precio_unitario: precio,
      mecanismo: raw.mecanismo as MecanismoPrecio | undefined,
      es_usd: raw.es_usd === true,
      precio_sin_categoria: num(raw.precio_sin_categoria),
      mecanismo_sin_categoria: raw.mecanismo_sin_categoria as MecanismoPrecio | undefined,
      estado_compite: raw.estado_compite === true,
      categoria_id: (raw.categoria_id as string | null | undefined) ?? null,
      categoria_nombre: (raw.categoria_nombre as string | null | undefined) ?? null,
      categoria_pct: num(raw.categoria_pct),
      precio_categoria: num(raw.precio_categoria),
      // Sin precio y sin error explícito también es un error: nunca se cobra una línea sin precio del servidor.
      error: raw.error ? String(raw.error) : precio === undefined ? 'Sin precio' : undefined,
    }
  }
  return out
}

/**
 * Precio del servidor para un producto SI corresponde a la cantidad actual del carrito; si no (todavía no llegó, o
 * llegó para otra cantidad, o vino con error) devuelve null y el llamador muestra el provisorio.
 */
export function precioServidorVigente(
  mapa: Record<string, PrecioMotorLinea> | undefined, productoId: string, cantidadSkuActual: number,
): PrecioMotorLinea | null {
  const p = mapa?.[productoId]
  if (!p || p.error || p.precio_unitario === undefined) return null
  if (Math.abs(p.cantidad_sku - cantidadSkuActual) > 1e-6) return null
  return p
}

export type EstadoPreciosCarrito =
  | { listo: true }
  | { listo: false; motivo: 'calculando' }
  | { listo: false; motivo: 'error'; mensaje: string; productoId?: string }

/** ¿Se puede cobrar/guardar? Todas las líneas con precio del servidor para su cantidad actual y ninguna con error. */
export function estadoPreciosCarrito(
  cart: ItemCarritoParaMotor[], mapa: Record<string, PrecioMotorLinea> | undefined,
  opts: { cargando: boolean; errorConsulta?: string | null },
): EstadoPreciosCarrito {
  if (cart.length === 0) return { listo: true }
  if (opts.errorConsulta) return { listo: false, motivo: 'error', mensaje: opts.errorConsulta }
  for (const it of itemsParaMotor(cart)) {
    const p = mapa?.[it.producto_id]
    if (p?.error && Math.abs(p.cantidad_sku - it.cantidad) <= 1e-6) {
      return { listo: false, motivo: 'error', mensaje: p.error, productoId: it.producto_id }
    }
    if (!precioServidorVigente(mapa, it.producto_id, it.cantidad)) return { listo: false, motivo: 'calculando' }
  }
  if (opts.cargando) return { listo: false, motivo: 'calculando' }
  return { listo: true }
}

// ── Fase 4: cartel para el cajero y tope de descuento ───────────────────────────────────────────────────────────────

const NOMBRE_MECANISMO: Record<string, string> = {
  tier: 'precio por cantidad', empaque: 'precio por empaque', canal_mayorista: 'precio mayorista del canal', lista: 'precio de lista',
}
const pesos = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const pctTxt = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`

/** Etiqueta corta para la línea (A5): "Categoría Colocadores: −20 % sobre lista". null si la categoría no ganó. */
export function etiquetaCategoria(p: PrecioMotorLinea | null | undefined): string | null {
  if (!p || p.mecanismo !== 'categoria' || !p.categoria_nombre || !(p.categoria_pct && p.categoria_pct > 0)) return null
  return `Categoría ${p.categoria_nombre}: −${pctTxt(p.categoria_pct)} sobre lista`
}

/**
 * Texto del cartel (A2), SOLO para el que maneja el POS: aparece cuando en una línea compitieron dos o más
 * descuentos y uno no se aplicó. Plantilla fija (la redacción con IA es la Fase 5; ésta queda de respaldo).
 * `estadoPerdio`: había un lote con descuento por estado que no se aplicó porque el precio ya era mejor.
 */
export function textoCartelPrecio(
  p: PrecioMotorLinea | null | undefined, producto: string,
  estado?: { nombre: string; pct: number; perdio: boolean } | null,
): string | null {
  if (!p || p.precio_unitario === undefined) return null
  const partes: string[] = []
  const otro = p.mecanismo_sin_categoria && p.mecanismo_sin_categoria !== 'lista' ? p.mecanismo_sin_categoria : null
  if (p.mecanismo === 'categoria' && p.categoria_nombre && p.categoria_pct) {
    if (otro && p.precio_sin_categoria !== undefined) {
      partes.push(`En ${producto} se aplica el ${pctTxt(p.categoria_pct)} de la categoría ${p.categoria_nombre} (${pesos(p.precio_categoria ?? p.precio_unitario)}). No se suma al ${NOMBRE_MECANISMO[otro]} (${pesos(p.precio_sin_categoria)}) porque los descuentos no se acumulan: se toma el mejor para el cliente.`)
    }
  } else if (p.categoria_nombre && p.categoria_pct && p.categoria_pct > 0 && p.precio_categoria !== undefined && otro) {
    partes.push(`En ${producto} se aplica el ${NOMBRE_MECANISMO[otro]} (${pesos(p.precio_unitario)}), que es mejor que el ${pctTxt(p.categoria_pct)} de la categoría ${p.categoria_nombre} (${pesos(p.precio_categoria)}). Los descuentos no se acumulan: se toma el mejor para el cliente.`)
  }
  if (estado?.perdio) {
    partes.push(`Las unidades del lote "${estado.nombre}" (${pctTxt(estado.pct)}) salen al mismo precio: ese descuento no se suma porque el precio ya es mejor para el cliente.`)
  }
  return partes.length ? partes.join(' ') : null
}

/**
 * Tope de descuento acumulado (A4 + B-5 + PL-1): (lista − cobrado) / lista, contando TODO lo que descuenta. Nadie lo
 * saltea. `topePct` null/undefined = no rige. `cobrado` = lo que se cobra por los productos (sin envío).
 */
export function evaluarTopeDescuento(
  lineas: { precioLista: number | undefined; cantidad: number }[], cobrado: number, topePct: number | null | undefined,
): { rige: boolean; excede: boolean; descuentoPct: number } {
  const tope = typeof topePct === 'number' ? topePct : parseFloat(String(topePct ?? ''))
  const lista = lineas.reduce((s, l) => s + (Number.isFinite(l.precioLista) ? (l.precioLista as number) * l.cantidad : 0), 0)
  const descuentoPct = lista > 0 ? Math.round(((lista - cobrado) / lista) * 10000) / 100 : 0
  if (!Number.isFinite(tope)) return { rige: false, excede: false, descuentoPct }
  return { rige: true, excede: lista > 0 && descuentoPct > tope + 0.005, descuentoPct }
}
