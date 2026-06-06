// Compras · CO4 — lógica pura de devolución a proveedor. Sin I/O.

export type FormaDevolucion = 'credito_cc' | 'efectivo' | 'reposicion'

export const MOTIVOS_DEVOLUCION_PROVEEDOR = [
  'Producto roto / dañado',
  'Falla de fábrica',
  'Producto incorrecto',
  'Vencido / próximo a vencer',
  'Otro',
] as const

export interface DevolucionItemCalc {
  cantidad: number
  costo_unitario: number
}

/** Monto total de la devolución = Σ cantidad × costo unitario. Redondea a 2 decimales. */
export function montoDevolucion(items: DevolucionItemCalc[]): number {
  const total = items.reduce((s, it) => s + Math.max(0, it.cantidad) * Math.max(0, it.costo_unitario), 0)
  return Math.round(total * 100) / 100
}

export interface ValidacionDevolucion {
  ok: boolean
  error?: string
}

/**
 * Valida una devolución a proveedor antes de confirmarla.
 * - Debe tener proveedor, motivo y al menos un ítem con cantidad > 0.
 * - Ninguna cantidad puede superar el stock disponible de ese producto en la sucursal.
 */
export function validarDevolucion(args: {
  proveedorId: string | null | undefined
  motivo: string | null | undefined
  forma: FormaDevolucion | null | undefined
  items: { producto_id: string; cantidad: number; stockDisponible: number; nombre?: string }[]
}): ValidacionDevolucion {
  if (!args.proveedorId) return { ok: false, error: 'Seleccioná el proveedor' }
  if (!args.motivo) return { ok: false, error: 'Indicá el motivo de la devolución' }
  if (!args.forma) return { ok: false, error: 'Elegí la forma del reembolso' }
  const conCantidad = args.items.filter(it => it.cantidad > 0)
  if (conCantidad.length === 0) return { ok: false, error: 'Indicá la cantidad a devolver de al menos un producto' }
  for (const it of conCantidad) {
    if (it.cantidad > it.stockDisponible + 0.001) {
      return { ok: false, error: `No hay stock suficiente de "${it.nombre ?? it.producto_id}" para devolver (disponible ${it.stockDisponible})` }
    }
  }
  return { ok: true }
}
