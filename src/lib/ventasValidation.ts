export type EstadoVenta = 'pendiente' | 'reservada' | 'despachada' | 'cancelada' | 'facturada' | 'devuelta'
export interface MedioPagoItem { tipo: string; monto: string }

/** Calcula el saldo pendiente de cobrar al despachar. */
export function calcularSaldoPendiente(total: number, montoPagado: number): number {
  return Math.max(0, total - montoPagado)
}

/** Valida los medios de pago del saldo antes de despachar.
 *  Retorna mensaje de error o null si está OK. */
export function validarSaldoMediosPago(
  mediosPago: MedioPagoItem[],
  saldo: number
): string | null {
  const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
  if (!tieneMetodoValido) return 'Ingresá un método de pago para el saldo'
  if (mediosPago.some(m => parseFloat(m.monto) > 0 && !m.tipo))
    return 'Seleccioná un método de pago para todos los montos'
  const asignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const faltante = saldo - asignado
  if (faltante > 0.5) return `Falta asignar $${faltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  if (faltante < -0.5) return `El monto excede el saldo por $${Math.abs(faltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
  return null
}

/** Acumula los medios de pago del saldo sobre los de la reserva original. */
export function acumularMediosPago(
  mediosPagoOriginal: { tipo: string; monto: number }[],
  saldoMediosPago: MedioPagoItem[]
): { tipo: string; monto: number }[] {
  const result = [...mediosPagoOriginal.map(m => ({ ...m }))]
  for (const m of saldoMediosPago) {
    const monto = parseFloat(m.monto)
    if (!m.tipo || monto <= 0) continue
    const existing = result.find(p => p.tipo === m.tipo)
    if (existing) existing.monto += monto
    else result.push({ tipo: m.tipo, monto })
  }
  return result
}

/** Valida si se puede despachar: verifica que el saldo quede cubierto por saldoMediosPago.
 *  Retorna mensaje de error o null si está OK para despachar. */
export function validarDespacho(
  total: number,
  montoPagado: number,
  saldoMediosPago?: MedioPagoItem[]
): string | null {
  const saldoPendiente = calcularSaldoPendiente(total, montoPagado)
  const saldoCubierto = saldoMediosPago
    ? saldoMediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
    : 0
  const restante = saldoPendiente - saldoCubierto
  if (restante > 0.5)
    return `Saldo pendiente de $${restante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}. Completá el pago antes de despachar.`
  return null
}

/** Calcula cuánto vuelto debe darse al cliente.
 *  Vuelto solo aplica sobre efectivo: es lo que sobra del efectivo luego de cubrir
 *  lo que no cubrieron otros medios de pago.
 *  Retorna 0 si no hay vuelto. */
export function calcularVuelto(mediosPago: MedioPagoItem[], total: number): number {
  const efectivo = mediosPago.filter(m => m.tipo === 'Efectivo').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const otrosMedios = mediosPago.filter(m => m.tipo && m.tipo !== 'Efectivo').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  // Cuánto debe cubrir el efectivo (lo que no cubrieron otros medios)
  const neededFromEfectivo = Math.max(0, total - otrosMedios)
  const vuelto = efectivo - neededFromEfectivo
  return vuelto > 0.5 ? vuelto : 0
}

/** Calcula el efectivo neto que debe registrarse en caja (lo recibido menos el vuelto). */
export function calcularEfectivoCaja(mediosPago: MedioPagoItem[], total: number): number {
  const efectivo = mediosPago.filter(m => m.tipo === 'Efectivo').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const vuelto = calcularVuelto(mediosPago, total)
  return Math.max(0, efectivo - vuelto)
}

export interface ComboRow { cantidad: number; descuento: number; descuento_tipo: 'pct' | 'monto' }

/** Dada la cantidad total de un producto y un combo, retorna las filas que deben aparecer en el carrito.
 *  Ej: 5 unidades con combo de 3×10%off → [{ cantidad:3, descuento:10, tipo:'pct' }, { cantidad:2, descuento:0, tipo:'pct' }] */
export function calcularComboRows(
  totalQty: number,
  combo: { cantidad: number; descuento_pct: number; descuento_tipo?: string; descuento_monto?: number },
  cotizacionUSD = 1
): ComboRow[] {
  const tipo = combo.descuento_tipo ?? 'pct'
  const desc = tipo === 'pct' ? combo.descuento_pct
    : tipo === 'monto_usd' ? Math.round((combo.descuento_monto ?? 0) * cotizacionUSD)
    : (combo.descuento_monto ?? 0)
  const descTipo: 'pct' | 'monto' = tipo === 'pct' ? 'pct' : 'monto'
  const comboUnits = Math.floor(totalQty / combo.cantidad) * combo.cantidad
  const rem = totalQty % combo.cantidad
  const rows: ComboRow[] = []
  if (comboUnits > 0) rows.push({ cantidad: comboUnits, descuento: desc, descuento_tipo: descTipo })
  if (rem > 0) rows.push({ cantidad: rem, descuento: 0, descuento_tipo: 'pct' })
  return rows
}

/** Parsea el JSON de medio_pago de una venta y restaura como MedioPagoItem[].
 *  Retorna [] si no se puede parsear o no hay datos válidos. */
export function restaurarMediosPago(mediosPagoJson: string | null | undefined): MedioPagoItem[] {
  if (!mediosPagoJson) return []
  try {
    const arr = JSON.parse(mediosPagoJson) as { tipo: string; monto: number }[]
    if (!Array.isArray(arr)) return []
    return arr.filter(p => p.tipo && p.monto > 0).map(p => ({ tipo: p.tipo, monto: String(p.monto) }))
  } catch { return [] }
}

export interface LineaDisponible {
  id: string
  lpn: string | null
  cantidad: number
  cantidad_reservada: number
  ubicacion?: string | null   // nombre de la ubicación (para mostrar en carrito)
}

export interface LpnFuente {
  linea_id: string
  lpn: string | null
  cantidad: number
  ubicacion?: string | null   // nombre de la ubicación
}

/**
 * Dado un conjunto de líneas de inventario disponibles (ya ordenadas por sort activo),
 * calcula qué líneas se consumen para cubrir `cantidad` unidades pedidas.
 * Excluye líneas donde cantidad_disponible <= 0.
 * Retorna array de fuentes con cuántas unidades se toman de cada una.
 */
export function calcularLpnFuentes(lineas: LineaDisponible[], cantidad: number): LpnFuente[] {
  const fuentes: LpnFuente[] = []
  let restante = cantidad
  for (const l of lineas) {
    const disponible = l.cantidad - (l.cantidad_reservada ?? 0)
    if (disponible <= 0) continue
    const usar = Math.min(disponible, restante)
    if (usar <= 0) continue
    fuentes.push({ linea_id: l.id, lpn: l.lpn, cantidad: usar, ubicacion: l.ubicacion ?? null })
    restante -= usar
    if (restante <= 0) break
  }
  return fuentes
}

const UNIDADES_DECIMALES_SET = new Set(['kg','g','gr','mg','l','lt','ml','m','m2','m3','cm','mm','km'])

/** Devuelve true si la unidad de medida admite cantidades decimales. */
export const esDecimal = (u?: string | null): boolean =>
  !!u && UNIDADES_DECIMALES_SET.has(u.toLowerCase())

/** Parsea un string de cantidad ingresado por el usuario.
 *  Acepta punto y coma como separador decimal.
 *  Para UOM decimales retorna un float ≥ 0.001; para enteras retorna un int ≥ 1. */
export function parseCantidad(val: string, u?: string | null): number {
  const normalized = val.replace(',', '.')
  return esDecimal(u)
    ? Math.max(0.001, parseFloat(normalized) || 0.001)
    : Math.max(1, parseInt(normalized) || 1)
}

export function validarMediosPago(
  estado: EstadoVenta,
  mediosPago: MedioPagoItem[],
  total: number
): string | null {
  const totalAsignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const totalFaltante = total - totalAsignado
  const hayMontos = mediosPago.some(m => m.monto !== '')

  if (estado === 'reservada') {
    const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
    if (!tieneMetodoValido) return 'Ingresá un método de pago y monto para reservar'
    if (mediosPago.some(m => parseFloat(m.monto) > 0 && !m.tipo))
      return 'Seleccioná un método de pago para todos los montos'
    // Pago parcial permitido en reserva — no se valida cobertura total
  }
  if (estado === 'despachada') {
    const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
    if (!tieneMetodoValido) return 'Ingresá un método de pago y monto para despachar'
    if (mediosPago.some(m => parseFloat(m.monto) > 0 && !m.tipo))
      return 'Seleccioná un método de pago para todos los montos'
    if (totalFaltante > 0.5) return `Falta asignar $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en medios de pago`
  }
  if (hayMontos && totalFaltante < -0.5) {
    const efectivoPagado = mediosPago.reduce((acc, m) => m.tipo === 'Efectivo' ? acc + (parseFloat(m.monto) || 0) : acc, 0)
    if (efectivoPagado < 0.5)
      return `El monto ingresado excede el total por $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
    // Si hay efectivo, el exceso es vuelto — se permite
  }

  return null
}
