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

/**
 * B5 legacy — OR entre condiciones sueltas. Nunca estuvo conectada al POS (hallazgo del
 * relevamiento Fede/GO 2026-07-19: la config era write-only). Reemplazada por el sistema
 * multi-regla de abajo (`envioGratisAplica`), que es el que el POS usa de verdad.
 * @deprecated usar normalizarReglasGratis + envioGratisAplica
 */
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

// ── B5 v2 — Envío gratis condicional MULTI-REGLA (backlog Fede/GO punto 7) ───────────────
// `tenants.envio_gratis_reglas` pasa a { reglas: ReglaGratis[] }. Semántica:
//   · DENTRO de una regla: todas las condiciones definidas deben cumplirse (AND). Una
//     condición vacía/null no restringe.
//   · ENTRE reglas: alcanza con que una aplique (OR).
// Ej: [{montoMinimo: 50000, maxKm: 10}] = "gratis si la venta supera $50.000 Y está a ≤10 km".

export interface ReglaGratis {
  montoMinimo?: number | null   // la venta (sin envío) debe alcanzar este monto
  etiquetas?: string[] | null   // el cliente debe tener alguna de estas etiquetas
  desde?: string | null         // vigencia YYYY-MM-DD inclusive
  hasta?: string | null
  maxKm?: number | null         // tope de distancia del envío (nuevo — pedido Fede)
}

export interface CtxEnvioGratis {
  totalVenta?: number
  etiquetasCliente?: string[]
  fecha?: string                // YYYY-MM-DD (local)
  km?: number | null            // distancia del envío; null/undefined = desconocida
}

/** Migra el shape legacy ({montoMinimo, etiquetas, promoDesde, promoHasta}) a la lista nueva. */
export function normalizarReglasGratis(raw: unknown): ReglaGratis[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as any
  if (Array.isArray(obj.reglas)) {
    return obj.reglas
      .filter((r: any) => r && typeof r === 'object')
      .map((r: any) => ({
        montoMinimo: Number.isFinite(Number(r.montoMinimo)) && Number(r.montoMinimo) > 0 ? Number(r.montoMinimo) : null,
        etiquetas: Array.isArray(r.etiquetas) ? r.etiquetas.filter(Boolean) : null,
        desde: typeof r.desde === 'string' && r.desde ? r.desde : null,
        hasta: typeof r.hasta === 'string' && r.hasta ? r.hasta : null,
        maxKm: Number.isFinite(Number(r.maxKm)) && Number(r.maxKm) > 0 ? Number(r.maxKm) : null,
      }))
      .filter((r: ReglaGratis) => r.montoMinimo || r.etiquetas?.length || (r.desde && r.hasta) || r.maxKm)
  }
  // Shape legacy (una sola "regla" plana). OJO: la semántica vieja era OR entre condiciones;
  // acá la partimos en reglas independientes para conservar ese OR.
  const out: ReglaGratis[] = []
  if (Number(obj.montoMinimo) > 0) out.push({ montoMinimo: Number(obj.montoMinimo) })
  if (Array.isArray(obj.etiquetas) && obj.etiquetas.filter(Boolean).length > 0)
    out.push({ etiquetas: obj.etiquetas.filter(Boolean) })
  if (obj.promoDesde && obj.promoHasta) out.push({ desde: obj.promoDesde, hasta: obj.promoHasta })
  return out
}

function reglaAplica(r: ReglaGratis, ctx: CtxEnvioGratis): boolean {
  let tieneCondicion = false
  if (r.montoMinimo && r.montoMinimo > 0) {
    tieneCondicion = true
    if (!(Number(ctx.totalVenta ?? 0) >= r.montoMinimo)) return false
  }
  if (r.etiquetas && r.etiquetas.length > 0) {
    tieneCondicion = true
    const set = new Set(r.etiquetas.map(e => e.toLowerCase()))
    if (!(ctx.etiquetasCliente ?? []).some(e => set.has(e.toLowerCase()))) return false
  }
  if (r.desde || r.hasta) {
    tieneCondicion = true
    if (!ctx.fecha) return false
    if (r.desde && ctx.fecha < r.desde) return false
    if (r.hasta && ctx.fecha > r.hasta) return false
  }
  if (r.maxKm && r.maxKm > 0) {
    tieneCondicion = true
    // Distancia desconocida → la condición de km no se puede verificar → la regla NO aplica
    // (fail-closed: nunca regalar un envío que no sabemos si entra en el radio).
    if (ctx.km == null || !(Number(ctx.km) <= r.maxKm)) return false
  }
  return tieneCondicion
}

/** ¿Alguna regla vuelve gratis este envío? Devuelve la primera que aplica (para explicarla en la UI). */
export function envioGratisAplica(
  reglas: ReglaGratis[],
  ctx: CtxEnvioGratis,
): { aplica: boolean; regla: ReglaGratis | null } {
  for (const r of reglas) if (reglaAplica(r, ctx)) return { aplica: true, regla: r }
  return { aplica: false, regla: null }
}

/** Descripción humana de una regla, para el banner del POS y la lista de Config. */
export function describirReglaGratis(r: ReglaGratis): string {
  const partes: string[] = []
  if (r.montoMinimo) partes.push(`compras desde $${r.montoMinimo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
  if (r.etiquetas?.length) partes.push(`clientes ${r.etiquetas.join('/')}`)
  if (r.maxKm) partes.push(`hasta ${r.maxKm} km`)
  if (r.desde && r.hasta) partes.push(`del ${r.desde} al ${r.hasta}`)
  else if (r.desde) partes.push(`desde el ${r.desde}`)
  else if (r.hasta) partes.push(`hasta el ${r.hasta}`)
  return partes.join(' · ') || 'siempre'
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
