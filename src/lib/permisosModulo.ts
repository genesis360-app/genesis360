// ─── Permisos de rol custom por módulo ───────────────────────────────────────
// Los roles custom (tabla roles_custom) mapean cada módulo a 'no_ver'|'ver'|'editar'.
// Hasta v1.56 esto solo se aplicaba en el nav ('no_ver' ocultaba). Acá agregamos
// el enforcement de SOLO-LECTURA ('ver') en las mutaciones: un rol custom marcado
// "ver" en un módulo no debe poder crear/editar/eliminar en él.
//
// Aplica solo a usuarios con rol custom (permisos_custom presente). Para los roles
// fijos (DUEÑO/CAJERO/etc.) `permisos_custom` es null y estos helpers no bloquean
// nada — esos roles siguen gobernados por su lógica de página habitual.

export type PermisoModulo = 'no_ver' | 'ver' | 'editar' | 'supervisa'

type ConPermisos = { rol?: string | null; permisos_custom?: Record<string, PermisoModulo> | null } | null | undefined

/** El rol fijo LECTOR (Viewer) es solo-lectura en TODOS los módulos. */
function esLector(user: ConPermisos): boolean {
  return user?.rol === 'VIEWER'
}

/** El módulo está en SOLO LECTURA. True para el rol LECTOR (todo) o un rol custom con 'ver'. */
export function moduloSoloLectura(user: ConPermisos, modulo: string): boolean {
  if (esLector(user)) return true
  return user?.permisos_custom?.[modulo] === 'ver'
}

/** El rol custom tiene este módulo OCULTO ('no_ver'). */
export function moduloOculto(user: ConPermisos, modulo: string): boolean {
  return user?.permisos_custom?.[modulo] === 'no_ver'
}

/** Puede editar/mutar el módulo: no es LECTOR, ni está en solo-lectura/oculto por rol custom.
 *  'supervisa' también puede editar — es un superset de 'editar' (aprueba/reasigna Y edita normal). */
export function puedeEditarModulo(user: ConPermisos, modulo: string): boolean {
  if (esLector(user)) return false
  const p = user?.permisos_custom?.[modulo]
  return p !== 'ver' && p !== 'no_ver'
}

// ─── Patrón "Pestaña de Supervisor" reusable (relevamiento derivado #2 hacia Repositores, ──────────
// decisión C2 cerrada con GO 2026-08-09) — 4º nivel de permiso, DISTINTO del rol fijo ADMIN (staff de
// soporte cross-tenant, ver reference_rol_admin_staff_aislamiento) por eso se llama 'supervisa' y no
// 'admin'. Módulos donde el rol fijo SUPERVISOR NO tiene acceso hoy (mismo set que los nav items
// `ownerOnly` en navVisibility.ts que SUPERVISOR no pasa) — mantener sincronizado si se agrega un
// nav item ownerOnly nuevo.
const SUPERVISOR_MODULOS_PROHIBIDOS = [
  'configuracion', 'usuarios', 'sucursales', 'rrhh', 'facturacion', 'proveedores', 'recursos', 'biblioteca',
]

/** Puede supervisar (aprobar/reasignar) el módulo. DUEÑO/SUPER_USUARIO/ADMIN(staff): siempre,
 *  inmutable — no pasan por permisos_custom, así que no hay fila que editar (mismo criterio que ya
 *  usa aprobar_cambio_estado_inventario). SUPERVISOR: hereda automático en los módulos donde ya tiene
 *  acceso hoy, sin configuración extra. Rol custom: necesita 'supervisa' explícito en permisos_custom. */
export function puedeSupervisarModulo(user: ConPermisos, modulo: string): boolean {
  if (user?.rol === 'DUEÑO' || user?.rol === 'SUPER_USUARIO' || user?.rol === 'ADMIN') return true
  if (user?.rol === 'SUPERVISOR') return !SUPERVISOR_MODULOS_PROHIBIDOS.includes(modulo)
  return user?.permisos_custom?.[modulo] === 'supervisa'
}
