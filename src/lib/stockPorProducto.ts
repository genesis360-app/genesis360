// Stock por producto a partir de las líneas de inventario YA filtradas por sucursal (o de todas, con "Todas").
// Pedido de GO 2026-10-08: Productos e Inventario siguen el selector de sucursal del encabezado. En Productos la fila
// mostraba "disponible" de la sucursal pero "total" de TODAS (`productos.stock_actual`): dos stocks distintos en la fila.

export interface LineaStock {
  producto_id: string
  cantidad: number | string | null
  cantidad_reservada?: number | string | null
  estado_id?: string | null
  inventario_series?: { activo?: boolean | null }[] | null
}

export interface StockPorProducto {
  /** Vendible: estados con `es_disponible_venta` (en básico, todo) menos lo reservado. */
  disponible: Record<string, number>
  /** Todo lo que hay en la(s) sucursal(es) de las líneas, en cualquier estado y reservado incluido. */
  total: Record<string, number>
}

/**
 * @param estadosVendibles ids de estados vendibles; `null` = modo básico (el stock no tiene estado: todo es vendible).
 * Productos con series cuentan series activas (no `cantidad`). El numeric de Postgres puede llegar como string.
 */
export function stockPorProducto(lineas: LineaStock[], estadosVendibles: Set<string> | null): StockPorProducto {
  const disponible: Record<string, number> = {}
  const total: Record<string, number> = {}
  for (const l of lineas) {
    const pid = l.producto_id
    const series = l.inventario_series ?? []
    const conSeries = series.length > 0
    const cant = conSeries ? series.filter(s => s.activo).length : Math.max(0, Number(l.cantidad) || 0)
    total[pid] = (total[pid] ?? 0) + cant
    const vendible = estadosVendibles === null || (!!l.estado_id && estadosVendibles.has(l.estado_id))
    if (!vendible) continue
    const disp = conSeries ? cant : Math.max(0, cant - (Number(l.cantidad_reservada) || 0))
    disponible[pid] = (disponible[pid] ?? 0) + disp
  }
  return { disponible, total }
}
