// Lógica pura de arqueo de Caja — extraída de CajaPage.tsx para hacerla testeable.
// Sin I/O ni dependencias de React/Supabase. Espejo 1:1 del comportamiento inline previo.
// Relevamiento Caja 2026-05-25 (B1-B4 diferencias/alertas, ISS-193 traspasos).

/** Tipos de movimiento que restan al saldo de la sesión. El resto suma. (CajaPage:483/645) */
const TIPOS_EGRESO = ['egreso', 'egreso_informativo', 'egreso_devolucion_sena', 'egreso_traspaso']

/** Signo del movimiento sobre el saldo: -1 para egresos, +1 para el resto. */
export function signoMovimiento(tipo: string): 1 | -1 {
  return TIPOS_EGRESO.includes(tipo) ? -1 : 1
}

/** Saldo de la sesión = apertura + ingresos - egresos. (CajaPage:475) */
export function saldoSesion({ apertura, ingresos, egresos }: {
  apertura: number
  ingresos: number
  egresos: number
}): number {
  return apertura + ingresos - egresos
}

/**
 * Diferencia al cierre = conteo real - saldo del sistema.
 * Si el conteo está vacío (`''`) devuelve `null` (el cajero aún no contó).
 * Positivo = sobrante, negativo = faltante. (CajaPage:490-491)
 */
export function calcularDiferenciaCierre(montoRealCierre: string, saldoSistema: number): number | null {
  if (montoRealCierre === '') return null
  const montoRealNum = parseFloat(montoRealCierre) || 0
  return montoRealNum - saldoSistema
}

/**
 * Diferencia al abrir = monto real ingresado - monto sugerido (del cierre anterior).
 * Si no hay sugerido (sin cierre previo) devuelve `null`. (CajaPage:535-536)
 */
export function calcularDiferenciaApertura(montoReal: number, montoSugerido: number | null): number | null {
  return montoSugerido !== null ? montoReal - montoSugerido : null
}

/**
 * ¿La diferencia supera el umbral configurado para alertar? (CajaPage:742-743)
 * Umbral 0/NULL = alerta ante cualquier diferencia distinta de 0.
 * Umbral > 0 = alerta cuando |dif| >= umbral.
 */
export function superaUmbralDiferencia(diferencia: number, umbral: number): boolean {
  return umbral > 0 ? Math.abs(diferencia) >= umbral : diferencia !== 0
}

export interface AjusteDiferencia {
  tipo: 'ingreso' | 'egreso' | null
  etiqueta: 'sobrante' | 'faltante' | 'exacto'
}

/**
 * Clasifica la diferencia de cierre en el movimiento de ajuste a registrar. (CajaPage:692-699)
 * dif === 0 → no se inserta movimiento (tipo null).
 * dif  >  0 → ingreso (sobrante); dif < 0 → egreso (faltante).
 */
export function clasificarAjusteDiferencia(diferencia: number): AjusteDiferencia {
  if (diferencia === 0) return { tipo: null, etiqueta: 'exacto' }
  return diferencia > 0
    ? { tipo: 'ingreso', etiqueta: 'sobrante' }
    : { tipo: 'egreso', etiqueta: 'faltante' }
}

/** Dirección de propagación al corregir un movimiento de traspaso. */
export type DireccionTraspaso = 'a_origen' | 'a_destino'

/**
 * Tipo de movimiento de ajuste a registrar en la caja contraparte de un traspaso. (CajaPage:880-886)
 * - a_origen (corregí el destino): dif<0 → ingreso (origen recupera), dif>=0 → egreso.
 * - a_destino (corregí el origen): dif<0 → egreso (destino recibe menos), dif>=0 → ingreso.
 */
export function tipoAjusteTraspaso(direccion: DireccionTraspaso, diferencia: number): 'ingreso' | 'egreso' {
  if (direccion === 'a_origen') return diferencia < 0 ? 'ingreso' : 'egreso'
  return diferencia < 0 ? 'egreso' : 'ingreso'
}

/** Extrae el número de venta de un concepto (`'Venta #198'` → `'198'`). (CajaPage:41-44) */
export function extraerNumeroVenta(concepto: string): string | null {
  const m = concepto.match(/#(\d+)/)
  return m ? m[1] : null
}

/**
 * Clasifica el medio de pago de un movimiento a partir de su tipo + concepto. (CajaPage:51-59)
 * Los movimientos informativos llevan el medio entre corchetes al inicio del concepto.
 */
export function extraerMedioPago(tipo: string, concepto: string): string {
  if (tipo === 'ingreso_informativo' || tipo === 'egreso_informativo') {
    const m = concepto.match(/^\[(.+?)\]/)
    return m ? m[1] : 'No efectivo'
  }
  if (['ingreso', 'ingreso_reserva', 'egreso', 'egreso_devolucion_sena', 'ingreso_apertura'].includes(tipo)) return 'Efectivo'
  if (tipo === 'ingreso_traspaso' || tipo === 'egreso_traspaso') return 'Traspaso'
  return ''
}

export interface MovimientoCaja {
  tipo: string
  concepto: string
  monto: number
}

/**
 * Acumula el neto por medio de pago a partir de la lista de movimientos. (CajaPage:480-487)
 * Ignora movimientos cuyo medio no se puede clasificar (medio vacío).
 */
export function acumularTotalesPorMetodo(movimientos: MovimientoCaja[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const m of movimientos) {
    const medio = extraerMedioPago(m.tipo, m.concepto)
    if (!medio) continue
    map[medio] = (map[medio] ?? 0) + signoMovimiento(m.tipo) * m.monto
  }
  return map
}
