// H4 — Redondeo de precios de venta (tenants.precio_redondeo)
// El tenant puede configurar que TODO precio de venta calculado se redondee al múltiplo
// más cercano (none / 10 / 50 / 100 / 500 / 1000). Se aplica en el punto canónico del
// precio unitario efectivo del POS (`precioTierEfectivo`), de modo que subtotal, IVA,
// venta_items.precio_unitario y la factura derivan TODOS del mismo valor redondeado.
// No toca precios ya guardados (catálogo): solo el precio efectivo al momento de vender.

export type ModoRedondeo = 'none' | '10' | '50' | '100' | '500' | '1000'

const PASO: Record<string, number> = { '10': 10, '50': 50, '100': 100, '500': 500, '1000': 1000 }

/**
 * Redondea un precio de venta al múltiplo más cercano según el modo configurado por el
 * tenant. Round-half-up sobre el cociente (14.5 → 15). Es PURA y fail-safe:
 *  - modo 'none' / desconocido / vacío → devuelve el precio sin cambios.
 *  - precio no finito o ≤ 0 → sin cambios (nunca inventa plata por un dato inválido).
 * Mantener `none` como default garantiza que ningún tenant cambie de comportamiento
 * sin haberlo configurado explícitamente.
 */
export function redondearPrecio(precio: number, modo: string | null | undefined): number {
  if (!Number.isFinite(precio) || precio <= 0) return precio
  const paso = PASO[modo ?? ''] ?? 0
  if (paso <= 0) return precio
  return Math.round(precio / paso) * paso
}
