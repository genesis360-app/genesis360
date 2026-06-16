// ─── Permisos de rol custom por módulo ───────────────────────────────────────
// Los roles custom (tabla roles_custom) mapean cada módulo a 'no_ver'|'ver'|'editar'.
// Hasta v1.56 esto solo se aplicaba en el nav ('no_ver' ocultaba). Acá agregamos
// el enforcement de SOLO-LECTURA ('ver') en las mutaciones: un rol custom marcado
// "ver" en un módulo no debe poder crear/editar/eliminar en él.
//
// Aplica solo a usuarios con rol custom (permisos_custom presente). Para los roles
// fijos (DUEÑO/CAJERO/etc.) `permisos_custom` es null y estos helpers no bloquean
// nada — esos roles siguen gobernados por su lógica de página habitual.

type ConPermisos = { rol?: string | null; permisos_custom?: Record<string, 'no_ver' | 'ver' | 'editar'> | null } | null | undefined

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

/** Puede editar/mutar el módulo: no es LECTOR, ni está en solo-lectura/oculto por rol custom. */
export function puedeEditarModulo(user: ConPermisos, modulo: string): boolean {
  if (esLector(user)) return false
  const p = user?.permisos_custom?.[modulo]
  return p !== 'ver' && p !== 'no_ver'
}
