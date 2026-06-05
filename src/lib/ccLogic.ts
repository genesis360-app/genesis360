// CL2/CL6 — Lógica pura de cuenta corriente de clientes, extraída para testeo unitario.
// Espeja el comportamiento de los componentes (POS, ClientesPage) y de las RPC SQL
// (cliente_cc_estado, recalcular_intereses_cc, mig 172). Sin I/O: todo determinístico.

export type EnforcementPolitica = 'permitir' | 'avisar' | 'bloquear'
export type MorosidadPolitica = 'permitir' | 'bloqueo_cc' | 'bloqueo_total'

/** Tolerancia transversal de redondeo ($0.50), igual que en validaciones de ventas. */
export const EPS_CC = 0.5

/**
 * ISS-151 — pseudo-métodos de pago: NO son ingresos reales y deben excluirse de los
 * gráficos/métricas de medios de pago (distorsionan la ganancia). Incluye la deuda CC
 * pendiente y todos los write-offs (condonación / cancelación / incobrable).
 * Fuente única de verdad para MixCajaChart, MetricasPage y demás reportes.
 */
export const PSEUDO_METODOS_PAGO = new Set<string>([
  'Cuenta Corriente', 'Cancelación CC', 'Condonación CC', 'Incobrable',
])

/** ¿El tipo de medio de pago es un ingreso real (no pseudo-método)? */
export const esMetodoRealPago = (tipo: string | null | undefined): boolean =>
  !!tipo && !PSEUDO_METODOS_PAGO.has(tipo)

/**
 * B1 — Decisión de enforcement del límite de CC sobre la parte que va a cuenta corriente.
 * `limite` NULL = sin límite. Devuelve la acción según la política cuando se supera.
 */
export function evaluarLimiteCC(args: {
  deudaTotal: number
  montoCC: number
  limite: number | null | undefined
  politica: EnforcementPolitica
}): { supera: boolean; accion: 'ok' | EnforcementPolitica } {
  const { deudaTotal, montoCC, limite, politica } = args
  if (limite == null || montoCC <= EPS_CC) return { supera: false, accion: 'ok' }
  const supera = deudaTotal + montoCC > limite + EPS_CC
  return supera ? { supera: true, accion: politica } : { supera: false, accion: 'ok' }
}

/**
 * B4 — Decisión de morosidad. `bloquear_total` impide cualquier venta;
 * `bloquear_cc` solo impide sumar a CC (deja pagar por otro medio).
 */
export function evaluarMorosidad(args: {
  deudaVencida: number
  politica: MorosidadPolitica
  modoCC: boolean
}): 'ok' | 'bloquear_total' | 'bloquear_cc' {
  const { deudaVencida, politica, modoCC } = args
  if (deudaVencida <= EPS_CC) return 'ok'
  if (politica === 'bloqueo_total') return 'bloquear_total'
  if (politica === 'bloqueo_cc' && modoCC) return 'bloquear_cc'
  return 'ok'
}

/**
 * B3 — Interés de mora sobre el saldo vencido (espejo de recalcular_intereses_cc).
 * interes = round(saldo * pct/100 * diasVencido/30, 2). Guards: pct<=0, saldo<=EPS,
 * o no vencido (dias<=0) → 0.
 */
export function calcularInteresMora(args: {
  saldo: number
  pctMensual: number
  diasVencido: number
}): number {
  const { saldo, pctMensual, diasVencido } = args
  if (pctMensual <= 0 || saldo <= EPS_CC || diasVencido <= 0) return 0
  return Math.round(saldo * (pctMensual / 100) * (diasVencido / 30) * 100) / 100
}

export interface VentaEstadoCC {
  total: number
  monto_pagado: number
  interes_cc?: number | null
  fecha_vencimiento_cc?: string | null
  estado?: string | null
}

/**
 * B3/B4 — Estado de CC de un cliente (espejo de cliente_cc_estado).
 * Suma saldo+interés de las ventas CC con saldo pendiente (> EPS), separando la vencida.
 * `hoyISO` en formato YYYY-MM-DD.
 */
