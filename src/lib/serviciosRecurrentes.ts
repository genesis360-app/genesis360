// Compras · CO7b — lógica pura de servicios recurrentes (F1) y comparación de presupuestos (F3). Sin I/O.

export type FrecuenciaServicio = 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'

export const FRECUENCIAS_SERVICIO: { value: FrecuenciaServicio; label: string; meses: number }[] = [
  { value: 'mensual', label: 'Mensual', meses: 1 },
  { value: 'bimestral', label: 'Bimestral', meses: 2 },
  { value: 'trimestral', label: 'Trimestral', meses: 3 },
  { value: 'semestral', label: 'Semestral', meses: 6 },
  { value: 'anual', label: 'Anual', meses: 12 },
]

export function mesesDeFrecuencia(f: FrecuenciaServicio | string | null | undefined): number {
  return FRECUENCIAS_SERVICIO.find(x => x.value === f)?.meses ?? 1
}

/** F1 — próxima fecha de vencimiento = fecha + N meses (según frecuencia). Devuelve 'YYYY-MM-DD'. */
export function proximoVencimiento(desdeISO: string, frecuencia: FrecuenciaServicio | string): string {
  const d = new Date(desdeISO + 'T12:00:00')
  d.setMonth(d.getMonth() + mesesDeFrecuencia(frecuencia))
  return d.toISOString().split('T')[0]
}

export interface ServicioRecurrente {
  recurrente?: boolean | null
  activo?: boolean | null
  proximo_vencimiento?: string | null
}

/** F1 — ¿el servicio recurrente está vencido (o vence hoy) y activo? */
export function servicioVencido(s: ServicioRecurrente, hoyISO: string): boolean {
  if (!s.recurrente || s.activo === false) return false
  if (!s.proximo_vencimiento) return false
  return s.proximo_vencimiento <= hoyISO
}

/** F1 — cuántos períodos se acumularon vencidos (por si no se generó en varios ciclos). */
export function periodosVencidos(s: ServicioRecurrente, frecuencia: FrecuenciaServicio | string, hoyISO: string): number {
  if (!servicioVencido(s, hoyISO)) return 0
  let n = 0
  let cur = s.proximo_vencimiento!
  // cuenta cuántas veces cabe el período desde proximo_vencimiento hasta hoy (incluido)
  while (cur <= hoyISO && n < 60) { n++; cur = proximoVencimiento(cur, frecuencia) }
  return n
}

// ── F3 — comparación de presupuestos lado a lado ─────────────────────────────

/** Normaliza un nombre para agrupar (lower, sin tildes, trim, espacios colapsados). */
export function normalizarNombre(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface PresupuestoComparable {
  id: string
  nombre?: string | null            // nombre del presupuesto o del servicio
  servicio_nombre?: string | null   // nombre del servicio_item asociado
  proveedor_nombre?: string | null
  monto?: number | null
  fecha?: string | null
}

export interface GrupoComparacion {
  concepto: string
  presupuestos: PresupuestoComparable[]
  montoMin: number | null
  idMin: string | null  // presupuesto más barato del grupo
}

/**
 * F3 — agrupa presupuestos por concepto (servicio) y los ordena por monto ascendente,
 * marcando el más barato de cada grupo. El concepto se deriva del servicio o del nombre.
 */
export function compararPresupuestos(presupuestos: PresupuestoComparable[]): GrupoComparacion[] {
  const grupos = new Map<string, PresupuestoComparable[]>()
  for (const p of presupuestos) {
    const conceptoRaw = p.servicio_nombre || p.nombre || 'Sin concepto'
    const key = normalizarNombre(conceptoRaw) || 'sin-concepto'
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key)!.push({ ...p, _concepto: conceptoRaw } as any)
  }
  const out: GrupoComparacion[] = []
  for (const [, lista] of grupos) {
    const ordenada = [...lista].sort((a, b) => (a.monto ?? Infinity) - (b.monto ?? Infinity))
    const conMonto = ordenada.filter(p => p.monto != null && p.monto > 0)
    const montoMin = conMonto.length ? conMonto[0].monto! : null
    const idMin = conMonto.length ? conMonto[0].id : null
    out.push({
      concepto: (ordenada[0] as any)._concepto ?? 'Sin concepto',
      presupuestos: ordenada,
      montoMin,
      idMin,
    })
  }
  // grupos con más de un presupuesto primero (los comparables), luego por concepto
  return out.sort((a, b) => b.presupuestos.length - a.presupuestos.length || a.concepto.localeCompare(b.concepto))
}
