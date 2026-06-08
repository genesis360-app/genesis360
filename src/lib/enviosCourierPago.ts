// ── EN1 — Pagos a courier contables + conciliación ───────────────────────────
// Lógica pura (testeable) para el flujo de pagos a courier tercero del módulo Envíos.
//   C2: agrupar pagos por courier + desglose de IVA crédito fiscal del flete.
//   C3: conciliación factura del courier vs lo registrado (alerta de diferencias).
//   C4: doble firma por umbral.
// El costo del courier (costo_cotizado) se toma BRUTO (IVA incluido), igual que un gasto.

export interface EnvioPago {
  id: string
  courier: string | null
  costo_cotizado: number | null
  sucursal_id?: string | null
}

export interface GrupoCourier {
  courier: string
  total: number
  ids: string[]
  sucursalId: string | null
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * C2 — Agrupa los envíos seleccionados por courier. Se genera un gasto por courier
 * (proveedor = courier), no uno global, para que la contabilidad quede por proveedor.
 */
export function agruparPagosPorCourier(envios: EnvioPago[]): GrupoCourier[] {
  const map = new Map<string, GrupoCourier>()
  for (const e of envios) {
    const courier = (e.courier || 'Courier').trim() || 'Courier'
    const g = map.get(courier) ?? { courier, total: 0, ids: [], sucursalId: e.sucursal_id ?? null }
    g.total = round2(g.total + Number(e.costo_cotizado ?? 0))
    g.ids.push(e.id)
    if (!g.sucursalId && e.sucursal_id) g.sucursalId = e.sucursal_id
    map.set(courier, g)
  }
  return [...map.values()]
}

/**
 * C2 — Desglosa el IVA crédito fiscal del flete a partir del monto bruto (IVA incluido).
 * neto = bruto / (1 + pct/100) · iva = bruto − neto.
 */
export function desgloseIvaFlete(montoBruto: number, ivaPct: number): { neto: number; iva: number } {
  if (!ivaPct || ivaPct <= 0 || montoBruto <= 0) return { neto: round2(montoBruto), iva: 0 }
  const neto = montoBruto / (1 + ivaPct / 100)
  return { neto: round2(neto), iva: round2(montoBruto - neto) }
}

/**
 * C4 — Doble firma: aplica solo si hay umbral configurado (> 0) y el total del pago
 * alcanza o supera ese umbral. Mismo patrón que el pago de OC (Compras D5).
 */
export function requiereDobleFirma(total: number, umbral: number | null | undefined): boolean {
  const u = Number(umbral ?? 0)
  return u > 0 && total >= u
}

/**
 * C3 — Diferencia entre lo facturado por el courier y lo registrado en el sistema.
 * `diff > 0` = el courier facturó de más; `diff < 0` = facturó de menos.
 */
export function diffFactura(
  totalFacturado: number,
  totalRegistrado: number,
  tolerancia = 1,
): { diff: number; hayDiferencia: boolean; pct: number } {
  const diff = round2(totalFacturado - totalRegistrado)
  const pct = totalRegistrado > 0
    ? round2((diff / totalRegistrado) * 100)
    : (totalFacturado > 0 ? 100 : 0)
  return { diff, hayDiferencia: Math.abs(diff) > tolerancia, pct }
}

/** C3 — Suma del costo registrado de un conjunto de envíos (lo que el sistema tiene cargado). */
export function totalRegistrado(envios: EnvioPago[]): number {
  return round2(envios.reduce((s, e) => s + Number(e.costo_cotizado ?? 0), 0))
}
