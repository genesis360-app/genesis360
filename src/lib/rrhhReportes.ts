// ── RH8 — G1: reportes de RRHH ───────────────────────────────────────────────
// Lógica pura (testeable). Sin I/O.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface SalarioRep { empleado_id: string; departamento?: string | null; periodo: string; neto: number; pagado: boolean }
export interface AsistenciaRep { empleado_id: string; empleado?: string | null; estado: string }
export interface SaldoVacRep { empleado?: string | null; dias_totales: number; dias_usados: number; remanente_anterior: number }
export interface EmpleadoRep { id: string; nombre?: string | null; fecha_ingreso: string; fecha_egreso?: string | null; activo: boolean }

/** G1 — Costo laboral (neto) por departamento. */
export function costoLaboralPorDepto(salarios: SalarioRep[]): { departamento: string; total: number; cantidad: number }[] {
  const map = new Map<string, { total: number; cantidad: number }>()
  for (const s of salarios ?? []) {
    const dep = (s.departamento ?? 'Sin departamento').trim() || 'Sin departamento'
    const acc = map.get(dep) ?? { total: 0, cantidad: 0 }
    acc.total = round2(acc.total + (Number(s.neto) || 0)); acc.cantidad++
    map.set(dep, acc)
  }
  return [...map.entries()].map(([departamento, a]) => ({ departamento, ...a })).sort((a, b) => b.total - a.total)
}

/** G1 — Asistencia consolidada por empleado (presente/ausente/tardanza/licencia). */
export function asistenciaConsolidada(asistencias: AsistenciaRep[]): { empleado_id: string; empleado: string; presente: number; ausente: number; tardanza: number; licencia: number }[] {
  const map = new Map<string, { empleado: string; presente: number; ausente: number; tardanza: number; licencia: number }>()
  for (const a of asistencias ?? []) {
    const acc = map.get(a.empleado_id) ?? { empleado: a.empleado ?? '—', presente: 0, ausente: 0, tardanza: 0, licencia: 0 }
    if (a.estado === 'presente') acc.presente++
    else if (a.estado === 'ausente') acc.ausente++
    else if (a.estado === 'tardanza') acc.tardanza++
    else if (a.estado === 'licencia') acc.licencia++
    map.set(a.empleado_id, acc)
  }
  return [...map.entries()].map(([empleado_id, a]) => ({ empleado_id, ...a }))
}

/** G1 — Resumen de vacaciones por empleado: asignados (totales+remanente), usados, disponibles. */
export function vacacionesResumen(saldos: SaldoVacRep[]): { empleado: string; asignados: number; usados: number; disponibles: number }[] {
  return (saldos ?? []).map(s => {
    const asignados = (Number(s.dias_totales) || 0) + (Number(s.remanente_anterior) || 0)
    const usados = Number(s.dias_usados) || 0
    return { empleado: s.empleado ?? '—', asignados, usados, disponibles: Math.max(0, asignados - usados) }
  })
}

/** G1 — Antigüedad y rotación: activos/bajas + permanencia promedio (años) de los activos. */
export function antiguedadRotacion(empleados: EmpleadoRep[], refISO: string): { activos: number; bajas: number; permanenciaPromedioAnios: number } {
  const ref = new Date(refISO + 'T00:00:00').getTime()
  const activos = (empleados ?? []).filter(e => e.activo)
  const bajas = (empleados ?? []).filter(e => !e.activo).length
  let suma = 0
  for (const e of activos) {
    const ing = new Date(e.fecha_ingreso + 'T00:00:00').getTime()
    if (!isNaN(ing)) suma += (ref - ing) / (365.25 * 86400000)
  }
  return { activos: activos.length, bajas, permanenciaPromedioAnios: activos.length > 0 ? round2(suma / activos.length) : 0 }
}

/** G1 — Recibos del período: pendientes vs pagados (cantidad + monto). */
export function recibosResumen(salarios: SalarioRep[]): { pagadosCant: number; pagadosMonto: number; pendientesCant: number; pendientesMonto: number } {
  let pagadosCant = 0, pagadosMonto = 0, pendientesCant = 0, pendientesMonto = 0
  for (const s of salarios ?? []) {
    if (s.pagado) { pagadosCant++; pagadosMonto = round2(pagadosMonto + (Number(s.neto) || 0)) }
    else { pendientesCant++; pendientesMonto = round2(pendientesMonto + (Number(s.neto) || 0)) }
  }
  return { pagadosCant, pagadosMonto, pendientesCant, pendientesMonto }
}
