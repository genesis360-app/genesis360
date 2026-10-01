// Stock de un producto en una sucursal, para el "stock antes / después" de los movimientos.
//
// 🛑 REGLA #0 (hallazgo 2026-10-01): para un producto con SERIES la línea de inventario se guarda con cantidad 0 y el
// stock real son las series activas (igual que `recalcular_stock` en la base). Sumar `inventario_lineas.cantidad`
// daba siempre 0 y el movimiento quedaba con "stock antes" = 0 aunque hubiera stock (1 ingreso en PROD). Solo el
// historial; el stock del producto siempre estuvo bien. No se reescriben los movimientos viejos.

// deno-lint-ignore no-explicit-any
type Cliente = any

/**
 * `sucursalId` null → stock global del producto (`productos.stock_actual`, que ya cuenta series).
 * Con sucursal: series activas en líneas activas de la sucursal, o suma de cantidades de las líneas activas.
 */
export async function stockEnSucursal(
  supabase: Cliente,
  tenantId: string,
  productoId: string,
  sucursalId: string | null,
): Promise<number> {
  const { data: prod, error: errProd } = await supabase.from('productos')
    .select('stock_actual, tiene_series').eq('id', productoId).single()
  if (errProd) throw new Error(`No se pudo leer el stock del producto: ${errProd.message}`)
  if (!sucursalId) return Number(prod?.stock_actual) || 0

  if (prod?.tiene_series) {
    const { count, error } = await supabase.from('inventario_series')
      .select('id, inventario_lineas!inner(sucursal_id, activo)', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('producto_id', productoId).eq('activo', true)
      .eq('inventario_lineas.sucursal_id', sucursalId).eq('inventario_lineas.activo', true)
    if (error) throw new Error(`No se pudo leer el stock del producto: ${error.message}`)
    return count ?? 0
  }

  const { data, error } = await supabase.from('inventario_lineas')
    .select('cantidad')
    .eq('tenant_id', tenantId).eq('producto_id', productoId).eq('sucursal_id', sucursalId).eq('activo', true)
  if (error) throw new Error(`No se pudo leer el stock del producto: ${error.message}`)
  return (data ?? []).reduce((s: number, l: { cantidad: unknown }) => s + (Number(l.cantidad) || 0), 0)
}
