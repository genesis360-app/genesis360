// Traslados de stock entre sucursales — lógica pura (auditoría de procesos 2026-06-11, ítem #4)
// Decisiones relevadas con GO: tránsito + confirmación · detalle por LPN/línea ·
// DEPOSITO+ crea/despacha · el destino confirma · recepción parcial con faltante auditado.

import type { RolUsuario } from '@/lib/cajaPermisos'

/** Roles que pueden crear/despachar/cancelar un traslado (origen). */
const ROLES_CREAR: RolUsuario[] = ['DUEÑO', 'ADMIN', 'SUPER_USUARIO', 'SUPERVISOR', 'DEPOSITO']

export function puedeCrearTraslado(rol: RolUsuario | null | undefined): boolean {
  if (!rol) return false
  return ROLES_CREAR.includes(rol)
}

/**
 * ¿El usuario puede confirmar la recepción de un traslado?
 * Regla: cualquier usuario con acceso a Inventario parado en (o asignado a) la sucursal
 * DESTINO. Quien puede ver todas las sucursales (DUEÑO/habilitados) confirma desde cualquiera.
 * El que despachó desde el origen NO confirma salvo que también opere el destino.
 */
export function puedeConfirmarRecepcion(args: {
  rol: RolUsuario | null | undefined
  sucursalActivaId: string | null | undefined   // sucursal en la que está parado el usuario
  puedeVerTodas: boolean
  sucursalDestinoId: string
}): boolean {
  const { rol, sucursalActivaId, puedeVerTodas, sucursalDestinoId } = args
  if (!rol) return false
  if (!ROLES_CREAR.includes(rol)) return false           // mismos roles que operan inventario
  if (puedeVerTodas) return true
  return sucursalActivaId === sucursalDestinoId
}

/** Disponible para trasladar de una línea = cantidad física menos lo reservado para ventas. */
export function disponibleLinea(cantidad: number, cantidadReservada?: number | null): number {
  return Math.max(0, (cantidad ?? 0) - (cantidadReservada ?? 0))
}

/**
 * Valida la cantidad a trasladar de una línea.
 * Devuelve null si es válida, o el mensaje de error.
 */
export function validarCantidadTraslado(args: {
  cantidad: number
  disponible: number
  esDecimal?: boolean
}): string | null {
  const { cantidad, disponible, esDecimal } = args
  if (!Number.isFinite(cantidad) || cantidad <= 0) return 'Ingresá una cantidad válida'
  if (!esDecimal && !Number.isInteger(cantidad)) return 'Este producto se mueve en unidades enteras'
  if (cantidad > disponible) return `Solo hay ${disponible} disponible (descontando reservas)`
  return null
}

export interface ItemRecepcion {
  cantidad: number              // lo despachado
  cantidad_recibida: number     // lo confirmado por el destino
}

/**
 * Valida las cantidades recibidas (0 ≤ recibida ≤ despachada por ítem).
 * Devuelve null si todo es válido, o el mensaje de error.
 */
export function validarRecepcion(items: ItemRecepcion[]): string | null {
  if (!items.length) return 'El traslado no tiene ítems'
  for (const it of items) {
    if (!Number.isFinite(it.cantidad_recibida) || it.cantidad_recibida < 0) return 'Cantidad recibida inválida'
    if (it.cantidad_recibida > it.cantidad) return 'No se puede recibir más de lo despachado'
  }
  return null
}

/** Estado final del traslado según lo recibido: completo → recibido, con faltantes → recibido_parcial. */
export function estadoDesdeRecepcion(items: ItemRecepcion[]): 'recibido' | 'recibido_parcial' {
  const hayFaltante = items.some(it => it.cantidad_recibida < it.cantidad)
  return hayFaltante ? 'recibido_parcial' : 'recibido'
}

/** Total faltante de un traslado (suma de despachado − recibido). */
export function totalFaltante(items: ItemRecepcion[]): number {
  return items.reduce((acc, it) => acc + Math.max(0, it.cantidad - it.cantidad_recibida), 0)
}

/**
 * ¿El movimiento parcial de un LPN (LpnAccionesModal → tab "Mover") cruza de sucursal?
 * Si es cross-sucursal, NO se reubica directo: hay que despachar un traslado real
 * (en_transito) para que el destino confirme la recepción — reubicar directo haría
 * aparecer stock en la otra sucursal sin que nadie confirmó que llegó físicamente.
 *
 * `null`/`undefined` en cualquiera de los dos lados (sin sucursal asignada) NUNCA es
 * cross-sucursal: no hay una sucursal física de origen (o destino) contra la cual
 * generar un traslado real — en ese caso es una reasignación administrativa directa.
 */
export function esMovimientoCrossSucursal(
  sucursalDestino: string | null | undefined,
  sucursalOrigen: string | null | undefined,
): boolean {
  return !!sucursalDestino && !!sucursalOrigen && sucursalDestino !== sucursalOrigen
}
