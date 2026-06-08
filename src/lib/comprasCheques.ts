// Compras · CO6 — lógica pura de cheques diferidos. Sin I/O.
// D4: estados, alerta de cobro próximo, validación de endoso.

export type TipoCheque = 'propio' | 'tercero'
export type EstadoCheque =
  | 'en_cartera' | 'entregado' | 'depositado' | 'cobrado' | 'endosado' | 'rechazado' | 'anulado'

export const TIPOS_CHEQUE: { value: TipoCheque; label: string }[] = [
  { value: 'propio', label: 'Propio (emitido por el negocio)' },
  { value: 'tercero', label: 'De tercero (recibido de un cliente)' },
]

export const ESTADO_CHEQUE_LABEL: Record<EstadoCheque, string> = {
  en_cartera: 'En cartera',
  entregado: 'Entregado',
  depositado: 'Depositado',
  cobrado: 'Cobrado',
  endosado: 'Endosado',
  rechazado: 'Rechazado',
  anulado: 'Anulado',
}

/** Estados terminales: no admiten más transiciones. */
export const ESTADOS_CHEQUE_TERMINALES: EstadoCheque[] = ['cobrado', 'rechazado', 'anulado']

export function esEstadoTerminalCheque(estado: EstadoCheque | string): boolean {
  return ESTADOS_CHEQUE_TERMINALES.includes(estado as EstadoCheque)
}

/**
 * Transiciones de estado válidas según el tipo de cheque.
 * - propio: en_cartera → entregado → cobrado | rechazado | anulado
 * - tercero: en_cartera → depositado | endosado → cobrado | rechazado | anulado
 */
export function estadosSiguientes(tipo: TipoCheque, estado: EstadoCheque): EstadoCheque[] {
  if (esEstadoTerminalCheque(estado)) return []
  if (tipo === 'propio') {
    switch (estado) {
      case 'en_cartera': return ['entregado', 'anulado']
      case 'entregado':  return ['cobrado', 'rechazado', 'anulado']
      default:           return ['anulado']
    }
  }
  // tercero
  switch (estado) {
    case 'en_cartera': return ['endosado', 'depositado', 'anulado']
    case 'endosado':   return ['cobrado', 'rechazado', 'anulado']
    case 'depositado': return ['cobrado', 'rechazado', 'anulado']
    default:           return ['anulado']
  }
}

export function puedeTransicionar(tipo: TipoCheque, desde: EstadoCheque, hacia: EstadoCheque): boolean {
  return estadosSiguientes(tipo, desde).includes(hacia)
}

/** Solo un cheque de tercero, no terminal y no ya endosado, puede endosarse a un proveedor. */
export function puedeEndosar(c: { tipo: string; estado: string }): boolean {
  return c.tipo === 'tercero' && c.estado === 'en_cartera'
}

export interface ChequeAlerta {
  fecha_cobro?: string | null
  estado: string
}

/**
 * D4 — ¿el cheque está pendiente de cobro y su fecha está dentro de la ventana de alerta (o vencida)?
 * Solo aplica a cheques no terminales con fecha_cobro definida.
 * @param hoyISO fecha actual 'YYYY-MM-DD'
 */
export function chequeProximoACobrar(c: ChequeAlerta, dias: number, hoyISO: string): boolean {
  if (!c.fecha_cobro) return false
  if (esEstadoTerminalCheque(c.estado)) return false
  const hoy = new Date(hoyISO + 'T00:00:00')
  const cobro = new Date(c.fecha_cobro + 'T00:00:00')
  const diffDias = Math.floor((cobro.getTime() - hoy.getTime()) / 86400000)
  return diffDias <= (dias ?? 0)  // dentro de la ventana o vencido
}

/** ¿La fecha de cobro ya pasó y el cheque sigue pendiente? */
export function chequeVencido(c: ChequeAlerta, hoyISO: string): boolean {
  if (!c.fecha_cobro) return false
  if (esEstadoTerminalCheque(c.estado)) return false
  return c.fecha_cobro < hoyISO
}

export interface ChequeFormInput {
  monto: number
  fecha_cobro?: string | null
  tipo: TipoCheque
  cliente_origen?: string | null
}

/** Validación de alta de cheque. Devuelve mensaje de error o null. */
export function validarChequeAlta(input: ChequeFormInput): string | null {
  if (!(input.monto > 0)) return 'El monto debe ser mayor a 0.'
  if (!input.fecha_cobro) return 'Indicá la fecha de cobro del cheque.'
  return null
}

/** Total $ en cartera/pendiente (no terminal) de una lista de cheques. */
export function totalPendiente(cheques: { estado: string; monto: number }[]): number {
  return Math.round(
    cheques.filter(c => !esEstadoTerminalCheque(c.estado))
      .reduce((s, c) => s + (Number(c.monto) || 0), 0) * 100,
  ) / 100
}
