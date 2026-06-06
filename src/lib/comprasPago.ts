// Compras · CO5 — lógica pura de pago de OC. Sin I/O.
// D1: modo de pago por proveedor + anticipo.  D2: schedule de pago por OC.

export type ModoPagoProveedor = 'contado' | 'anticipo' | 'contra_entrega' | 'cuenta_corriente'

export const MODOS_PAGO_PROVEEDOR: { value: ModoPagoProveedor; label: string }[] = [
  { value: 'contado', label: 'Contado' },
  { value: 'anticipo', label: 'Anticipo (% por adelantado)' },
  { value: 'contra_entrega', label: 'Contra entrega' },
  { value: 'cuenta_corriente', label: 'Cuenta corriente' },
]

export function labelModoPago(m: ModoPagoProveedor | string | null | undefined): string {
  return MODOS_PAGO_PROVEEDOR.find(x => x.value === m)?.label ?? 'Contado'
}

/**
 * D1 — valores por defecto del anticipo de una OC según el proveedor.
 * Si el proveedor cobra por anticipo y tiene un % válido → la OC arranca marcada como
 * "paga con anticipo" con ese %. El operador puede destildarlo u override del % por OC.
 */
export function defaultAnticipoOC(
  prov: { modo_pago?: string | null; anticipo_pct?: number | null } | null | undefined,
): { paga_con_anticipo: boolean; anticipo_pct: number | null } {
  if (prov?.modo_pago === 'anticipo' && prov.anticipo_pct != null && prov.anticipo_pct > 0) {
    return { paga_con_anticipo: true, anticipo_pct: prov.anticipo_pct }
  }
  return { paga_con_anticipo: false, anticipo_pct: null }
}

/** D1 — monto del anticipo = total × pct/100, redondeado a 2 decimales. */
export function montoAnticipo(total: number, pct: number | null | undefined): number {
  if (!pct || pct <= 0 || total <= 0) return 0
  return Math.round(total * pct / 100 * 100) / 100
}

// ── D2 — schedule de pago por OC (opcional, plantilla) ───────────────────────

export type BaseCuota = 'confirmacion' | 'recepcion' | 'dias'

export interface CuotaSchedule {
  /** Etiqueta libre opcional (ej. "Seña", "Saldo"). */
  etiqueta?: string
  /** Disparador del pago: al confirmar la OC, al recibir la mercadería, o a N días. */
  base: BaseCuota
  /** Días de plazo cuando base = 'dias'. */
  dias?: number | null
  /** Porcentaje del total. */
  pct: number
}

export const BASE_CUOTA_LABEL: Record<BaseCuota, string> = {
  confirmacion: 'Al confirmar la OC',
  recepcion: 'Al recibir',
  dias: 'A N días',
}

export function labelBaseCuota(c: CuotaSchedule): string {
  if (c.base === 'dias') return `A ${c.dias ?? 0} días`
  return BASE_CUOTA_LABEL[c.base]
}

/** Suma de porcentajes del schedule. */
export function totalPctSchedule(schedule: CuotaSchedule[] | null | undefined): number {
  if (!schedule || !schedule.length) return 0
  return Math.round(schedule.reduce((s, c) => s + (Number(c.pct) || 0), 0) * 100) / 100
}

/**
 * D2 — ¿el schedule es válido para guardar?
 * Cada cuota con pct > 0; la suma de pct = 100 (tolerancia 0.5); base 'dias' requiere días > 0.
 * Un schedule vacío/null es válido (es opcional → sin schedule).
 */
export function scheduleValido(schedule: CuotaSchedule[] | null | undefined): boolean {
  if (!schedule || !schedule.length) return true
  for (const c of schedule) {
    if (!(Number(c.pct) > 0)) return false
    if (c.base === 'dias' && !(Number(c.dias) > 0)) return false
  }
  return Math.abs(totalPctSchedule(schedule) - 100) <= 0.5
}

/** D2 — monto de una cuota = total × pct/100, redondeado a 2 decimales. */
export function montoCuota(total: number, pct: number): number {
  if (!pct || pct <= 0 || total <= 0) return 0
  return Math.round(total * pct / 100 * 100) / 100
}
