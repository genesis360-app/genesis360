// ── Descuentos por método de pago (backlog Config Ventas/Envíos, punto 1) ────────────────
// Lógica PURA (testeable en vitest) del descuento al cliente por pagar con un método
// determinado (ej. "10% off en Efectivo los miércoles, tope $5.000").
//
// La config vive en `metodos_pago.config.descuento` (jsonb — mig 281 documenta el shape):
//   { pct, tope, dias[0=Dom..6=Sáb], desde, hasta }
// NO confundir con `metodos_pago.comision_pct`: la comisión es el COSTO que paga el tenant
// a la plataforma (MP, tarjeta); esto es un DESCUENTO que se le hace al CLIENTE.
//
// REGLA #0 — decisiones de integridad:
//  · El descuento se calcula UNA sola vez por venta, de forma determinística, sin fixpoint:
//    con un solo medio de pago aplica sobre el total post-descuentos (general + combos);
//    con pago mixto aplica sobre el MONTO TIPEADO de cada medio (lo que se paga con él).
//  · Todo descuento aplicado queda registrado en `ventas.promo_pago` (mig 281).
//  · round2 en cada paso para que display, venta.total y caja cuadren al centavo.

export interface DescuentoMetodoPago {
  pct: number
  tope?: number | null      // tope en $ por venta (null/0 = sin tope)
  dias?: number[] | null    // días de semana habilitados, 0=Domingo..6=Sábado (null/[] = todos)
  desde?: string | null     // vigencia YYYY-MM-DD inclusive
  hasta?: string | null
}

export interface MetodoConDescuento {
  nombre: string
  descuento?: DescuentoMetodoPago | null
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100 }

/** Lee el descuento desde metodos_pago.config (jsonb crudo de la DB). Tolerante a basura. */
export function descuentoDeConfig(config: unknown): DescuentoMetodoPago | null {
  if (!config || typeof config !== 'object') return null
  const d = (config as any).descuento
  if (!d || typeof d !== 'object') return null
  const pct = Number(d.pct)
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  return {
    pct,
    tope: Number.isFinite(Number(d.tope)) && Number(d.tope) > 0 ? Number(d.tope) : null,
    dias: Array.isArray(d.dias) ? d.dias.map(Number).filter((x: number) => x >= 0 && x <= 6) : null,
    desde: typeof d.desde === 'string' && d.desde ? d.desde : null,
    hasta: typeof d.hasta === 'string' && d.hasta ? d.hasta : null,
  }
}

/** ¿El descuento está vigente hoy? fecha = YYYY-MM-DD local, diaSemana = 0..6 (getDay()). */
export function descuentoVigente(d: DescuentoMetodoPago | null | undefined, fecha: string, diaSemana: number): boolean {
  if (!d || !(d.pct > 0)) return false
  if (d.desde && fecha < d.desde) return false
  if (d.hasta && fecha > d.hasta) return false
  if (d.dias && d.dias.length > 0 && !d.dias.includes(diaSemana)) return false
  return true
}

/** Monto de descuento sobre una base: pct% con tope. */
export function montoDescuento(d: DescuentoMetodoPago, base: number): number {
  if (!(base > 0)) return 0
  let m = round2(base * d.pct / 100)
  if (d.tope && d.tope > 0) m = Math.min(m, round2(d.tope))
  return m
}

export interface MedioPagoInput { tipo: string; monto: string }
export interface PromoPagoAplicada { metodo: string; pct: number; monto: number }

/**
 * Descuentos por método de pago de una venta completa.
 *  · `totalBase`: total post descuento general y combos, SIN envío (el envío no participa
 *    del descuento — es un costo del flete, no mercadería).
 *  · Un solo medio cargado (con o sin monto) → el descuento aplica sobre `totalBase`.
 *  · Pago mixto → cada medio descuenta sobre su monto tipeado (capado al restante teórico
 *    no: se usa el monto tal cual — la validación de cobertura del total ya existe aparte).
 * Devuelve el detalle por método (para ventas.promo_pago) y el total del descuento.
 */
export function calcularPromosPago(
  medios: MedioPagoInput[],
  metodos: { nombre: string; descuento: DescuentoMetodoPago | null }[],
  totalBase: number,
  fecha: string,
  diaSemana: number,
): { aplicadas: PromoPagoAplicada[]; totalDescuento: number } {
  const cargados = medios.filter(m => m.tipo)
  if (cargados.length === 0 || !(totalBase > 0)) return { aplicadas: [], totalDescuento: 0 }

  const descuentoDe = (tipo: string): DescuentoMetodoPago | null => {
    const m = metodos.find(x => x.nombre === tipo)
    return m?.descuento ?? null
  }

  const aplicadas: PromoPagoAplicada[] = []

  if (cargados.length === 1) {
    const d = descuentoDe(cargados[0].tipo)
    if (d && descuentoVigente(d, fecha, diaSemana)) {
      const monto = montoDescuento(d, totalBase)
      if (monto > 0) aplicadas.push({ metodo: cargados[0].tipo, pct: d.pct, monto })
    }
  } else {
    for (const mp of cargados) {
      const d = descuentoDe(mp.tipo)
      if (!d || !descuentoVigente(d, fecha, diaSemana)) continue
      const base = parseFloat(mp.monto) || 0
      const monto = montoDescuento(d, Math.min(base, totalBase))
      if (monto > 0) aplicadas.push({ metodo: mp.tipo, pct: d.pct, monto })
    }
  }

  const totalDescuento = round2(aplicadas.reduce((s, a) => s + a.monto, 0))
  return { aplicadas, totalDescuento }
}

/** Etiqueta corta de la promo para mostrar en el selector del POS: "10% off" / "10% off (tope $5.000)". */
export function etiquetaPromo(d: DescuentoMetodoPago): string {
  const tope = d.tope && d.tope > 0 ? ` (tope $${d.tope.toLocaleString('es-AR', { maximumFractionDigits: 0 })})` : ''
  return `${d.pct}% off${tope}`
}

export const DIAS_SEMANA_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
