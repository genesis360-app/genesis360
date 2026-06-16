import type { SupabaseClient } from '@supabase/supabase-js'

// Tipos de movimiento que afectan el EFECTIVO de una sesión de caja (espeja CajaPage:
// totalIngresos / totalEgresos). Los `*_informativo` (no efectivo) NO cuentan.
export const TIPOS_INGRESO_EFECTIVO = ['ingreso', 'ingreso_reserva', 'ingreso_traspaso'] as const
export const TIPOS_EGRESO_EFECTIVO = ['egreso', 'egreso_devolucion_sena', 'egreso_traspaso'] as const

/** Saldo de efectivo dado apertura + movimientos (lógica pura, testeable). */
export function calcularSaldoEfectivo(
  apertura: number,
  movimientos: Array<{ tipo: string; monto: number | string }>,
): number {
  let saldo = Number(apertura) || 0
  for (const m of movimientos) {
    const monto = Number(m.monto) || 0
    if ((TIPOS_INGRESO_EFECTIVO as readonly string[]).includes(m.tipo)) saldo += monto
    else if ((TIPOS_EGRESO_EFECTIVO as readonly string[]).includes(m.tipo)) saldo -= monto
  }
  return saldo
}

/**
 * Saldo de EFECTIVO actual de una sesión de caja (apertura + ingresos − egresos en efectivo).
 * Usado para impedir egresos que dejarían la caja en negativo (gastos/devolución en efectivo).
 */
export async function saldoEfectivoSesion(supabase: SupabaseClient, sesionId: string): Promise<number> {
  const { data: sesion } = await supabase.from('caja_sesiones')
    .select('monto_apertura').eq('id', sesionId).maybeSingle()
  const { data: movs } = await supabase.from('caja_movimientos')
    .select('tipo, monto').eq('sesion_id', sesionId)
  return calcularSaldoEfectivo(Number((sesion as any)?.monto_apertura ?? 0), (movs ?? []) as any[])
}
