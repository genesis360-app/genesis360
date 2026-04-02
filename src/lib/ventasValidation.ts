export type EstadoVenta = 'pendiente' | 'reservada' | 'despachada' | 'cancelada' | 'facturada'
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
  const asignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const faltante = saldo - asignado
  const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
  if (!tieneMetodoValido) return 'Ingresá un método de pago para el saldo'
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
    // Pago parcial permitido en reserva — no se valida cobertura total
  }
  if (estado === 'despachada') {
    const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
    if (!tieneMetodoValido) return 'Ingresá un método de pago y monto para despachar'
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
