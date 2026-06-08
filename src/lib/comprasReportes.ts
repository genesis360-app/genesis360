// Compras · CO8 — lógica pura de reportes/agregaciones + calificación de proveedor (E4). Sin I/O.

export interface OCReporte {
  id: string
  proveedor_id?: string | null
  proveedor_nombre?: string | null
  estado: string            // borrador|enviada|confirmada|recibida|recibida_parcial|cancelada
  estado_pago?: string | null
  monto_total?: number | null
  monto_pagado?: number | null
  monto_descuento?: number | null
  fecha_esperada?: string | null
  fecha_vencimiento_pago?: string | null
  created_at: string
}

export interface OCItemReporte {
  producto_id: string
  producto_nombre?: string | null
  sku?: string | null
  cantidad: number
  precio_unitario?: number | null
  fecha?: string | null      // created_at de la OC
}

const ESTADOS_RECIBIDA = ['recibida']
const ESTADOS_ACTIVA = ['borrador', 'enviada', 'confirmada', 'recibida', 'recibida_parcial']

export function saldoOC(oc: OCReporte): number {
  return Math.max(0, (Number(oc.monto_total) || 0) - (Number(oc.monto_pagado) || 0) - (Number(oc.monto_descuento) || 0))
}

/** G1 — compras por proveedor: volumen $, # OCs, recibidas, % cumplimiento. */
export interface ResumenProveedor {
  proveedor_id: string
  proveedor_nombre: string
  cantidadOCs: number
  montoTotal: number
  recibidas: number
  parciales: number
  saldoPendiente: number
  cumplimientoPct: number    // E4 — % de OCs (no canceladas) recibidas completas
  score: 'A' | 'B' | 'C' | '—'
}

export function comprasPorProveedor(ocs: OCReporte[]): ResumenProveedor[] {
  const map = new Map<string, ResumenProveedor>()
  for (const oc of ocs) {
    if (oc.estado === 'cancelada') continue
    const id = oc.proveedor_id ?? 'sin'
    if (!map.has(id)) {
      map.set(id, {
        proveedor_id: id, proveedor_nombre: oc.proveedor_nombre ?? 'Sin proveedor',
        cantidadOCs: 0, montoTotal: 0, recibidas: 0, parciales: 0, saldoPendiente: 0,
        cumplimientoPct: 0, score: '—',
      })
    }
    const r = map.get(id)!
    r.cantidadOCs++
    r.montoTotal += Number(oc.monto_total) || 0
    if (ESTADOS_RECIBIDA.includes(oc.estado)) r.recibidas++
    if (oc.estado === 'recibida_parcial') r.parciales++
    r.saldoPendiente += saldoOC(oc)
  }
  const out = [...map.values()].map(r => {
    r.montoTotal = Math.round(r.montoTotal * 100) / 100
    r.saldoPendiente = Math.round(r.saldoPendiente * 100) / 100
    r.cumplimientoPct = r.cantidadOCs > 0 ? Math.round((r.recibidas / r.cantidadOCs) * 100) : 0
    r.score = calificarProveedor(r.cumplimientoPct)
    return r
  })
  return out.sort((a, b) => b.montoTotal - a.montoTotal)
}

/** E4 — score por % de cumplimiento. */
export function calificarProveedor(cumplimientoPct: number): 'A' | 'B' | 'C' | '—' {
  if (cumplimientoPct >= 85) return 'A'
  if (cumplimientoPct >= 60) return 'B'
  if (cumplimientoPct > 0) return 'C'
  return '—'
}

/** G1 — top productos comprados (por monto). */
export interface ResumenProducto {
  producto_id: string
  producto_nombre: string
  sku: string
  cantidad: number
  monto: number
}

export function topProductosComprados(items: OCItemReporte[], limit = 20): ResumenProducto[] {
  const map = new Map<string, ResumenProducto>()
  for (const it of items) {
    if (!map.has(it.producto_id)) {
      map.set(it.producto_id, { producto_id: it.producto_id, producto_nombre: it.producto_nombre ?? '—', sku: it.sku ?? '—', cantidad: 0, monto: 0 })
    }
    const r = map.get(it.producto_id)!
    r.cantidad += Number(it.cantidad) || 0
    r.monto += (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0)
  }
  return [...map.values()]
    .map(r => ({ ...r, monto: Math.round(r.monto * 100) / 100 }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, limit)
}

/** G1 — aging de pagos pendientes (por antigüedad de la OC con saldo). */
export interface AgingPagos {
  bucket_0_30: number
  bucket_31_60: number
  bucket_61_90: number
  bucket_91_mas: number
  total: number
}

export function agingPagos(ocs: OCReporte[], hoyISO: string): AgingPagos {
  const hoy = new Date(hoyISO + 'T00:00:00').getTime()
  const res: AgingPagos = { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_91_mas: 0, total: 0 }
  for (const oc of ocs) {
    if (oc.estado === 'cancelada') continue
    const saldo = saldoOC(oc)
    if (saldo <= 0.5) continue
    const ref = oc.fecha_vencimiento_pago ?? oc.created_at?.split('T')[0]
    const dias = ref ? Math.floor((hoy - new Date(ref + 'T00:00:00').getTime()) / 86400000) : 0
    if (dias <= 30) res.bucket_0_30 += saldo
    else if (dias <= 60) res.bucket_31_60 += saldo
    else if (dias <= 90) res.bucket_61_90 += saldo
    else res.bucket_91_mas += saldo
    res.total += saldo
  }
  for (const k of Object.keys(res) as (keyof AgingPagos)[]) res[k] = Math.round(res[k] * 100) / 100
  return res
}

/** G1 — OCs vencidas: enviadas/confirmadas cuya fecha esperada de entrega ya pasó sin recibirse. */
export function ocsVencidas(ocs: OCReporte[], hoyISO: string): OCReporte[] {
  return ocs.filter(oc =>
    ['enviada', 'confirmada'].includes(oc.estado) &&
    !!oc.fecha_esperada && oc.fecha_esperada < hoyISO,
  )
}

/** G1 — evolución de costo por SKU: primer y último precio + variación %. */
export interface EvolucionCosto {
  producto_id: string
  producto_nombre: string
  sku: string
  primerPrecio: number
  ultimoPrecio: number
  variacionPct: number
  compras: number
}

export function evolucionCostos(items: OCItemReporte[]): EvolucionCosto[] {
  const map = new Map<string, { nombre: string; sku: string; serie: { fecha: string; precio: number }[] }>()
  for (const it of items) {
    if (it.precio_unitario == null || it.precio_unitario <= 0) continue
    if (!map.has(it.producto_id)) map.set(it.producto_id, { nombre: it.producto_nombre ?? '—', sku: it.sku ?? '—', serie: [] })
    map.get(it.producto_id)!.serie.push({ fecha: it.fecha ?? '', precio: Number(it.precio_unitario) })
  }
  const out: EvolucionCosto[] = []
  for (const [id, v] of map) {
    if (v.serie.length < 2) continue  // necesita al menos 2 compras para "evolución"
    const ordenada = [...v.serie].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    const primer = ordenada[0].precio
    const ultimo = ordenada[ordenada.length - 1].precio
    const variacion = primer > 0 ? Math.round(((ultimo - primer) / primer) * 1000) / 10 : 0
    out.push({ producto_id: id, producto_nombre: v.nombre, sku: v.sku, primerPrecio: primer, ultimoPrecio: ultimo, variacionPct: variacion, compras: v.serie.length })
  }
  return out.sort((a, b) => Math.abs(b.variacionPct) - Math.abs(a.variacionPct))
}
