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

/**
 * Monto de crédito a favor a auto-sugerir como medio de pago en el POS.
 * = min(saldo disponible, total a cobrar), nunca negativo.
 *  - si el cliente gasta MENOS que su crédito → el resto queda a favor (el ledger
 *    sólo consume lo efectivamente aplicado, no hace cash-out).
 *  - si gasta MÁS → el faltante se cubre con otro medio (split normal).
 * Nunca supera el saldo disponible, así que respeta el guard server-aware de
 * `registrarVenta` (no se puede aplicar más crédito del que el cliente tiene).
 */
export function montoSugeridoCredito(saldoDisponible: number, totalACobrar: number): number {
  const saldo = Math.max(0, Number(saldoDisponible) || 0)
  const total = Math.max(0, Number(totalACobrar) || 0)
  return Math.round(Math.min(saldo, total) * 100) / 100
}

/** `origen` con que vuelve al saldo el crédito aplicado en una venta anulada. */
export const ORIGEN_ANULACION_VENTA = 'anulacion_venta'

export interface MovimientoCredito { monto: number | string | null; origen: string | null }

/**
 * 🛑 REGLA #0 — cuánto crédito a favor vuelve al cliente al anular una venta o cancelar una reserva con
 * devolución (2026-09-14, decisión de GO). Anular deshace lo que la venta asentó: el crédito consumido
 * (`consumo_venta`, negativo) vuelve al saldo, con la penalidad de la seña aplicada (`ratio`). Se descuenta lo
 * ya restituido (`anulacion_venta`), así un reintento no lo devuelve dos veces.
 *
 * Fuente: los movimientos de `cliente_creditos` de ESA venta, no `ventas.medio_pago` — el ledger es lo que
 * de verdad se consumió. El `numeric` puede llegar como string: se normaliza.
 */
export function creditoARestituirPorAnulacion(movimientos: MovimientoCredito[], ratio: number): number {
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
    return Number.isFinite(n) ? n : 0
  }
  const consumido = movimientos
    .filter(m => m.origen === 'consumo_venta')
    .reduce((a, m) => a + Math.max(0, -num(m.monto)), 0)
  const yaRestituido = movimientos
    .filter(m => m.origen === ORIGEN_ANULACION_VENTA)
    .reduce((a, m) => a + Math.max(0, num(m.monto)), 0)
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  return Math.max(0, Math.round((consumido * r - yaRestituido) * 100) / 100)
}
