// ── EN7 — H1 reportes + H2 alertas de Envíos ─────────────────────────────────
// Lógica pura (testeable), sin I/O. La página arma la lista de `EnvioReporte`
// desde Supabase y estos helpers calculan las agregaciones y alertas.

export interface EnvioReporte {
  id: string
  numero?: number | null
  estado: string                 // pendiente|despachado|en_camino|en_bodega|entregado|devolucion|cancelado
  courier?: string | null
  repartidor_id?: string | null
  zona_entrega?: string | null
  codigo_postal?: string | null
  costo_cotizado?: number | null // lo que se paga al courier / costo cotizado
  costo_real?: number | null     // costo real del envío (propio o ajustado)
  costo_pagado?: boolean | null
  fecha_pago_courier?: string | null
  venta_costo_envio?: number | null // ingreso cobrado al cliente (dentro de la venta)
  pod_fecha?: string | null
  diferencia_tipo?: string | null   // a_favor|perdida|neutro (B6)
  diferencia_monto?: number | null
  created_at: string
}

const ENTREGADO = 'entregado'
const CERRADOS = ['entregado', 'devolucion', 'cancelado']
const ABIERTOS_AVANZADOS = ['despachado', 'en_camino', 'en_bodega']

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function diffDias(desdeISO: string | null | undefined, hasta: Date): number {
  if (!desdeISO) return 0
  const d = new Date(desdeISO).getTime()
  if (isNaN(d)) return 0
  return Math.floor((hasta.getTime() - d) / 86400000)
}
function diffHoras(desdeISO: string | null | undefined, hasta: Date): number {
  if (!desdeISO) return 0
  const d = new Date(desdeISO).getTime()
  if (isNaN(d)) return 0
  return Math.floor((hasta.getTime() - d) / 3600000)
}
/** Costo "real" efectivo de un envío: costo_real si está, si no el cotizado. */
function costoEfectivo(e: EnvioReporte): number {
  return Number(e.costo_real ?? e.costo_cotizado ?? 0) || 0
}

// ── H1-a — Pendientes / atrasados ────────────────────────────────────────────
export interface PendientesAtrasados {
  pendientes: number
  atrasados: number
  lista: { id: string; numero?: number | null; estado: string; horas: number }[]
}
export function pendientesAtrasados(
  envios: EnvioReporte[],
  umbralHoras: number,
  ahora: Date = new Date(),
): PendientesAtrasados {
  const u = Number(umbralHoras) || 0
  const lista: PendientesAtrasados['lista'] = []
  let atrasados = 0
  for (const e of envios) {
    if (e.estado !== 'pendiente') continue
    const horas = diffHoras(e.created_at, ahora)
    const atrasado = u > 0 && horas >= u
    if (atrasado) atrasados++
    lista.push({ id: e.id, numero: e.numero, estado: e.estado, horas })
  }
  return { pendientes: lista.length, atrasados, lista: lista.sort((a, b) => b.horas - a.horas) }
}

// ── H1-b — Cumplimiento por courier ──────────────────────────────────────────
export interface CumplimientoCourier {
  courier: string
  total: number
  entregados: number
  pctEntregados: number
  tiempoMedioDias: number | null  // promedio created_at → pod_fecha de los entregados
}
export function cumplimientoPorCourier(envios: EnvioReporte[]): CumplimientoCourier[] {
  const map = new Map<string, { total: number; entregados: number; sumaDias: number; conFecha: number }>()
  for (const e of envios) {
    if (e.estado === 'cancelado') continue
    const courier = (e.courier || 'Sin courier').trim() || 'Sin courier'
    const acc = map.get(courier) ?? { total: 0, entregados: 0, sumaDias: 0, conFecha: 0 }
    acc.total++
    if (e.estado === ENTREGADO) {
      acc.entregados++
      if (e.pod_fecha) {
        const dias = diffDias(e.created_at, new Date(e.pod_fecha + 'T23:59:59'))
        if (dias >= 0) { acc.sumaDias += dias; acc.conFecha++ }
      }
    }
    map.set(courier, acc)
  }
  return [...map.entries()].map(([courier, a]) => ({
    courier,
    total: a.total,
    entregados: a.entregados,
    pctEntregados: a.total > 0 ? Math.round((a.entregados / a.total) * 100) : 0,
    tiempoMedioDias: a.conFecha > 0 ? round2(a.sumaDias / a.conFecha) : null,
  })).sort((a, b) => b.total - a.total)
}

// ── H1-c — Pagos a courier acumulados por mes / courier ──────────────────────
export interface PagoCourierMes {
  mes: string       // YYYY-MM
  courier: string
  total: number
  cantidad: number
}
export function pagosCourierPorMes(envios: EnvioReporte[]): PagoCourierMes[] {
  const map = new Map<string, PagoCourierMes>()
  for (const e of envios) {
    if (!e.costo_pagado || !e.fecha_pago_courier) continue
    if ((e.courier || '').trim() === 'Envío propio') continue
    const mes = e.fecha_pago_courier.slice(0, 7)
    const courier = (e.courier || 'Courier').trim() || 'Courier'
    const key = `${mes}__${courier}`
    const acc = map.get(key) ?? { mes, courier, total: 0, cantidad: 0 }
    acc.total = round2(acc.total + (Number(e.costo_cotizado) || 0))
    acc.cantidad++
    map.set(key, acc)
  }
  return [...map.values()].sort((a, b) => (a.mes === b.mes ? a.courier.localeCompare(b.courier) : (a.mes < b.mes ? 1 : -1)))
}

