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

export type MecanismoPrecio = 'lista' | 'tier' | 'empaque' | 'canal_mayorista'
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
