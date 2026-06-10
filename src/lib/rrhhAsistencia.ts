// ── RH6 — Asistencia 2.0: tardanza (D3) + horas extra (D5) ───────────────────
// Lógica pura (testeable). Sin I/O.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export const LICENCIA_TIPOS = [
  { v: 'medica',     t: 'Licencia médica' },
  { v: 'paga',       t: 'Licencia paga' },
  { v: 'no_paga',    t: 'Licencia no paga' },
  { v: 'paternidad', t: 'Paternidad' },
  { v: 'maternidad', t: 'Maternidad' },
  { v: 'familiar',   t: 'Familiar enfermo' },
  { v: 'examen',     t: 'Exámenes' },
] as const

export const REGLA_PAGO_FERIADO = [
  { v: 'simple', t: 'Simple (x1)', factor: 1 },
  { v: 'doble',  t: 'Doble (x2)',  factor: 2 },
  { v: 'triple', t: 'Triple (x3)', factor: 3 },
] as const

/** Sueldo por hora a partir del bruto mensual y las horas base del mes (default 200). */
export function sueldoHora(salarioBruto: number, horasMesBase = 200): number {
  const base = Number(horasMesBase) || 200
  if (base <= 0) return 0
  return round2((Number(salarioBruto) || 0) / base)
}

export interface TardanzaConfig {
  modo: 'registrar' | 'proporcional' | 'umbral'
  toleranciaMin?: number
}

/**
 * D3 — Descuento por tardanza:
 *  - 'registrar'    → 0 (solo se registra, sin descuento)
 *  - 'proporcional' → minutos × sueldo/minuto
 *  - 'umbral'       → solo descuenta los minutos que exceden la tolerancia
 */
export function descuentoTardanza(minutosTarde: number, sueldoHoraValor: number, cfg: TardanzaConfig): number {
  const min = Math.max(0, Number(minutosTarde) || 0)
  const porMinuto = (Number(sueldoHoraValor) || 0) / 60
  if (cfg.modo === 'registrar' || min === 0) return 0
  if (cfg.modo === 'umbral') {
    const excedente = Math.max(0, min - (Number(cfg.toleranciaMin) || 0))
    return round2(excedente * porMinuto)
  }
  // proporcional
  return round2(min * porMinuto)
}

/**
 * D3 — Minutos tarde "facturables" del período a partir de las fichadas de entrada.
 * Toma la PRIMERA entrada de cada día, la compara contra el horario de entrada del
 * empleado y suma los minutos de atraso. La tolerancia se aplica por día (solo en
 * modo 'umbral'). Devuelve 0 si no hay horario, si el modo es 'registrar' o si no hubo atraso.
 * El descuento se calcula después con descuentoTardanza(min, sueldoHora, {modo:'proporcional'}).
 */
export function minutosTardeFacturables(
  entradas: { ts: string }[],
  horarioEntrada: string | null | undefined,
  cfg: TardanzaConfig,
): number {
  if (!horarioEntrada || cfg.modo === 'registrar' || !entradas?.length) return 0
  const tol = cfg.modo === 'umbral' ? Math.max(0, Number(cfg.toleranciaMin) || 0) : 0
  const [hh, mm] = horarioEntrada.split(':').map(Number)
  const horarioMin = (hh || 0) * 60 + (mm || 0)
  // Primera entrada de cada día (hora local del navegador del que liquida).
  const primeraPorDia = new Map<string, number>()
  for (const e of entradas) {
    const d = new Date(e.ts)
    if (isNaN(d.getTime())) continue
    const dia = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const minDia = d.getHours() * 60 + d.getMinutes()
    const prev = primeraPorDia.get(dia)
    if (prev === undefined || minDia < prev) primeraPorDia.set(dia, minDia)
  }
  let total = 0
  for (const minDia of primeraPorDia.values()) {
    total += Math.max(0, minDia - horarioMin - tol)
  }
  return total
}

/** D5 — Monto de horas extra = horas × sueldo/hora × (1 + multiplicador/100). */
export function montoHorasExtra(horas: number, sueldoHoraValor: number, multiplicadorPct: number): number {
  const h = Math.max(0, Number(horas) || 0)
  const sh = Number(sueldoHoraValor) || 0
  const mult = Number(multiplicadorPct) || 0
  return round2(h * sh * (1 + mult / 100))
}

/** D6 — Monto del día de un feriado trabajado según la regla de pago. */
export function montoFeriadoTrabajado(sueldoDia: number, regla: 'simple' | 'doble' | 'triple'): number {
  const factor = REGLA_PAGO_FERIADO.find(r => r.v === regla)?.factor ?? 2
  return round2((Number(sueldoDia) || 0) * factor)
}
