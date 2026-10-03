/**
 * categoriaDescuentos.ts — Lista de descuentos por categoría de clientes (mig 466, Fase 4 parte A).
 * Todavía NO se aplica al vender: eso es la parte B2 (motor único de precio). "Sin cargar" = el producto no está en la
 * lista; 0 % = está, sin descuento a propósito (C4).
 */

/**
 * Lee un porcentaje escrito por una persona o una celda de Excel: "15", "12,5", "12.5", "15%", 15.
 * Devuelve el número (0 a 100, hasta 2 decimales), `null` si está vacío, o `'invalido'`.
 */
export function leerPorcentaje(v: unknown): number | null | 'invalido' {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 100 && Math.round(v * 100) === v * 100 ? v : 'invalido'
  const t = String(v).trim().replace('%', '').trim()
  if (!t) return null
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(t)) return 'invalido'
  const n = parseFloat(t.replace(',', '.'))
  return n >= 0 && n <= 100 ? n : 'invalido'
}

/** Texto del % para mostrar: 12.5 → "12,5 %"; el numeric de Postgres llega como string ("12.50"). */
export function porcentajeLegible(v: number | string): string {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`
}
