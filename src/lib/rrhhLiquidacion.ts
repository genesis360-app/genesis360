// ── RH4 — Frecuencia de liquidación + anticipos ──────────────────────────────
// Lógica pura (testeable). B1 prorrateo del básico según la frecuencia · B10 anticipos.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export const FRECUENCIAS = [
  { v: 'mensual',       t: 'Mensual' },
  { v: 'quincenal',     t: 'Quincenal' },
  { v: 'semanal',       t: 'Semanal' },
  { v: 'personalizado', t: 'Cada X días' },
] as const

/**
 * B1 — Factor de prorrateo del básico mensual según la frecuencia de liquidación.
 *  mensual = 1 · quincenal = 1/2 · semanal = 1/4 · personalizado = dias/30 (tope 1).
 */
export function factorProrrateo(frecuencia: string, dias?: number | null): number {
  switch (frecuencia) {
    case 'quincenal': return 0.5
    case 'semanal':   return 0.25
    case 'personalizado': {
      const d = Number(dias) || 0
      if (d <= 0) return 1
      return Math.min(1, round2(d / 30))
    }
    case 'mensual':
    default:          return 1
  }
}

/** B1 — Básico prorrateado del período según la frecuencia del empleado. */
export function basicoProrrateado(basicoMensual: number, frecuencia: string, dias?: number | null): number {
  return round2((Number(basicoMensual) || 0) * factorProrrateo(frecuencia, dias))
}

export interface AnticipoPendiente {
  id: string
  monto: number
}

/** B10 — Total a descontar por anticipos pendientes (sin superar el neto disponible). */
export function totalAnticipos(anticipos: AnticipoPendiente[]): number {
  return round2((anticipos ?? []).reduce((s, a) => s + (Number(a.monto) || 0), 0))
}

/**
 * B10 — Cuánto de los anticipos pendientes se puede descontar en esta liquidación
 * sin dejar el neto negativo. Devuelve el monto a descontar y los ids que se saldan
 * completos (descuento parcial deja el resto pendiente).
 */
export function anticiposADescontar(
  anticipos: AnticipoPendiente[],
  netoDisponible: number,
): { monto: number; saldadosIds: string[] } {
  let restante = Math.max(0, Number(netoDisponible) || 0)
  let monto = 0
  const saldadosIds: string[] = []
  for (const a of anticipos ?? []) {
    const m = Number(a.monto) || 0
    if (m <= 0) continue
    if (m <= restante) {
      monto = round2(monto + m); restante = round2(restante - m); saldadosIds.push(a.id)
    } else if (restante > 0) {
      monto = round2(monto + restante); restante = 0
    }
  }
  return { monto: round2(monto), saldadosIds }
}
