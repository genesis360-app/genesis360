// ── Descuento automático por estado de inventario (backlog Fede, punto 3) ───────────────
// Un estado de inventario (Config→Inventario→Estados, ej. "Próximo a Vencer") puede tener un
// % de descuento propio (estados_inventario.descuento_pct, mig 284). Si el stock que se va a
// consumir para una línea del carrito está en ese estado, se descuenta esa porción
// automáticamente — sin clave de supervisor (el estado ya lo configuró a propósito un
// DUEÑO/ADMIN de antemano) y se apila con cualquier otro descuento de la venta (general,
// combo, por método de pago).
//
// REGLA #0 — decisiones de integridad:
//  · El descuento se calcula sobre la MISMA previsualización de LPNs que ya usa el carrito
//    para planificar el rebaje (calcularLpnFuentes), nunca se recalcula después del despacho
//    — así lo que se cobra siempre coincide con lo que después se factura.
//  · Es un monto por LÍNEA (no un descuento global prorrateado entre todos los ítems): solo
//    reduce el precio de las unidades que realmente vienen de un estado con descuento, nunca
//    "contamina" el precio de otro producto de la misma venta.
//  · Es independiente de `item.descuento`/`descuento_tipo` (reservado para descuento manual y
//    combos) — se resta aparte en getItemSubtotal, así nunca colisiona con la lógica de
//    agrupamiento de combos por producto+UoM.

export interface FuenteConDescuentoEstado {
  cantidad: number
  estado_nombre?: string | null
  estado_descuento_pct?: number | null
}

export interface DescuentoEstadoDetalle {
  estado_nombre: string
  pct: number
  cantidad: number
  monto: number
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100 }

/**
 * Monto total a descontar para una línea del carrito, dado su precio unitario (antes de este
 * descuento) y las fuentes de stock que la cubren (ya ordenadas/previstas por rebajeSort).
 * Prorratea por fuente: cada unidad descuenta según el % del estado de SU fuente concreta,
 * nunca un promedio inventado. Agrupa por estado para el detalle (una venta puede consumir de
 * más de una fuente con el mismo estado).
 */
export function calcularDescuentoEstadoLinea(
  fuentes: FuenteConDescuentoEstado[],
  precioUnitario: number,
): { monto: number; detalle: DescuentoEstadoDetalle[] } {
  if (!(precioUnitario > 0) || fuentes.length === 0) return { monto: 0, detalle: [] }

  const porEstado = new Map<string, { pct: number; cantidad: number }>()
  for (const f of fuentes) {
    const pct = f.estado_descuento_pct
    if (!pct || pct <= 0 || !(f.cantidad > 0)) continue
    const key = f.estado_nombre ?? '—'
    const prev = porEstado.get(key)
    // Si el mismo estado aparece con % distinto entre fuentes (no debería, pero por las dudas
    // no promediamos) se queda con el primero encontrado — es el mismo estado, mismo % siempre.
    porEstado.set(key, { pct: prev?.pct ?? pct, cantidad: (prev?.cantidad ?? 0) + f.cantidad })
  }

  const detalle: DescuentoEstadoDetalle[] = [...porEstado.entries()]
    .map(([estado_nombre, { pct, cantidad }]) => ({
      estado_nombre, pct, cantidad, monto: round2(precioUnitario * cantidad * pct / 100),
    }))
    .filter(d => d.monto > 0)

  const monto = round2(detalle.reduce((s, d) => s + d.monto, 0))
  return { monto, detalle }
}

/** Combina el detalle de descuento por estado de varias líneas del carrito en uno solo por
 *  venta (para `ventas.descuento_estado`, agrupando por estado si se repite entre productos). */
export function combinarDetalleDescuentoEstado(detalles: DescuentoEstadoDetalle[][]): DescuentoEstadoDetalle[] {
  const porEstado = new Map<string, DescuentoEstadoDetalle>()
  for (const lista of detalles) {
    for (const d of lista) {
      const prev = porEstado.get(d.estado_nombre)
      porEstado.set(d.estado_nombre, prev
        ? { ...prev, cantidad: prev.cantidad + d.cantidad, monto: round2(prev.monto + d.monto) }
        : { ...d })
    }
  }
  return [...porEstado.values()]
}
