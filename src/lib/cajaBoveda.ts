// G5 Fase 5 — lógica de la Bóveda multi-moneda (ARS/USD).

export type SentidoConversionUsd = 'usd_a_ars' | 'ars_a_usd'

export interface ConversionUsdResult {
  montoDestino: number
  tasaUsada: number
}

// F2 del relevamiento: la conversión USD↔$ desde la Bóveda usa la tasa de COMPRA cuando el dueño
// vende sus dólares (recibe menos pesos por dólar, como en una casa de cambio real) y la tasa de
// VENTA cuando compra dólares con pesos (la misma que usa el resto del POS, `tenant.cotizacion_usd`).
// J1: sin redondeo — decimales exactos.
export function calcularConversionUsd(
  sentido: SentidoConversionUsd,
  montoOrigen: number,
  cotizacionVenta: number,
  cotizacionCompra: number,
): ConversionUsdResult {
  if (!(montoOrigen > 0)) throw new Error('Ingresá un monto válido')
  if (sentido === 'usd_a_ars') {
    if (!(cotizacionCompra > 0)) throw new Error('Falta la cotización de compra — actualizala antes de convertir')
    return { montoDestino: montoOrigen * cotizacionCompra, tasaUsada: cotizacionCompra }
  }
  if (!(cotizacionVenta > 0)) throw new Error('Falta la cotización de venta — actualizala antes de convertir')
  return { montoDestino: montoOrigen / cotizacionVenta, tasaUsada: cotizacionVenta }
}

/**
 * Tasa a la que el negocio pasa USD → ARS: **COMPRA**.
 *
 * Es la misma convención que `calcularConversionUsd` de arriba (relevamiento F2, G5 Fase 5): cuando
 * el negocio RECIBE dólares y los valúa en pesos usa la de compra, como una casa de cambio real.
 * Aplica a las tres cosas del POS, y tienen que coincidir entre sí o la cuenta no cierra:
 *   · el precio de un producto cargado en USD,
 *   · los tiers mayoristas y combos con montos en USD,
 *   · el valor en pesos de un pago recibido en dólares.
 *
 * 🐛 Hallazgo de Fede (2026-09-08): el POS convertía al dólar **venta**, así que le cobraba de más
 * al cliente respecto de la regla del negocio. Si se arreglara solo el precio y no el pago, un
 * cliente que paga en dólares sobrepagaría y saldría vuelto de la nada — por eso la tasa es UNA.
 *
 * Fallback a la de venta a propósito: la carga MANUAL de cotización (`useCotizacion.guardar`) solo
 * escribe `cotizacion_usd`, sin compra. En ese caso ese único valor ES la tasa que eligió el dueño.
 * Mismo criterio que ya usaba `GastosPage` (`cotizacion_usd_compra || cotizacion_usd`).
 */
export function tasaUsdAArs(cotizacionCompra: number | null | undefined, cotizacionVenta: number | null | undefined): number {
  const compra = Number(cotizacionCompra) || 0
  if (compra > 0) return compra
  return Number(cotizacionVenta) || 0
}

// Busca la sesión permanente de una Caja Fuerte (por moneda); si no existe, la crea con la
// `moneda` stampeada explícitamente (antes de esta fase, los 4 sitios que creaban esta sesión
// nunca la seteaban — quedaban en el default 'ARS' de la columna, lo que hoy rechazaría el
// trigger fn_validar_moneda_coincide_sesion (mig 372) apenas se intente usar la fuerte en USD).
export async function ensureFuerteSesionId(
  supabase: any,
  tenantId: string,
  cajaFuerteId: string,
  moneda: 'ARS' | 'USD',
  usuarioId: string,
): Promise<string> {
  const { data: existente } = await supabase.from('caja_sesiones')
    .select('id').eq('caja_id', cajaFuerteId).eq('es_permanente', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existente?.id) return existente.id as string
  const { data: nueva, error } = await supabase.from('caja_sesiones').insert({
    tenant_id: tenantId, caja_id: cajaFuerteId,
    estado: 'abierta', es_permanente: true, moneda,
    usuario_id: usuarioId, monto_apertura: 0,
  }).select('id').single()
  if (error) throw error
  return nueva.id as string
}
