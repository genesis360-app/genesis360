// ── EN7 — G2: envío propio asociado a un recurso (vehículo) + combustible ────
// Lógica pura (testeable) para estimar el combustible consumido por un envío y
// el gasto resultante. El costo real del envío propio NO genera "gasto courier"
// (no hay tercero que facture); su costo se captura por combustible (recomendación
// contable C2/G2). El combustible es un gasto con su propio IVA.

export interface CombustibleParams {
  /** rendimiento del vehículo en litros por 100 km (recursos.consumo_litros_100km) */
  consumoLitros100km?: number | null
  /** precio del litro (tenants.envio_combustible_precio_litro) */
  precioLitro?: number | null
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Litros consumidos = km × (L/100km) / 100. Devuelve 0 si falta el rendimiento. */
export function litrosConsumidos(km: number, consumoLitros100km?: number | null): number {
  const kmN = Number(km) || 0
  const consumo = Number(consumoLitros100km) || 0
  if (kmN <= 0 || consumo <= 0) return 0
  return round2((kmN * consumo) / 100)
}

/**
 * Costo estimado de combustible para un envío = litros × precio del litro.
 * Si falta el rendimiento o el precio, devuelve 0 (el operador puede tipear el monto a mano).
 */
export function costoCombustible(km: number, p: CombustibleParams): number {
  const litros = litrosConsumidos(km, p.consumoLitros100km)
  const precio = Number(p.precioLitro) || 0
  if (litros <= 0 || precio <= 0) return 0
  return round2(litros * precio)
}

/**
 * Nuevo odómetro del recurso al sumarle los km de un envío.
 * km_acumulado es un acumulador (no un odómetro absoluto del tablero).
 */
export function kmAcumuladoNuevo(kmActual: number | null | undefined, kmEnvio: number): number {
  return round2((Number(kmActual) || 0) + (Number(kmEnvio) || 0))
}

/** Desglosa el IVA crédito fiscal del combustible a partir del monto bruto (IVA incluido). */
export function desgloseIvaCombustible(montoBruto: number, ivaPct: number): { neto: number; iva: number } {
  const bruto = Number(montoBruto) || 0
  if (!ivaPct || ivaPct <= 0 || bruto <= 0) return { neto: round2(bruto), iva: 0 }
  const neto = bruto / (1 + ivaPct / 100)
  return { neto: round2(neto), iva: round2(bruto - neto) }
}
