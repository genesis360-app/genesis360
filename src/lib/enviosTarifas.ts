// ── EN4 — Costos y tarifas avanzados ─────────────────────────────────────────
// Lógica pura (testeable) del cálculo de costo de envío PROPIO y de la política de
// cobro al cliente. B1 $/km + recargo horario · B2 factor KM · B3 costo mínimo/escalonado
// B4 política de cobro · B5 envío gratis condicional · B6 diferencia real vs cotizado.

export interface TramoKm { hasta: number; precio: number }       // 0..hasta km cuesta `precio`
export interface RecargoHorario { desde: string; hasta: string; recargo: number } // HH:MM

export interface ConfigTarifaPropio {
  costoKm?: number | null         // $/km (sucursal > global)
  factorKm?: number | null        // B2 (default 1.35) — penaliza la distancia real
  costoMinimo?: number | null     // B3 — piso del costo
  tramos?: TramoKm[] | null       // B3 — costo escalonado por tramos de km
  recargoHorario?: RecargoHorario[] | null // B1-d — recargo por franja
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100 }

/** ¿La hora HH:MM cae dentro de [desde,hasta)? (rangos que cruzan medianoche soportados). */
function enFranja(hora: string, desde: string, hasta: string): boolean {
  if (!hora) return false
  if (desde <= hasta) return hora >= desde && hora < hasta
  return hora >= desde || hora < hasta   // cruza medianoche
}

/**
 * B1/B2/B3 — Costo del envío propio.
 *   1) base = tramo escalonado si aplica, si no `km * costoKm * factorKm`.
 *   2) recargo por franja horaria (suma fija).
 *   3) piso por costo mínimo.
 */
export function costoEnvioPropio(km: number, cfg: ConfigTarifaPropio, hora?: string | null): number {
  const factor = Number(cfg.factorKm ?? 1.35) || 1
  const costoKm = Number(cfg.costoKm ?? 0)
  let base: number
  const tramos = (cfg.tramos ?? []).filter(t => t && t.hasta > 0).sort((a, b) => a.hasta - b.hasta)
  if (tramos.length > 0) {
    const tramo = tramos.find(t => km <= t.hasta)
    base = tramo ? Number(tramo.precio) : Number(tramos[tramos.length - 1].precio)
  } else {
    base = km * costoKm * factor
  }
  // B1-d — recargo por franja horaria
  if (hora && Array.isArray(cfg.recargoHorario)) {
    const r = cfg.recargoHorario.find(x => x && enFranja(hora, x.desde, x.hasta))
    if (r) base += Number(r.recargo) || 0
  }
  // B3 — costo mínimo
  const min = Number(cfg.costoMinimo ?? 0)
  if (min > 0 && base < min) base = min
  return round2(Math.max(0, base))
}

export type CobroPolitica = 'cliente_100' | 'cliente_margen' | 'subsidio'

/**
 * B4 — Qué paga el cliente por el envío.
 *   cliente_100   → costo tal cual.
 *   cliente_margen → costo + margen %.
 *   subsidio      → gratis si la venta supera el umbral; si no, costo.
 */
export function cobroCliente(
  costo: number,
  politica: CobroPolitica,
  params: { margenPct?: number | null; subsidioUmbral?: number | null },
  totalVenta = 0,
): number {
  if (politica === 'cliente_margen') {
    const m = Number(params.margenPct ?? 0)
    return round2(costo * (1 + m / 100))
  }
  if (politica === 'subsidio') {
    const u = Number(params.subsidioUmbral ?? 0)
    return u > 0 && totalVenta >= u ? 0 : round2(costo)
  }
  return round2(costo)
}

export interface ReglasGratis {
  montoMinimo?: number | null
  etiquetas?: string[] | null         // etiquetas de cliente que tienen envío gratis (Mayorista/VIP)
  promoDesde?: string | null          // YYYY-MM-DD
  promoHasta?: string | null
}

/** B5 — Envío gratis condicional: por monto, por etiqueta de cliente o por promo vigente. */
export function envioGratis(
  reglas: ReglasGratis | null | undefined,
  ctx: { totalVenta?: number; etiquetasCliente?: string[]; fecha?: string },
): boolean {
  if (!reglas) return false
  const total = Number(ctx.totalVenta ?? 0)
  if (reglas.montoMinimo && total >= Number(reglas.montoMinimo)) return true
  if (reglas.etiquetas?.length && ctx.etiquetasCliente?.length) {
    const set = new Set(reglas.etiquetas.map(e => e.toLowerCase()))
    if (ctx.etiquetasCliente.some(e => set.has(e.toLowerCase()))) return true
  }
  if (reglas.promoDesde && reglas.promoHasta && ctx.fecha) {
    if (ctx.fecha >= reglas.promoDesde && ctx.fecha <= reglas.promoHasta) return true
  }
  return false
}

/**
 * B6 — Diferencia real vs cotizado (el precio al cliente NO se modifica post-pago).
 *   costoReal < cotizado → a_favor; costoReal > cotizado → perdida.
 */
export function diferenciaReal(costoCotizado: number, costoReal: number): { tipo: 'a_favor' | 'perdida' | 'neutro'; monto: number } {
  const d = round2(costoReal - costoCotizado)
  if (Math.abs(d) < 0.5) return { tipo: 'neutro', monto: 0 }
  return d < 0 ? { tipo: 'a_favor', monto: round2(-d) } : { tipo: 'perdida', monto: d }
}

export const DIFERENCIA_MOTIVOS = [
  'Error de cotización',
  'Cambio de tarifa del courier',
  'Peso/dimensiones reales distintos',
  'Zona/distancia distinta',
  'Reintento de entrega',
  'Otro',
] as const
