// C-3 de Precio programado (GO, 2026-09-25): "cambio inmediato sobre un producto con un precio programado
// pendiente → la app avisa y pregunta; por defecto, CANCELAR el programado".
//
// Sin esto el programado queda en pie y, a su hora, pisa en silencio el precio que alguien acaba de poner a mano.
// Aplica a TODOS los caminos que cambian `precio_venta` "ahora" desde la app (ficha, aprobación en Supervisión,
// edición masiva, precio sugerido de kit, importador). El repricing automático del servidor no pregunta: no hay
// nadie a quién preguntarle.

export interface ProgramadoPendiente {
  id: string
  producto_id: string
  precio_venta: number | string
  vigente_desde: string
}

export type DecisionProgramado = 'cancelar' | 'mantener'

/** Para `.in('producto_id', …)`: en tandas, así una edición masiva de miles de productos no arma una URL gigante. */
export function enTandas<T>(items: T[], tamano = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += tamano) out.push(items.slice(i, i + tamano))
  return out
}

/** El texto del aviso. `nombres` mapea producto_id → nombre (si se tiene); con uno solo se nombra el producto. */
export function mensajeConflicto(
  pendientes: ProgramadoPendiente[],
  formatearPrecio: (n: number) => string,
  formatearFecha: (iso: string) => string,
  nombres: Record<string, string> = {},
): string {
  if (pendientes.length === 1) {
    const p = pendientes[0]
    const quien = nombres[p.producto_id] ? `"${nombres[p.producto_id]}" tiene` : 'Este producto tiene'
    return `${quien} un cambio de precio programado a ${formatearPrecio(Number(p.precio_venta))} para el ${formatearFecha(p.vigente_desde)}.\n\n` +
      'Si lo mantenés, a esa hora va a reemplazar el precio que estás guardando ahora.'
  }
  return `${pendientes.length} de estos productos tienen un cambio de precio programado.\n\n` +
    'Si los mantenés, a su hora van a reemplazar los precios que estás guardando ahora.'
}
