// Saldo a favor (cliente_creditos) — lógica pura (testeable), sin I/O.
// Espejo JS de los guards del RPC `devolver_saldo_a_favor` (mig 246) para el cash-out en efectivo.
// El guard autoritativo es server-side (el RPC); este espejo documenta la regla y da cobertura unit.

export type ResultadoRetiro = { ok: true } | { ok: false; error: string }

/**
 * Valida si se puede devolver `monto` del saldo a favor en efectivo:
 *  - monto > 0
 *  - monto <= saldo a favor disponible (SUM(cliente_creditos.monto))
 *  - monto <= efectivo de la caja (no se permite caja en negativo, CAJ-18)
 * Tolerancia de 0.005 para redondeos de `numeric`.
 */
export function validarRetiroSaldoFavor(
  saldoDisponible: number,
  efectivoCaja: number,
  monto: number,
): ResultadoRetiro {
  const m = Math.round((Number(monto) || 0) * 100) / 100
  if (m <= 0) return { ok: false, error: 'El monto a devolver debe ser mayor a 0.' }
  if ((Number(saldoDisponible) || 0) < m - 0.005) {
    return { ok: false, error: 'No podés devolver más que el saldo a favor disponible.' }
  }
  if ((Number(efectivoCaja) || 0) < m - 0.005) {
    return { ok: false, error: 'No hay suficiente efectivo en la caja.' }
  }
  return { ok: true }
}
