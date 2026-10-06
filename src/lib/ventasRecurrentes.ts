// Helpers puros para ventas/facturas recurrentes (plantillas que se repiten).

export interface RecurrenteItemSnapshot {
  producto_id: string
  nombre: string
  sku?: string | null
  cantidad: number
  precio_unitario: number
  descuento?: number        // % de descuento de la línea
  alicuota_iva?: number
  subtotal: number          // ya neto del descuento
}

export const FRECUENCIAS: { label: string; dias: number }[] = [
  { label: 'Semanal', dias: 7 },
  { label: 'Quincenal', dias: 15 },
  { label: 'Mensual', dias: 30 },
  { label: 'Bimestral', dias: 60 },
  { label: 'Trimestral', dias: 90 },
  { label: 'Anual', dias: 365 },
]

export function frecuenciaLabel(dias: number): string {
  return FRECUENCIAS.find(f => f.dias === dias)?.label ?? `Cada ${dias} días`
}

/** Devuelve la fecha (YYYY-MM-DD) resultante de sumar `dias` a `desde` (o a hoy). */
export function proximaFecha(dias: number, desde?: string | Date): string {
  const base = desde ? new Date(typeof desde === 'string' ? desde + (desde.length === 10 ? 'T00:00:00' : '') : desde) : new Date()
  base.setDate(base.getDate() + dias)
  return base.toISOString().slice(0, 10)
}

/** true si la plantilla está vencida (proximo_at <= hoy). */
export function estaVencida(proximoAt: string | null | undefined): boolean {
  if (!proximoAt) return false
  return proximoAt.slice(0, 10) <= new Date().toISOString().slice(0, 10)
}

export function totalRecurrente(items: RecurrenteItemSnapshot[]): number {
  return items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
}

/** Precio que devolvió el motor único (`fn_precios_lineas`) para un producto — subconjunto de `PrecioMotorLinea`. */
export interface PrecioMotorParaRecurrente {
  precio_unitario?: number
  mecanismo?: string
  error?: string
  /** Lo que bajó la categoría en la línea (F3), ya calculado con `descuentoCategoriaMonto`. */
  descuentoCategoria?: number | null
}

export interface LineaRecurrenteCotizada {
  producto_id: string
  cantidad: number
  precio_unitario: number
  descuento: number
  subtotal: number
  alicuota_iva: number
  iva_monto: number
  mecanismo_precio: string | null
  descuento_categoria_monto: number | null
}

/**
 * Re-cotiza una plantilla recurrente con el MOTOR ÚNICO (pedido de GO 06/10): el precio unitario es el de HOY para el
 * cliente de la plantilla (lista/USD, tier, canal y su categoría), no el congelado al crear la plantilla. Se conserva
 * la cantidad y el descuento manual % de la línea; la alícuota es la ACTUAL del producto (nunca el `|| 21` sobre 0:
 * Exento es 0 %). Si una línea no tiene precio del servidor, lanza: nunca se inventa un precio (PL-5).
 */
export function cotizarRecurrente(
  items: RecurrenteItemSnapshot[],
  precios: Record<string, PrecioMotorParaRecurrente | undefined>,
  alicuotas: Record<string, number | string | null | undefined>,
): { lineas: LineaRecurrenteCotizada[]; total: number } {
  const lineas: LineaRecurrenteCotizada[] = []
  for (const i of items) {
    if (!i.producto_id) continue
    const srv = precios[i.producto_id]
    const precio = srv?.precio_unitario
    if (!srv || srv.error || precio === undefined || !Number.isFinite(precio)) {
      throw new Error(`No se pudo calcular el precio de "${i.nombre}": ${srv?.error ?? 'sin precio'}`)
    }
    const aRaw = alicuotas[i.producto_id]
    const a = typeof aRaw === 'number' ? aRaw : parseFloat(String(aRaw ?? ''))
    if (!Number.isFinite(a)) throw new Error(`No se encontró la alícuota de IVA de "${i.nombre}"`)
    const cantidad = Number(i.cantidad)
    const descuento = Number.isFinite(Number(i.descuento)) ? Number(i.descuento) : 0
    const subtotal = Math.round(precio * cantidad * (1 - descuento / 100) * 100) / 100
    const iva_monto = Math.round((subtotal - subtotal / (1 + a / 100)) * 100) / 100
    lineas.push({
      producto_id: i.producto_id, cantidad, precio_unitario: precio, descuento, subtotal, alicuota_iva: a, iva_monto,
      mecanismo_precio: srv.mecanismo ?? null, descuento_categoria_monto: srv.descuentoCategoria ?? null,
    })
  }
  const total = Math.round(lineas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
  return { lineas, total }
}
