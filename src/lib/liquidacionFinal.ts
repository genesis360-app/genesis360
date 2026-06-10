// ── RH8 — A2-c: liquidación final (egreso) ───────────────────────────────────
// Lógica pura (testeable). Fórmulas LCT (editables en la UI). Sin I/O.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Indemnización por antigüedad (LCT art. 245): 1 mes del mejor sueldo por año de
 * servicio; la fracción mayor a 3 meses cuenta como año completo; mínimo 1 sueldo.
 * (El tope por convenio no se aplica acá — el monto es editable en la UI.)
 */
export function indemnizacionAntiguedad(mejorSueldo: number, antiguedadAnios: number, mesesFraccion: number): number {
  const sueldo = Math.max(0, Number(mejorSueldo) || 0)
  let anios = Math.max(0, Math.floor(Number(antiguedadAnios) || 0))
  if ((Number(mesesFraccion) || 0) > 3) anios += 1
  if (anios < 1) anios = 1 // mínimo 1 sueldo
  return round2(sueldo * anios)
}

/**
 * SAC proporcional al egreso = (mejor sueldo del semestre / 2) × (días trabajados
 * en el semestre / 182).
 */
export function sacProporcionalEgreso(mejorSueldoSemestre: number, diasTrabajadosSemestre: number): number {
  const dias = Math.max(0, Math.min(182, Number(diasTrabajadosSemestre) || 0))
  return round2((Number(mejorSueldoSemestre) || 0) / 2 * (dias / 182))
}

/**
 * Vacaciones no gozadas (LCT art. 155/156): valor del día de vacaciones = sueldo
 * mensual / 25, por los días pendientes.
 */
export function vacacionesNoGozadas(diasPendientes: number, sueldoMensual: number): number {
  const dias = Math.max(0, Number(diasPendientes) || 0)
  return round2((Number(sueldoMensual) || 0) / 25 * dias)
}

export interface LiquidacionFinalInput {
  mejorSueldo: number
  antiguedadAnios: number
  mesesFraccion: number
  mejorSueldoSemestre: number
  diasTrabajadosSemestre: number
  diasVacacionesPendientes: number
  sueldoMensual: number
  conIndemnizacion?: boolean   // renuncia / despido con causa → false
}

export interface LiquidacionFinal {
  indemnizacion: number
  sacProporcional: number
  vacacionesNoGozadas: number
  total: number
}

/** Liquidación final completa. `conIndemnizacion=false` (renuncia/despido con causa) la omite. */
export function liquidacionFinal(input: LiquidacionFinalInput): LiquidacionFinal {
  const indemnizacion = input.conIndemnizacion === false
    ? 0
    : indemnizacionAntiguedad(input.mejorSueldo, input.antiguedadAnios, input.mesesFraccion)
  const sacProporcional = sacProporcionalEgreso(input.mejorSueldoSemestre, input.diasTrabajadosSemestre)
  const vac = vacacionesNoGozadas(input.diasVacacionesPendientes, input.sueldoMensual)
  return {
    indemnizacion,
    sacProporcional,
    vacacionesNoGozadas: vac,
    total: round2(indemnizacion + sacProporcional + vac),
  }
}

/** Si el motivo de egreso genera indemnización (despido sin causa / fin de contrato sí; renuncia / con causa no). */
export function generaIndemnizacion(motivoEgreso: string | null | undefined): boolean {
  return motivoEgreso === 'despido_sin_causa' || motivoEgreso === 'fin_contrato'
}
