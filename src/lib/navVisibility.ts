// ─── Visibilidad del menú lateral (lógica pura, testeable) ───────────────────
// Extraído del filtro inline de AppLayout para poder auditarlo con tests
// (matriz rol × modo). Preserva la semántica histórica + las reglas del modo
// de operación Básico/Avanzado.

export type RolUsuario =
  | 'DUEÑO' | 'SUPER_USUARIO' | 'ADMIN' | 'SUPERVISOR'
  | 'CAJERO' | 'CONTADOR' | 'DEPOSITO' | 'RRHH'
  | string | null | undefined

export type PermisoModulo = 'no_ver' | 'ver' | 'editar'

export interface NavItemFlags {
  modulo: string
  ownerOnly?: boolean
  supervisorOnly?: boolean
  planFeature?: string
  rrhhVisible?: boolean
  cajeroVisible?: boolean
  contadorVisible?: boolean
  depositoVisible?: boolean
  portalEmpleado?: boolean
  avanzadoOnly?: boolean
  /** En modo básico solo se muestra si el tenant tiene facturación habilitada. */
  basicoSiFacturacion?: boolean
  /** En modo básico solo se muestra si el tenant tiene más de una sucursal. */
  basicoSiMultisucursal?: boolean
}

export interface NavVisibilityCtx {
  rol: RolUsuario
  permisosCustom?: Record<string, PermisoModulo> | null
  modoAvanzado: boolean
  rrhhPortalEmpleado?: boolean
  facturacionHabilitada?: boolean
  sucursalesCount?: number
}

/**
 * ¿Se renderiza este item del nav? (no contempla `locked` por plan: los items
 * plan-gated igual se muestran en gris — eso lo decide `navItemLocked`).
 */
export function navItemVisible(item: NavItemFlags, ctx: NavVisibilityCtx): boolean {
  const rol = ctx.rol

  // Modo de operación
  if (item.avanzadoOnly && !ctx.modoAvanzado) return false
  if (!ctx.modoAvanzado) {
    if (item.basicoSiFacturacion && !ctx.facturacionHabilitada) return false
    if (item.basicoSiMultisucursal && (ctx.sucursalesCount ?? 0) <= 1) return false
  }

  // Portal del empleado
  if (item.portalEmpleado && !ctx.rrhhPortalEmpleado) return false

  // Roles operativos: solo ven items marcados explícitamente para ellos
  if (rol === 'RRHH' && !item.rrhhVisible) return false
  if (rol === 'CAJERO' && !item.cajeroVisible) return false
  if (rol === 'CONTADOR' && !item.contadorVisible) return false
  if (rol === 'DEPOSITO' && !item.depositoVisible) return false

  // El permiso explícito por rol (depositoVisible/contadorVisible/cajeroVisible/
  // rrhhVisible) es un ALLOWLIST que prevalece sobre los gates de admin: si no,
  // `supervisorOnly` ocultaría Recepciones a DEPOSITO e Historial a CONTADOR pese
  // a estar habilitados para esos roles (y a estar en sus rutas permitidas).
  const grantedByRole =
    (rol === 'CAJERO' && item.cajeroVisible) ||
    (rol === 'CONTADOR' && item.contadorVisible) ||
    (rol === 'DEPOSITO' && item.depositoVisible) ||
    (rol === 'RRHH' && item.rrhhVisible)

  if (!grantedByRole) {
    if (item.ownerOnly && rol !== 'DUEÑO' && rol !== 'SUPER_USUARIO' && rol !== 'RRHH') return false
    if (item.supervisorOnly && rol !== 'DUEÑO' && rol !== 'SUPERVISOR' && rol !== 'SUPER_USUARIO') return false
  }

  // Rol custom: 'no_ver' oculta el módulo
  if (ctx.permisosCustom?.[item.modulo] === 'no_ver') return false

  return true
}

/** ¿El item se muestra en gris (plan no lo incluye)? Solo aplica si ya es visible. */
export function navItemLocked(
  item: NavItemFlags,
  limits: Record<string, any> | null | undefined,
): boolean {
  return !!item.planFeature && limits != null && !limits[item.planFeature]
}
