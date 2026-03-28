export type EstadoVenta = 'pendiente' | 'reservada' | 'despachada' | 'cancelada' | 'facturada'
export interface MedioPagoItem { tipo: string; monto: string }

export function validarMediosPago(
  estado: EstadoVenta,
  mediosPago: MedioPagoItem[],
  total: number
): string | null {
  const totalAsignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const totalFaltante = total - totalAsignado
  const hayMontos = mediosPago.some(m => m.monto !== '')

  if (estado === 'reservada' || estado === 'despachada') {
    const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
    if (!tieneMetodoValido) return 'Ingresá un método de pago y monto para reservar o despachar'
    if (totalFaltante > 0.5) return `Falta asignar $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en medios de pago`
  }
  if (hayMontos && totalFaltante < -0.5) return `El monto ingresado excede el total por $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  return null
}
