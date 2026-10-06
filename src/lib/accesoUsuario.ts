/**
 * Acceso de un usuario del negocio: rol, dónde trabaja (todas las sucursales o una) y rol personalizado.
 *
 * Antes cada fila de Usuarios tenía 4-5 controles sueltos que GUARDABAN AL TOCARLOS (un selector de rol cambiado sin
 * querer = un empleado con otros permisos, sin confirmación). Desde 2026-10-06 se edita en un panel con borrador y
 * "Guardar cambios"; esta es la lógica de ese borrador, testeada (tests/unit/accesoUsuario.test.ts).
 */

/** Ven todo el negocio siempre: no tienen "dónde trabaja". */
export const ROLES_SIEMPRE_GLOBALES = ['DUEÑO', 'SUPER_USUARIO']
/** Arrancan viendo todas las sucursales (se puede restringir): el Lector supervisa todo. */
export const ROLES_GLOBAL_DEFAULT = ['SUPERVISOR', 'CONTADOR', 'VIEWER']

export interface AccesoUsuario {
  rol: string
  puede_ver_todas: boolean
  sucursal_id: string | null
  rol_custom_id: string | null
}

export const esSiempreGlobal = (rol: string) => ROLES_SIEMPRE_GLOBALES.includes(rol)
export const veTodasPorDefecto = (rol: string) => esSiempreGlobal(rol) || ROLES_GLOBAL_DEFAULT.includes(rol)

/** Lo que se ve en la fila: "Todas las sucursales", el nombre de la suya o "Sin sucursal asignada". */
export function textoAlcance(a: Pick<AccesoUsuario, 'rol' | 'puede_ver_todas' | 'sucursal_id'>, nombreSucursal?: (id: string) => string | undefined): string {
  if (esSiempreGlobal(a.rol) || a.puede_ver_todas) return 'Todas las sucursales'
  if (!a.sucursal_id) return 'Sin sucursal asignada'
  return nombreSucursal?.(a.sucursal_id) ?? 'Una sucursal'
}

/**
 * Cambiar el rol en el borrador: el rol personalizado se suelta (era de otro rol) y el alcance vuelve al de ese rol —
 * mismo criterio que tenía el selector de la fila, pero ahora se VE antes de guardar y se puede corregir.
 */
export function cambiarRol(d: AccesoUsuario, rol: string): AccesoUsuario {
  if (rol === d.rol) return d
  return { ...d, rol, rol_custom_id: null, puede_ver_todas: veTodasPorDefecto(rol) }
}

/** null = se puede guardar. */
export function validarAcceso(d: AccesoUsuario, haySucursales: boolean): string | null {
  if (!esSiempreGlobal(d.rol) && !d.puede_ver_todas && haySucursales && !d.sucursal_id) return 'Elegí en qué sucursal trabaja'
  return null
}

/** Solo lo que cambió (normalizado). null = no hay nada que guardar. */
export function parcheAcceso(original: AccesoUsuario, d: AccesoUsuario): Partial<AccesoUsuario> | null {
  const final: AccesoUsuario = esSiempreGlobal(d.rol) ? { ...d, puede_ver_todas: true } : d
  const parche: Partial<AccesoUsuario> = {}
  for (const k of ['rol', 'puede_ver_todas', 'sucursal_id', 'rol_custom_id'] as const) {
    if ((final[k] ?? null) !== (original[k] ?? null)) (parche as Record<string, unknown>)[k] = final[k]
  }
  return Object.keys(parche).length ? parche : null
}
