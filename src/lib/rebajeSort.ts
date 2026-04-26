/**
 * Helper para ordenar líneas de inventario según la regla de selección activa.
 *
 * Jerarquía: regla del SKU > regla del negocio > FIFO (fallback)
 *
 * Reglas:
 *   FIFO   → ubicación.prioridad ASC, luego created_at ASC  (default)
 *   LIFO   → ubicación.prioridad ASC, luego created_at DESC
 *   FEFO   → fecha_vencimiento ASC  (ignora prioridad de ubicación)
 *   LEFO   → fecha_vencimiento DESC (ignora prioridad de ubicación)
 *   Manual → ubicación.prioridad ASC únicamente
 *
 * FEFO/LEFO requieren tiene_vencimiento = true en el producto.
 * Si no tiene vencimiento, hace fallback a FIFO.
 * LPNs sin ubicación se tratan como prioridad 999 (van al final).
 */

export type ReglaInventario = 'FIFO' | 'LIFO' | 'FEFO' | 'LEFO' | 'Manual'

export const REGLAS_INVENTARIO: { value: ReglaInventario; label: string; desc: string }[] = [
  { value: 'FIFO', label: 'FIFO', desc: 'Primero en entrar, primero en salir (por fecha de ingreso)' },
  { value: 'FEFO', label: 'FEFO', desc: 'Primero en vencer, primero en salir (requiere fecha de vencimiento)' },
  { value: 'LEFO', label: 'LEFO', desc: 'Último en vencer, primero en salir (requiere fecha de vencimiento)' },
  { value: 'LIFO', label: 'LIFO', desc: 'Último en entrar, primero en salir (por fecha de ingreso)' },
  { value: 'Manual', label: 'Manual', desc: 'Según la prioridad asignada a cada ubicación' },
]

/**
 * Retorna la función comparadora para ordenar líneas de inventario.
 * @param reglaProducto  - regla_inventario del producto (null = no tiene override)
 * @param reglaTenant    - regla_inventario del negocio
 * @param tieneVencimiento - si el producto tiene fecha_vencimiento activo
 */
export function getRebajeSort(
  reglaProducto: string | null | undefined,
  reglaTenant: string | null | undefined,
  tieneVencimiento: boolean
): (a: any, b: any) => number {
  const regla = (reglaProducto || reglaTenant || 'FIFO') as ReglaInventario

  // FEFO / LEFO: ordenar por fecha de vencimiento
  // Si el producto no tiene vencimiento → fallback a FIFO
  if (regla === 'FEFO' || regla === 'LEFO') {
    if (tieneVencimiento) {
      const dir = regla === 'FEFO' ? 1 : -1
      return (a, b) => {
        const da = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity
        const db = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity
        return (da - db) * dir
      }
    }
    // Fallback a FIFO si no tiene vencimiento
  }

  const porPrioridad = (a: any, b: any) =>
    (a.ubicaciones?.prioridad ?? 999) - (b.ubicaciones?.prioridad ?? 999)

  if (regla === 'Manual') {
    // Si prioridades iguales → FIFO como desempate
    return (a, b) => {
      const p = porPrioridad(a, b)
      if (p !== 0) return p
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }
  }

  if (regla === 'LIFO') {
    return (a, b) => {
      const p = porPrioridad(a, b)
      if (p !== 0) return p
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }
  }

  // FIFO (default)
  return (a, b) => {
    const p = porPrioridad(a, b)
    if (p !== 0) return p
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  }
}