// ── H1-d — Margen logístico (ingreso cobrado al cliente − costo real) ─────────
export interface MargenLogistico {
  total: number
  ingresoTotal: number
  costoTotal: number
  margenTotal: number
  subsidiados: number   // envíos con margen negativo
  lista: { id: string; numero?: number | null; ingreso: number; costo: number; margen: number }[]
}
export function margenLogistico(envios: EnvioReporte[]): MargenLogistico {
  const lista: MargenLogistico['lista'] = []
  let ingresoTotal = 0, costoTotal = 0, subsidiados = 0
  for (const e of envios) {
    if (e.estado === 'cancelado') continue
    const ingreso = Number(e.venta_costo_envio) || 0
    const costo = costoEfectivo(e)
    if (ingreso === 0 && costo === 0) continue
    const margen = round2(ingreso - costo)
    if (margen < 0) subsidiados++
    ingresoTotal = round2(ingresoTotal + ingreso)
    costoTotal = round2(costoTotal + costo)
    lista.push({ id: e.id, numero: e.numero, ingreso, costo, margen })
  }
  return {
    total: lista.length,
    ingresoTotal,
    costoTotal,
    margenTotal: round2(ingresoTotal - costoTotal),
    subsidiados,
    lista: lista.sort((a, b) => a.margen - b.margen),
  }
}

// ── H1-e — Distribución por zona / CP ────────────────────────────────────────
export interface DistribucionZona {
  zona: string
  total: number
  entregados: number
  pctEntregados: number
}
export function distribucionPorZona(envios: EnvioReporte[]): DistribucionZona[] {
  const map = new Map<string, { total: number; entregados: number }>()
  for (const e of envios) {
    if (e.estado === 'cancelado') continue
    const zona = (e.zona_entrega || e.codigo_postal || 'Sin zona').trim() || 'Sin zona'
    const acc = map.get(zona) ?? { total: 0, entregados: 0 }
    acc.total++
    if (e.estado === ENTREGADO) acc.entregados++
    map.set(zona, acc)
  }
  return [...map.entries()].map(([zona, a]) => ({
    zona, total: a.total, entregados: a.entregados,
    pctEntregados: a.total > 0 ? Math.round((a.entregados / a.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total)
}

// ── H2 — Alertas operativas ──────────────────────────────────────────────────
export interface AlertaEnvio {
  id: string
  numero?: number | null
  detalle: string
}
export interface AlertasEnvios {
  sinDespachar: AlertaEnvio[]
  podPendiente: AlertaEnvio[]
  pagoCourierPendiente: AlertaEnvio[]
  diferenciaImportante: AlertaEnvio[]
  total: number
}
export interface AlertasConfig {
  sinDespachoHoras: number
  podPendienteDias: number
  pagoCourierDias: number
  diferenciaPct: number
}
export function alertasEnvios(
  envios: EnvioReporte[],
  cfg: AlertasConfig,
  ahora: Date = new Date(),
): AlertasEnvios {
  const sinDespachar: AlertaEnvio[] = []
  const podPendiente: AlertaEnvio[] = []
  const pagoCourierPendiente: AlertaEnvio[] = []
  const diferenciaImportante: AlertaEnvio[] = []

  for (const e of envios) {
    // H2-a — sin despachar tras N horas
    if (e.estado === 'pendiente' && cfg.sinDespachoHoras > 0) {
      const h = diffHoras(e.created_at, ahora)
      if (h >= cfg.sinDespachoHoras) sinDespachar.push({ id: e.id, numero: e.numero, detalle: `${h}h sin despachar` })
    }
    // H2-b — POD pendiente tras N días (avanzado/entregado sin fecha de POD)
    if ((ABIERTOS_AVANZADOS.includes(e.estado) || e.estado === ENTREGADO) && !e.pod_fecha && cfg.podPendienteDias > 0) {
      const d = diffDias(e.created_at, ahora)
      if (d >= cfg.podPendienteDias) podPendiente.push({ id: e.id, numero: e.numero, detalle: `${d}d sin POD` })
    }
    // H2-c — costo de courier no pagado tras N días
    if (
      (Number(e.costo_cotizado) || 0) > 0 && !e.costo_pagado &&
      (e.courier || '').trim() !== 'Envío propio' && cfg.pagoCourierDias > 0
    ) {
      const d = diffDias(e.created_at, ahora)
      if (d >= cfg.pagoCourierDias) pagoCourierPendiente.push({ id: e.id, numero: e.numero, detalle: `${d}d sin pagar al courier` })
    }
    // H2-d — diferencia importante cotizado vs real
    const dif = Number(e.diferencia_monto) || 0
    const base = Number(e.costo_cotizado) || 0
    if (dif > 0 && base > 0 && cfg.diferenciaPct > 0) {
      const pct = (dif / base) * 100
      if (pct >= cfg.diferenciaPct) {
        diferenciaImportante.push({ id: e.id, numero: e.numero, detalle: `${e.diferencia_tipo === 'a_favor' ? 'A favor' : 'Pérdida'} ${Math.round(pct)}%` })
      }
    }
  }
  return {
    sinDespachar, podPendiente, pagoCourierPendiente, diferenciaImportante,
    total: sinDespachar.length + podPendiente.length + pagoCourierPendiente.length + diferenciaImportante.length,
  }
}
