/**
 * Motor de Rotación, Opción 3 (E2/E4) — sugerencia de nombre y precio de un KIT a partir de su
 * receta de componentes. Lógica pura de DISPLAY (no se aplica sola): la UI de Inventario → Kits
 * ofrece la sugerencia con un botón explícito para aplicarla, nunca la escribe en `productos` sin
 * que alguien la confirme.
 *
 * E4 (corregido por Fede): el precio = precio normal × cantidad de cada componente, SIN restar
 * ningún descuento — el % de descuento por estado lo aplica el mismo mecanismo que ya existe para
 * cualquier producto en ese estado, en el momento de la venta. Restarlo acá sería descontarlo dos
 * veces.
 */

export interface ComponenteKitParaSugerencia {
  nombre: string
  precio_venta: number | null | undefined
  cantidad: number
}

/** Nombre sugerido: "Kit " + los componentes, con la cantidad solo cuando es > 1. */
export function sugerirNombreKit(componentes: ComponenteKitParaSugerencia[]): string {
  if (componentes.length === 0) return ''
  const partes = componentes.map(c => (c.cantidad > 1 ? `${c.cantidad}× ${c.nombre}` : c.nombre))
  return `Kit ${partes.join(' + ')}`
}

/**
 * Precio sugerido: suma de precio_venta × cantidad de cada componente. `Number.isFinite` porque
 * el `numeric` de Postgres puede llegar como string (gotcha de REGLA #0) y un componente sin
 * precio cargado (`null`) no debe ensuciar la suma con `NaN`.
 */
export function sugerirPrecioKit(componentes: ComponenteKitParaSugerencia[]): number {
  return componentes.reduce((sum, c) => {
    const precio = typeof c.precio_venta === 'string' ? parseFloat(c.precio_venta) : c.precio_venta
    return sum + (Number.isFinite(precio) ? (precio as number) * c.cantidad : 0)
  }, 0)
}
