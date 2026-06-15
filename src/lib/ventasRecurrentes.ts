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
