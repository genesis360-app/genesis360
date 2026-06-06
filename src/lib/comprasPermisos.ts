// Compras · CO1 — lógica pura de permisos y gobierno de OC. Sin I/O.
// Decisiones de: quién crea/envía/aprueba OC, aprobación por umbral, y permisos de pago.

export type RolUsuario = string  // 'DUEÑO' | 'ADMIN' | 'SUPERVISOR' | 'CAJERO' | 'DEPOSITO' | 'CONTADOR' | 'SUPER_USUARIO'

const ROLES_GESTION = ['DUEÑO', 'ADMIN', 'SUPERVISOR', 'SUPER_USUARIO']

/** A1 — capacidad de creación de OC según rol. */
export type CapacidadCrearOC = 'completa' | 'borrador' | 'ninguna'
export function capacidadCrearOC(rol: RolUsuario | null | undefined): CapacidadCrearOC {
  if (!rol) return 'ninguna'
  if (ROLES_GESTION.includes(rol)) return 'completa'   // crea y envía
  if (rol === 'DEPOSITO') return 'borrador'            // solo borradores, otro confirma
  return 'ninguna'                                      // CAJERO / CONTADOR
}

/** A2 — ¿esta OC requiere aprobación antes de enviarse? (gate activo + supera umbral). */
export function ocRequiereAprobacion(
  montoTotal: number,
  cfg: { activa?: boolean | null; umbral?: number | null },
): boolean {
  if (!cfg.activa) return false
  if (cfg.umbral == null || cfg.umbral <= 0) return true  // activa sin umbral → todo requiere aprobación
  return montoTotal >= cfg.umbral
}

/** A2 — quién puede aprobar una OC que quedó pendiente de aprobación. */
export function puedeAprobarOC(rol: RolUsuario | null | undefined): boolean {
  return !!rol && ROLES_GESTION.includes(rol)
}

/**
 * A2 — ¿puede este usuario enviar la OC al proveedor (pasar a 'enviada')?
 * Si requiere aprobación y aún no está aprobada → solo un rol aprobador (que aprueba al enviar).
 * Si no requiere aprobación (o ya está aprobada) → cualquiera con capacidad de creación completa.
 */
export function puedeEnviarOC(
  rol: RolUsuario | null | undefined,
  oc: { requiere_aprobacion?: boolean | null; aprobada_por?: string | null },
): boolean {
  if (oc.requiere_aprobacion && !oc.aprobada_por) return puedeAprobarOC(rol)
  return capacidadCrearOC(rol) === 'completa'
}

/** D5 — registrar pago de OC: cualquier rol con acceso EXCEPTO CONTADOR (read-only). */
export function puedeRegistrarPagoOC(rol: RolUsuario | null | undefined): boolean {
  if (!rol) return false
  return rol !== 'CONTADOR'
}

/** D5 — ¿el pago de OC requiere doble firma (registra → autoriza) por superar umbral? */
export function requiereDobleFirmaPago(
  monto: number,
  cfg: { umbral?: number | null },
): boolean {
  return cfg.umbral != null && cfg.umbral > 0 && monto >= cfg.umbral
}
