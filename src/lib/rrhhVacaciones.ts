// ── RH5 — Vacaciones 2.0 ─────────────────────────────────────────────────────
// Lógica pura (testeable). C1 días por antigüedad LCT · C3 plazo de aviso
// C4 solapamiento · C5 partición · C6 remanente. Sin I/O.

/**
 * C1 — Días de vacaciones por antigüedad (LCT 20.744, art. 150):
 *   < 5 años → 14 · 5 a 10 → 21 · 10 a 20 → 28 · ≥ 20 → 35.
 * La antigüedad se cuenta al 31/12 del año en curso.
 */
export function diasVacacionesLCT(antiguedadAnios: number): number {
  const a = Number(antiguedadAnios) || 0
  if (a >= 20) return 35
  if (a >= 10) return 28
  if (a >= 5) return 21
  return 14
}

/** Antigüedad en años (enteros) entre la fecha de ingreso y una fecha de referencia. */
export function antiguedadAnios(fechaIngresoISO: string, refISO: string): number {
  if (!fechaIngresoISO) return 0
  const ing = new Date(fechaIngresoISO + 'T00:00:00')
  const ref = new Date(refISO + 'T00:00:00')
  if (isNaN(ing.getTime()) || isNaN(ref.getTime())) return 0
  let anios = ref.getFullYear() - ing.getFullYear()
  const m = ref.getMonth() - ing.getMonth()
  if (m < 0 || (m === 0 && ref.getDate() < ing.getDate())) anios--
  return Math.max(0, anios)
}

/**
 * C6 — Remanente que se arrastra al año siguiente: (totales + remanente_anterior − usados),
 * acotado por `max` (0 = sin límite) y nunca negativo.
 */
export function remanenteSiguiente(totales: number, usados: number, remanenteAnterior: number, max: number): number {
  const rem = Math.max(0, (Number(totales) || 0) + (Number(remanenteAnterior) || 0) - (Number(usados) || 0))
  const m = Number(max) || 0
  return m > 0 ? Math.min(rem, m) : rem
}

export interface Periodo { desde: string; hasta: string }

/** Dos rangos de fecha se solapan si desde1 <= hasta2 && desde2 <= hasta1. */
export function rangosSolapan(a: Periodo, b: Periodo): boolean {
  return a.desde <= b.hasta && b.desde <= a.hasta
}

/** C4 — Solicitudes aprobadas que se solapan con un período dado. */
export function solapamientos<T extends Periodo>(periodo: Periodo, aprobadas: T[]): T[] {
  return (aprobadas ?? []).filter(a => rangosSolapan(periodo, a))
}

export interface AvisoConfig { modo: 'sin' | 'fijo' | 'alerta'; dias?: number }

/**
 * C3 — Evalúa el plazo de aviso entre hoy y el inicio de las vacaciones.
 *  - 'sin'   → siempre ok.
 *  - 'alerta'→ ok=true pero `aviso=true` si no cumple (solo avisa, no bloquea).
 *  - 'fijo'  → ok=false si no cumple (bloquea).
 */
export function evaluarAviso(hoyISO: string, desdeISO: string, cfg: AvisoConfig): { ok: boolean; aviso: boolean; diasAnticipacion: number } {
  const hoy = new Date(hoyISO + 'T00:00:00').getTime()
  const desde = new Date(desdeISO + 'T00:00:00').getTime()
  const diasAnticipacion = Math.floor((desde - hoy) / 86400000)
  if (cfg.modo === 'sin') return { ok: true, aviso: false, diasAnticipacion }
  const cumple = diasAnticipacion >= (Number(cfg.dias) || 0)
  if (cfg.modo === 'fijo') return { ok: cumple, aviso: !cumple, diasAnticipacion }
  // alerta
  return { ok: true, aviso: !cumple, diasAnticipacion }
}

/** C5 — Valida la partición de vacaciones (mínimo de días por bloque / máximo de bloques). */
export function validarParticion(
  diasBloque: number,
  bloquesYaAprobados: number,
  cfg: { minBloque?: number; maxBloques?: number },
): { ok: boolean; motivo?: string } {
  const min = Number(cfg.minBloque) || 0
  const max = Number(cfg.maxBloques) || 0
  if (min > 0 && diasBloque > 0 && diasBloque < min) return { ok: false, motivo: `El bloque mínimo es de ${min} días` }
  if (max > 0 && bloquesYaAprobados + 1 > max) return { ok: false, motivo: `Máximo ${max} períodos por año` }
  return { ok: true }
}
