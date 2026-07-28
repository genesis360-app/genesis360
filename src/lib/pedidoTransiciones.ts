// Autorización de transiciones del módulo Pedidos POR ROL — E3 del relevamiento
// (`tenants.pedido_transiciones_roles`, mig 292). Lógica pura, sin I/O — mismo patrón que
// ajusteAutorizacion.ts/cajaPermisos.ts.
//
// Shape de la config: Record<transición, roles[]>. Transición AUSENTE en la config (o config
// NULL/undefined) → default: DUEÑO/SUPERVISOR/SUPER_USUARIO/DEPOSITO pueden (relevamiento E3:
// "DEPOSITO puede hacer todas las transiciones"). Transición PRESENTE (incluso como array vacío)
// → allow-list estricta, ese es el resultado, sin fallback a default (permite bloquear
// deliberadamente una transición para todos salvo ADMIN).
//
// ADMIN (staff cross-tenant, ver reference_rol_admin_staff_aislamiento) siempre puede, por fuera
// de la config editable por tenant — mismo criterio que `is_admin()` a nivel DB: un tenant no
// puede bloquear al staff de soporte.

export type PedidoTransicion = 'confirmar' | 'lanzar' | 'entregar' | 'cancelar' | 'deslanzar'

export type PedidoTransicionesConfig = Partial<Record<PedidoTransicion, string[]>> | null | undefined

export const PEDIDO_TRANSICIONES: { key: PedidoTransicion; label: string }[] = [
  { key: 'confirmar', label: 'Confirmar (borrador → confirmado)' },
  { key: 'lanzar', label: 'Lanzar (genera picking/reservas)' },
  { key: 'entregar', label: 'Entregar (genera la venta real)' },
  { key: 'cancelar', label: 'Cancelar' },
  { key: 'deslanzar', label: 'Deshacer lanzamiento' },
]

export const PEDIDO_ROLES_CONFIGURABLES = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'CAJERO', 'DEPOSITO'] as const

export const PEDIDO_TRANSICION_ROLES_DEFAULT: string[] = ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'DEPOSITO']
const ROLES_DEFAULT = PEDIDO_TRANSICION_ROLES_DEFAULT

/** ¿Este rol puede ejecutar esta transición de Pedidos? */
export function puedeTransicionPedido(
  rol: string | null | undefined,
  transicion: PedidoTransicion,
  config: PedidoTransicionesConfig,
): boolean {
  if (!rol) return false
  if (rol === 'ADMIN') return true
  const roles = config ? config[transicion] : undefined
  if (roles === undefined) return ROLES_DEFAULT.includes(rol)
  return roles.includes(rol)
}