export function calcularEstadoCC(ventas: VentaEstadoCC[], hoyISO: string): {
  deudaTotal: number
  deudaVencida: number
  interesTotal: number
} {
  let deudaTotal = 0, deudaVencida = 0, interesTotal = 0
  for (const v of ventas) {
    if (v.estado === 'cancelada') continue
    const saldoBase = (v.total ?? 0) - (v.monto_pagado ?? 0)
    if (saldoBase <= EPS_CC) continue
    const interes = v.interes_cc ?? 0
    const conInteres = Math.max(saldoBase, 0) + interes
    deudaTotal += conInteres
    interesTotal += interes
    if (v.fecha_vencimiento_cc && v.fecha_vencimiento_cc < hoyISO) deudaVencida += conInteres
  }
  return { deudaTotal, deudaVencida, interesTotal }
}

export interface VentaSaldoFIFO {
  id: string
  total: number
  monto_pagado: number
  medio_pago?: string | null
}

/**
 * B5 — Planificación pura de la cobranza FIFO (sin I/O). Recibe las ventas CC
 * pendientes YA ordenadas (más antigua primero) y reparte el monto. Devuelve los
 * updates a aplicar + lo efectivamente aplicado + cuántas ventas quedan saldadas.
 */
export function planificarCobranzaFIFO(
  ventasOrdenadas: VentaSaldoFIFO[],
  monto: number,
  metodo: string,
): {
  updates: { id: string; nuevoMontoPagado: number; nuevoMedioPago: string }[]
  aplicado: number
  ventasSaldadas: number
} {
  const updates: { id: string; nuevoMontoPagado: number; nuevoMedioPago: string }[] = []
  let restante = monto, aplicado = 0, saldadas = 0
  if (!(monto > 0)) return { updates, aplicado, ventasSaldadas: 0 }
  for (const v of ventasOrdenadas) {
    if (restante <= EPS_CC) break
    const saldo = (v.total ?? 0) - (v.monto_pagado ?? 0)
    if (saldo <= EPS_CC) continue
    const abono = Math.min(restante, saldo)
    const nuevoMontoPagado = (v.monto_pagado ?? 0) + abono
    let medios: any[] = []
    try { medios = JSON.parse(v.medio_pago ?? '[]') } catch { medios = [] }
    medios.push({ tipo: metodo, monto: abono })
    updates.push({ id: v.id, nuevoMontoPagado, nuevoMedioPago: JSON.stringify(medios) })
    restante -= abono
    aplicado += abono
    if (nuevoMontoPagado >= (v.total ?? 0) - EPS_CC) saldadas++
  }
  return { updates, aplicado, ventasSaldadas: saldadas }
}

export interface VentaAgingCC {
  total: number
  monto_pagado: number
  interes_cc?: number | null
  fecha_vencimiento_cc?: string | null
  created_at: string
  condonada?: boolean
}

/**
 * CL6/G1 — Aging de deuda CC en buckets por antigüedad. Usa fecha_vencimiento_cc si
 * existe, sino created_at. Incluye el interés en el saldo. Excluye condonadas y saldadas.
 */
export function agruparAgingCC(ventas: VentaAgingCC[], ahoraMs: number): {
  '0-30': number; '31-60': number; '61-90': number; '+90': number
} {
  const DIA = 86400000
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 }
  for (const v of ventas) {
    if (v.condonada) continue
    const saldo = (v.total ?? 0) - (v.monto_pagado ?? 0) + (v.interes_cc ?? 0)
    if (saldo <= EPS_CC) continue
    const ref = v.fecha_vencimiento_cc
      ? new Date(v.fecha_vencimiento_cc + 'T12:00:00').getTime()
      : new Date(v.created_at).getTime()
    const dias = Math.floor((ahoraMs - ref) / DIA)
    if (dias <= 30) aging['0-30'] += saldo
    else if (dias <= 60) aging['31-60'] += saldo
    else if (dias <= 90) aging['61-90'] += saldo
    else aging['+90'] += saldo
  }
  return aging
}
