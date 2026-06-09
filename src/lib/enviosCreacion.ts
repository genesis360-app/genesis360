// ── EN5 — Creación y alcance del envío ───────────────────────────────────────
// Lógica pura (testeable). A2 tipos de envío libre · A3 sugerencia de courier por CP
// A4 plazo de despacho por canal + alerta · A5 desglose por envío (helpers).

export const TIPOS_ENVIO = [
  { v: 'venta',            t: 'De una venta' },
  { v: 'traslado_interno', t: 'Traslado interno (entre sucursales)' },
  { v: 'muestra',          t: 'Muestra' },
  { v: 'dev_proveedor',    t: 'Devolución a proveedor' },
  { v: 'otro',             t: 'Otro' },
] as const

export type TipoEnvio = typeof TIPOS_ENVIO[number]['v']

export interface CpCourierRegla { cp?: string; desde?: string; hasta?: string; courier: string }

/**
 * A3 — Sugiere el courier preferido para un código postal según el mapping del tenant.
 *   Soporta match exacto (`cp`) o rango numérico (`desde`/`hasta`). Primer match gana.
 */
export function sugerirCourierPorCp(cp: string | null | undefined, mapping: CpCourierRegla[] | null | undefined): string | null {
  if (!cp || !Array.isArray(mapping)) return null
  const cpNum = parseInt(String(cp).replace(/\D/g, ''), 10)
  for (const r of mapping) {
    if (!r || !r.courier) continue
    if (r.cp && String(r.cp).replace(/\D/g, '') === String(cp).replace(/\D/g, '')) return r.courier
    if (r.desde && r.hasta && !isNaN(cpNum)) {
      const d = parseInt(String(r.desde).replace(/\D/g, ''), 10)
      const h = parseInt(String(r.hasta).replace(/\D/g, ''), 10)
      if (!isNaN(d) && !isNaN(h) && cpNum >= d && cpNum <= h) return r.courier
    }
  }
  return null
}

/** A4 — Clasifica el canal de venta en presencial / online / mayorista. */
export function clasificarCanal(canal: string | null | undefined): 'presencial' | 'online' | 'mayorista' {
  const c = (canal ?? '').toLowerCase()
  if (c.includes('mayor')) return 'mayorista'
  if (c === 'pos' || c.includes('local') || c.includes('presencial') || c.includes('mostrador')) return 'presencial'
  return 'online'  // MELI / TiendaNube / MP / web por defecto
}

/**
 * A4 — Plazo de despacho por canal: ¿se pasó el límite sin despachar?
 *   `plazos` = { presencial, online, mayorista } en HORAS. 0/ausente = sin límite.
 *   Solo aplica a estados previos al despacho (pendiente).
 */
export function plazoDespachoVencido(
  args: { createdAt: string; estado: string; canal?: string | null; plazos?: Record<string, number> | null; ahora?: Date },
): { vencido: boolean; horasLimite: number; horasTranscurridas: number } {
  const plazos = args.plazos ?? {}
  const clase = clasificarCanal(args.canal)
  const horasLimite = Number(plazos[clase] ?? 0)
  const ahora = args.ahora ?? new Date()
  const transcurridas = Math.floor((ahora.getTime() - new Date(args.createdAt).getTime()) / 3_600_000)
  const aplica = args.estado === 'pendiente' && horasLimite > 0
  return { vencido: aplica && transcurridas > horasLimite, horasLimite, horasTranscurridas: transcurridas }
}

/** A5 — Total de unidades repartidas en los envíos de una venta (para saber qué falta despachar). */
export function unidadesEnviadas(items: Array<{ cantidad: number | null }>): number {
  return items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0)
}
