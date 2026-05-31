// G4 del relevamiento Ventas (2026-05-31) — visibilidad de precio de costo y margen.
// El costo y el margen son información sensible: solo los roles de gestión/contables
// pueden verlos. CAJERO y DEPOSITO operan con precio de venta, nunca con costo/margen.

import type { RolUsuario } from './cajaPermisos'

// Roles que SÍ pueden ver precio de costo y margen en POS / Productos.
const ROLES_VEN_COSTO: RolUsuario[] = ['DUEÑO', 'SUPERVISOR', 'ADMIN', 'CONTADOR', 'SUPER_USUARIO']

/**
 * Devuelve TRUE si el rol puede ver precio de costo y margen.
 * Oculto para CAJERO / DEPOSITO / RRHH.
 */
export function puedeVerCosto(rol: RolUsuario | string | null | undefined): boolean {
  if (!rol) return false
  return ROLES_VEN_COSTO.includes(rol as RolUsuario)
}
