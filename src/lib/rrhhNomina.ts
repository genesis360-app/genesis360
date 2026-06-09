// ── RH2 — Conceptos + aportes AR + SAC ───────────────────────────────────────
// Lógica pura (testeable) del cálculo de la nómina: aportes/retenciones (B4),
// beneficios extra y aguinaldo/SAC (B5). Sin I/O.

export type TipoCalculo = 'fijo' | 'porcentaje' | 'sobre_bruto'

export interface ConceptoNomina {
  id: string
  nombre: string
  tipo: 'HABER' | 'DESCUENTO'
  tipo_calculo?: TipoCalculo | null
  default_pct?: number | null
  default_monto?: number | null
  es_aporte?: boolean | null
}

export interface BeneficioExtra {
  nombre: string
  tipo: 'monto' | 'porcentaje'
  valor: number
}

export interface ItemNomina {
  concepto_id: string | null
  descripcion: string
  tipo: 'HABER' | 'DESCUENTO'
  monto: number
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Monto de un concepto sobre una base (el sueldo bruto/básico del período).
 *  - 'fijo'        → default_monto
 *  - 'porcentaje' / 'sobre_bruto' → base × default_pct/100
 */
export function montoConcepto(c: ConceptoNomina, base: number): number {
  const tc = c.tipo_calculo ?? 'porcentaje'
  if (tc === 'fijo') return round2(Number(c.default_monto) || 0)
  const pct = Number(c.default_pct) || 0
  return round2((Number(base) || 0) * (pct / 100))
}

/** Monto de un beneficio extra sobre la base. */
export function montoBeneficio(b: BeneficioExtra, base: number): number {
  if (b.tipo === 'porcentaje') return round2((Number(base) || 0) * (Number(b.valor) || 0) / 100)
  return round2(Number(b.valor) || 0)
}

/**
 * B4 — Arma los ítems de la liquidación de un empleado a partir del básico:
 *  - Sueldo básico (HABER)
 *  - Beneficios extra activos (HABER) — en $ o %
 *  - Aportes activos del empleado (DESCUENTO) — solo los concepto_id que están en `aportesActivos`
 *    (el operador prende/apaga el checkbox por empleado; el % vive en el concepto/Config).
 * Devuelve los ítems + totales (haberes/descuentos/neto).
 */
export function calcularItemsNomina(
  basico: number,
  conceptosAporte: ConceptoNomina[],
  aportesActivos: string[],
  beneficios: BeneficioExtra[] = [],
): { items: ItemNomina[]; totalHaberes: number; totalDescuentos: number; neto: number } {
  const base = Number(basico) || 0
  const items: ItemNomina[] = []
  if (base > 0) items.push({ concepto_id: null, descripcion: 'Sueldo básico', tipo: 'HABER', monto: round2(base) })

  for (const b of beneficios) {
    const m = montoBeneficio(b, base)
    if (m !== 0) items.push({ concepto_id: null, descripcion: b.nombre || 'Beneficio', tipo: 'HABER', monto: m })
  }

  const activos = new Set(aportesActivos)
  for (const c of conceptosAporte) {
    if (!activos.has(c.id)) continue
    const m = montoConcepto(c, base)
    if (m !== 0) items.push({ concepto_id: c.id, descripcion: c.nombre, tipo: c.tipo, monto: m })
  }

  const totalHaberes = round2(items.filter(i => i.tipo === 'HABER').reduce((s, i) => s + i.monto, 0))
  const totalDescuentos = round2(items.filter(i => i.tipo === 'DESCUENTO').reduce((s, i) => s + i.monto, 0))
  return { items, totalHaberes, totalDescuentos, neto: round2(totalHaberes - totalDescuentos) }
}

/** B5 — Mejor (mayor) sueldo básico de un semestre, como pide la LCT para el SAC. */
export function mejorSueldoSemestre(basicos: number[]): number {
  if (!basicos || basicos.length === 0) return 0
  return round2(Math.max(0, ...basicos.map(b => Number(b) || 0)))
}

/**
 * B5 — SAC (aguinaldo) = 50% del mejor sueldo del semestre, prorrateado por los
 * meses trabajados en el semestre (mesesTrabajados/6). Por defecto semestre completo.
 */
export function sacMejorSueldo(mejorSueldo: number, mesesTrabajados = 6): number {
  const m = Math.min(6, Math.max(0, Number(mesesTrabajados) || 0))
  return round2((Number(mejorSueldo) || 0) * 0.5 * (m / 6))
}

/** Defaults del catálogo base AR (para seed / referencia). Los % viven en el concepto. */
export const APORTES_AR_BASE = [
  { nombre: 'Jubilación',  pct: 11, es_aporte: true },
  { nombre: 'Obra Social', pct: 3,  es_aporte: true },
  { nombre: 'Ley 19.032',  pct: 3,  es_aporte: true },
] as const
