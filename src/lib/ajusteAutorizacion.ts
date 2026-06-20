// Autorización de ajustes de inventario POR ROL (configurable por tenant).
// Lógica pura, sin I/O. Se combina con el gate por umbral de conteos (conteoAjuste.ts).
//
// Modos por rol:
//   'directo'  → ajusta sin autorización (aplica al toque).
//   'umbral'   → delega en el gate por umbral (chico aplica, grande aprueba).
//   'siempre'  → toda diferencia/ajuste requiere aprobación.
//
// Default (rol ausente en la config): DUEÑO = 'directo', cualquier otro rol = 'siempre'.

export type ModoAjuste = 'directo' | 'umbral' | 'siempre'
export type AjusteAutorizacionConfig = Record<string, ModoAjuste> | null | undefined

/** Modo de autorización de ajustes para un rol, con el default del negocio. */
export function modoAjusteRol(rol: string | null | undefined, config: AjusteAutorizacionConfig): ModoAjuste {
  const r = rol ?? ''
  const fromCfg = config && r ? config[r] : undefined
  if (fromCfg === 'directo' || fromCfg === 'umbral' || fromCfg === 'siempre') return fromCfg
  return r === 'DUEÑO' ? 'directo' : 'siempre'
}

/**
 * ¿El ajuste de este rol requiere autorización?
 * - 'directo' → false (aplica al toque, ignora el umbral).
 * - 'siempre' → true (siempre a aprobación).
 * - 'umbral'  → lo que diga el gate por umbral (`umbralRequiere`, calculado por el caller
 *               con `requiereAutorizacion` de conteoAjuste.ts). Para ajustes directos sin
 *               umbral configurado, el caller pasa false → aplica directo.
 */
export function requiereAuthAjuste(
  rol: string | null | undefined,
  config: AjusteAutorizacionConfig,
  umbralRequiere: boolean,
): boolean {
  const modo = modoAjusteRol(rol, config)
  if (modo === 'directo') return false
  if (modo === 'siempre') return true
  return umbralRequiere
}
