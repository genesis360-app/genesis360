// Helpers de umbral de gasto por rol (v1.8.43)
// Regla:
//   DUEÑO/ADMIN/SUPER_USUARIO → sin restricción (todo permitido)
//   SUPERVISOR → hasta sucursal.umbral_gasto_supervisor; si NULL → sin restricción
//   CAJERO    → hasta sucursal.umbral_gasto_cajero; si NULL → todo requiere autorización
//   CONTADOR  → no crea/edita gastos (solo IVA del gasto, se controla en la UI)

import type { Sucursal } from './supabase'

export type UmbralEval = {
  aplica: boolean
  umbral: number | null
  superado: boolean
  rolMinimoAprobador: 'SUPERVISOR' | 'DUEÑO' | null
}

type RolBasico = string | undefined | null

export function evaluarUmbralGasto(
  userRol: RolBasico,
  sucursal: Pick<Sucursal, 'umbral_gasto_supervisor' | 'umbral_gasto_cajero'> | null | undefined,
  monto: number,
): UmbralEval {
  if (!userRol) return { aplica: false, umbral: null, superado: false, rolMinimoAprobador: null }
  if (['DUEÑO', 'ADMIN', 'SUPER_USUARIO'].includes(userRol)) {
    return { aplica: false, umbral: null, superado: false, rolMinimoAprobador: null }
  }
  if (userRol === 'SUPERVISOR') {
    const u = sucursal?.umbral_gasto_supervisor ?? null
    if (u == null) return { aplica: false, umbral: null, superado: false, rolMinimoAprobador: null }
    return { aplica: true, umbral: Number(u), superado: monto > Number(u), rolMinimoAprobador: 'DUEÑO' }
  }
  if (userRol === 'CAJERO') {
    const u = sucursal?.umbral_gasto_cajero ?? null
    if (u == null) return { aplica: true, umbral: null, superado: true, rolMinimoAprobador: 'SUPERVISOR' }
    return { aplica: true, umbral: Number(u), superado: monto > Number(u), rolMinimoAprobador: 'SUPERVISOR' }
  }
  return { aplica: false, umbral: null, superado: false, rolMinimoAprobador: null }
}

export function puedeAprobar(solicitanteRol: string, aprobadorRol: string): boolean {
  if (solicitanteRol === 'CAJERO')     return ['SUPERVISOR', 'ADMIN', 'DUEÑO', 'SUPER_USUARIO'].includes(aprobadorRol)
  if (solicitanteRol === 'SUPERVISOR') return ['ADMIN', 'DUEÑO', 'SUPER_USUARIO'].includes(aprobadorRol)
  return false
}
