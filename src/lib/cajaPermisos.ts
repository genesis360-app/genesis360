// Matriz de permisos del módulo Caja — J3 del relevamiento Caja (2026-05-25)
// Centraliza qué puede hacer cada rol. Usar en CajaPage, ConfigPage, helpers de venta.

export type RolUsuario = 'DUEÑO' | 'SUPERVISOR' | 'CAJERO' | 'CONTADOR' | 'DEPOSITO' | 'RRHH' | 'ADMIN' | 'SUPER_USUARIO'

export type AccionCaja =
  | 'abrir_propia'
  | 'abrir_ajena'              // abrir caja a nombre de otro cajero (A2)
  | 'cerrar_propia'
  | 'cerrar_ajena'             // requiere clave maestra
  | 'ingreso_manual'
  | 'traspaso_entre_cajas'
  | 'ver_boveda_saldo'
  | 'depositar_boveda'
  | 'extraer_boveda'           // E4 — solo DUEÑO+
  | 'cambiar_clave_maestra'    // B6 — solo DUEÑO
  | 'reimprimir_ticket_cierre'
  | 'editar_movimiento'        // botón "Corregir" — G1
  | 'anular_venta'             // requiere clave maestra (B5)
  | 'ver_lectura_solo'         // CONTADOR — J1

/**
 * Matriz J3 del relevamiento. Cada acción mapea a roles permitidos.
 * Algunas requieren config adicional del tenant (ver permiteOpcionalConConfig).
 */
const MATRIZ: Record<AccionCaja, RolUsuario[]> = {
  abrir_propia:           ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'SUPER_USUARIO'],
  abrir_ajena:            ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO'],
  cerrar_propia:          ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'SUPER_USUARIO'],
  cerrar_ajena:           ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO'],
  ingreso_manual:         ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'SUPER_USUARIO'],
  traspaso_entre_cajas:   ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'SUPER_USUARIO'],
  ver_boveda_saldo:       ['DUEÑO', 'ADMIN', 'SUPER_USUARIO'],            // SUPERVISOR opcional via config
  depositar_boveda:       ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'SUPER_USUARIO'],
  extraer_boveda:         ['DUEÑO', 'ADMIN', 'SUPER_USUARIO'],
  cambiar_clave_maestra:  ['DUEÑO'],                                       // B6 — estricto
  reimprimir_ticket_cierre: ['DUEÑO', 'SUPERVISOR', 'CONTADOR', 'ADMIN', 'SUPER_USUARIO'],
  editar_movimiento:      ['DUEÑO', 'ADMIN', 'SUPER_USUARIO'],             // SUPERVISOR opcional via config
  anular_venta:           ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'SUPER_USUARIO'],
  ver_lectura_solo:       ['DUEÑO', 'SUPERVISOR', 'CAJERO', 'CONTADOR', 'ADMIN', 'SUPER_USUARIO'],
}

/**
 * Acciones que SUPERVISOR puede hacer si el DUEÑO lo habilita en config_caja del tenant.
 * Mapea acción → flag JSONB.
 */
const SUPERVISOR_OPCIONAL: Partial<Record<AccionCaja, string>> = {
  ver_boveda_saldo:   'supervisor_puede_ver_boveda',
  editar_movimiento:  'supervisor_puede_editar_movimientos',
}

export interface ConfigCaja {
  supervisor_puede_ver_boveda?: boolean
  supervisor_puede_editar_movimientos?: boolean
  forzar_cierre_dia_anterior?: boolean
}

/**
 * Devuelve TRUE si el rol puede hacer la acción.
 * Si la acción es opcional para SUPERVISOR, lee config_caja del tenant.
 */
export function puede(rol: RolUsuario | null | undefined, accion: AccionCaja, configCaja?: ConfigCaja | null): boolean {
  if (!rol) return false
  if (MATRIZ[accion].includes(rol)) return true
  // SUPERVISOR puede tener permisos opcionales habilitados por el DUEÑO
  if (rol === 'SUPERVISOR') {
    const flag = SUPERVISOR_OPCIONAL[accion]
    if (flag && configCaja?.[flag as keyof ConfigCaja]) return true
  }
  return false
}

/**
 * Acciones que requieren clave maestra del tenant — B5 del relevamiento.
 * Si el tenant no tiene clave maestra configurada, ninguna la requiere.
 */
export const ACCIONES_CON_CLAVE_MAESTRA: AccionCaja[] = [
  'cerrar_ajena',
  'anular_venta',
  // Más adelante: 'abrir_caja_diferencia', 'anular_movimiento'
]

export function requiereClaveMaestra(accion: AccionCaja, claveMaestraConfigurada: boolean): boolean {
  if (!claveMaestraConfigurada) return false
  return ACCIONES_CON_CLAVE_MAESTRA.includes(accion)
}
