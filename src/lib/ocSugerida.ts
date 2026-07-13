// Lógica pura de la "OC sugerida" (auto-draft de órdenes de compra desde stock bajo mínimo).
// Extraída de AlertasPage.generarOCsSugeridas para poder testearla. La I/O (leer las
// alertas + proveedor_productos, insertar las OC) queda en AlertasPage; acá solo el armado.
//
// ⚠ ESTA FUNCIÓN REPLICA EL COMPORTAMIENTO ACTUAL TAL CUAL (con sus bugs conocidos) — es un
// refactor de extracción SIN cambio de conducta. Los bugs están documentados abajo y en
// tests/specs/oc-sugerida.plan.md; se corrigen en una tanda aparte (GO: revisar tras cerrar
// facturación, 2026-07-12).
//
// 🐛 BUGS CONOCIDOS (a corregir):
//  1. NO consolida por producto: genera UNA línea POR ALERTA → si hay varias alertas del
//     mismo SKU (p.ej. una por sucursal), la OC sale con líneas DUPLICADAS del mismo producto
//     (caso reportado por GO 2026-07-12: OC con varias líneas de 2 unidades del mismo SKU en
//     vez de una sola línea con la cantidad total del maestro).
//  2. `faltante` usa el stock GLOBAL del producto (stock_actual/stock_minimo del maestro), no
//     el stock POR SUCURSAL que la alerta usa para dispararse → cantidad puede quedar mal.
//  3. Elige un proveedor ARBITRARIO (el primer proveedor_producto que matchea) si el producto
//     tiene varios → no determinístico / puede no ser el preferido.
//  4. Sin dedup contra OC abiertas existentes: regenerar duplica OC del mismo proveedor/producto.
//  5. `precio` = precio_compra ?? null → si el proveedor_producto no tiene precio, la línea
//     queda sin precio (OC con total incompleto).

export interface AlertaLowStock {
  /** producto_id */
  id: string
  nombre: string
  stock_actual: number | string | null
  stock_minimo: number | string | null
}

export interface ProveedorProductoLite {
  proveedor_id: string
  producto_id: string
  precio_compra: number | string | null
  cantidad_minima: number | string | null
}

export interface OCItemSugerido {
  producto_id: string
  cantidad: number
  precio: number | null
}

export interface OCSugerida {
  proveedor_id: string
  items: OCItemSugerido[]
}

export interface ResultadoOCsSugeridas {
  ocs: OCSugerida[]
  /** Nombres de productos bajo mínimo sin proveedor asociado (no entran a ninguna OC). */
  sinProveedor: string[]
}

/**
 * Arma las OC sugeridas agrupando por proveedor los productos bajo mínimo.
 * Fiel al comportamiento actual (ver bugs conocidos en el header del archivo).
 */
export function armarOCsSugeridas(
  lowStock: AlertaLowStock[],
  pps: ProveedorProductoLite[],
): ResultadoOCsSugeridas {
  const porProveedor = new Map<string, OCItemSugerido[]>()
  const sinProveedor: string[] = []

  for (const p of lowStock) {
    const faltante = Math.max((Number(p.stock_minimo) || 0) - (Number(p.stock_actual) || 0), 0)
    const pp = pps.find(x => x.producto_id === p.id)
    if (!pp) { sinProveedor.push(p.nombre); continue }
    const cantidad = Math.max(faltante, Number(pp.cantidad_minima) || 0, 1)
    const precio = pp.precio_compra == null ? null : Number(pp.precio_compra)
    if (!porProveedor.has(pp.proveedor_id)) porProveedor.set(pp.proveedor_id, [])
    porProveedor.get(pp.proveedor_id)!.push({ producto_id: p.id, cantidad, precio })
  }

  return {
    ocs: [...porProveedor.entries()].map(([proveedor_id, items]) => ({ proveedor_id, items })),
    sinProveedor,
  }
}
