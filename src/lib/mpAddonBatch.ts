/**
 * mpAddonBatch.ts — Lógica PURA del configurador de add-ons BATCH con cobro por delta
 * (diseño: G360.Wiki/wiki/features/configurador-addons-batch.md, decisión GO 2026-07-05).
 * La usa la UI (SuscripcionPage/PricingConfigurator) y es el ESPEJO de la decisión del EF
 * `mp-addon-batch` (que recalcula TODO server-side — REGLA #0: ningún monto viaja del cliente).
 *
 * Modelo: el usuario arma el ESTADO FINAL deseado de packs fijos (UN pack por dimensión) y
 * confirma en batch. Al confirmar:
 *   • delta > 0 → paga HOY la diferencia como pago único (checkout MP) y el recurrente pasa
 *     al total nuevo desde el próximo ciclo (lo aplica el webhook al confirmar el pago).
 *   • delta ≤ 0 → sin cobro ni reembolso: se ajusta el recurrente (PUT fail-closed) y la
 *     próxima factura llega por el monto nuevo.
 *
 * 🛑 REGLA #0:
 *   • El recurrente nuevo se calcula por DELTA sobre el monto real del preapproval
 *     (nuevo = montoActualMP − precio(packsActuales) + precio(packsObjetivo)) → un plan con
 *     descuento nunca se pisa con el precio de lista.
 *   • Guard de baja a nivel batch: el límite RESULTANTE por dimensión de estado nunca puede
 *     quedar por debajo del uso activo (desactivar antes de bajar; SKU: desactivar ≠ eliminar).
 */
import { PLAN_BASE_LIMITS } from '@/config/brand'
import { findAddonPack, type AddonDimension, type AddonRow } from './addons'

/** Dimensiones de add-on FIJO del panel batch (comprobantes es flujo: sin guard de baja). */
export const DIMS_BATCH: AddonDimension[] = ['sku', 'sucursales', 'usuarios', 'comprobantes']
/** Dimensiones de ESTADO (con guard de baja contra el uso activo). */
export const DIMS_ESTADO: AddonDimension[] = ['sku', 'sucursales', 'usuarios']

/** Selección de packs: cantidad elegida por dimensión (ausente/0 = sin pack). */
export type PackSel = Partial<Record<AddonDimension, number>>

/** Estado actual de packs FIJOS a partir de las filas de tenant_addons (un pack por dim). */
export function selDesdeAddons(rows: AddonRow[]): PackSel {
  const sel: PackSel = {}
  for (const r of rows) {
    if (r.tipo !== 'fijo') continue
    sel[r.dimension] = r.cantidad // uq(tenant,dimension) WHERE tipo='fijo' garantiza 1 fila
  }
  return sel
}

/** Precio mensual de una selección (packs del catálogo; pack inexistente = 0, no confiable). */
export function precioSel(sel: PackSel): number {
  return Object.entries(sel).reduce((sum, [dim, cant]) =>
    sum + (cant ? (findAddonPack(dim as AddonDimension, cant)?.precio ?? 0) : 0), 0)
}

/**
 * Cambio de PLAN dentro del batch (Fase 2, spec GO 2026-07-07). Los precios de plan son
 * los REALES de los planes de MP (GET /preapproval_plan — canal automático con −10%), no
 * los de lista de brand.ts: así el delta de plan tampoco pisa descuentos del canal.
 */
export interface PlanCambio {
  tierActual: string
  tierObjetivo: string
  /** auto_recurring.transaction_amount del plan MP del tier actual. */
  precioPlanActualMP: number
  /** auto_recurring.transaction_amount del plan MP del tier objetivo. */
  precioPlanObjetivoMP: number
}

/** Fase 2 solo permite UPGRADE Básico→Pro (el downgrade se diseña con MP-P2). */
export function esUpgradeDePlan(tierActual: string, tierObjetivo: string): boolean {
  return tierActual === 'basico' && tierObjetivo === 'pro'
}

export interface BatchCalculo {
  /** Recurrente mensual nuevo (lo que va a llegar todos los meses de ahora en más). */
  recurrenteNuevo: number
  /** Lo que paga HOY (pago único). 0 si el batch baja o no cambia el monto. */
  deltaAPagar: number
  /** true si el batch no cambia nada (selección idéntica y sin cambio de plan). */
  sinCambios: boolean
  /** true si el batch incluye cambio de plan (habilita la elección E1/E2). */
  cambiaPlan: boolean
}

/**
 * Cálculo del batch por DELTA sobre el monto real del preapproval (preserva descuentos).
 * `montoActualMP` = auto_recurring.transaction_amount actual (GET al preapproval).
 * Con `plan`: nuevo = montoActual − packs(actuales) + packs(objetivo) + (planMP(objetivo)
 * − planMP(actual)) — el término de plan es relativo, así un descuento custom (monto
 * puesteado a mano) se conserva como diferencia absoluta.
 */
export function calcularBatch(p: {
  montoActualMP: number
  packsActuales: PackSel
  packsObjetivo: PackSel
  plan?: PlanCambio | null
}): BatchCalculo {
  const actual = precioSel(p.packsActuales)
  const objetivo = precioSel(p.packsObjetivo)
  const cambiaPlan = !!p.plan && p.plan.tierObjetivo !== p.plan.tierActual
  const deltaPlan = cambiaPlan ? p.plan!.precioPlanObjetivoMP - p.plan!.precioPlanActualMP : 0
  const recurrenteNuevo = Math.max(0, p.montoActualMP - actual + objetivo + deltaPlan)
  const delta = recurrenteNuevo - p.montoActualMP
  const sinCambios = !cambiaPlan &&
    DIMS_BATCH.every(d => (p.packsActuales[d] ?? 0) === (p.packsObjetivo[d] ?? 0))
  return {
    recurrenteNuevo,
    deltaAPagar: delta > 0 ? delta : 0, // baja = sin cobro ni reembolso (próxima factura menor)
    sinCambios,
    cambiaPlan,
  }
}

export interface BatchBloqueo {
  dimension: AddonDimension
  nuevoLimite: number
  uso: number
  excedente: number // cuántos recursos debe DESACTIVAR para poder confirmar
}

/**
 * Guard de baja a nivel BATCH (ejemplo GO: 2.001 SKUs con Básico 2.000 → quitar el pack
 * +2.000 se bloquea; cambiarlo por +500 [límite 2.500] se permite). Devuelve TODAS las
 * dimensiones en falta (lista vacía = batch permitido). Con cambio de plan, `tier` es el
 * tier RESULTANTE del batch (Fase 2 solo permite upgrades → la base solo crece).
 */
export function guardBatch(p: {
  tier: string
  packsObjetivo: PackSel
  uso: { sku: number; sucursales: number; usuarios: number }
}): BatchBloqueo[] {
  const base = PLAN_BASE_LIMITS[p.tier] ?? PLAN_BASE_LIMITS['free']
  const bloqueos: BatchBloqueo[] = []
  for (const dim of DIMS_ESTADO) {
    const b = base[dim as 'sku' | 'sucursales' | 'usuarios']
    if (b === -1) continue // ilimitado
    const nuevoLimite = b + (p.packsObjetivo[dim] ?? 0)
    const uso = p.uso[dim as 'sku' | 'sucursales' | 'usuarios']
    if (uso > nuevoLimite) {
      bloqueos.push({ dimension: dim, nuevoLimite, uso, excedente: uso - nuevoLimite })
    }
  }
  return bloqueos
}

// ─── E2: upgrade PROGRAMADO — espejo de la decisión del sweep (EF mp-batch-sweep) ────────
// El change queda 'programado' hasta la ventana previa al próximo cobro; ahí el sweep hace
// el PUT del monto nuevo ('esperando_cobro') para que ESE cobro ya salga por el plan nuevo.
// El tier se habilita recién al confirmarse el cobro (fail-closed). La fecha nunca cambia.

/** Horas antes del cobro en las que el sweep (horario) hace el PUT del monto nuevo. */
export const SWEEP_VENTANA_HORAS = 36
/** Días de espera del cobro antes de marcar el change como fallido y alertar a soporte. */
export const SWEEP_TIMEOUT_DIAS = 7

export type DecisionProgramado = 'esperar' | 'put' | 'vencido'

/** Fase 'programado': ¿ya entramos en la ventana previa al cobro para hacer el PUT? */
export function decidirSweepProgramado(p: {
  programadoPara: string | Date
  now?: Date
  ventanaHoras?: number
}): DecisionProgramado {
  const now = p.now ?? new Date()
  const objetivo = new Date(p.programadoPara).getTime()
  if (Number.isNaN(objetivo)) return 'vencido' // fecha corrupta → a conciliación humana
  const ventanaMs = (p.ventanaHoras ?? SWEEP_VENTANA_HORAS) * 3600_000
  // Muy pasado de fecha sin haberse procesado (sweep caído) → alertar, no PUTear a ciegas
  if (now.getTime() > objetivo + SWEEP_TIMEOUT_DIAS * 86400_000) return 'vencido'
  return now.getTime() >= objetivo - ventanaMs ? 'put' : 'esperar'
}

export type DecisionCobro = 'aplicar' | 'esperar' | 'fallido'

/**
 * Fase 'esperando_cobro': el tier se habilita SOLO si el cobro del ciclo salió por el
 * monto NUEVO y está aprobado (REGLA #0: si el cobro falla, no se habilita nada).
 *  • preapproval cancelado/pausado sin cobro → 'fallido' (alerta a soporte).
 *  • cobro aprobado por el monto nuevo → 'aplicar'.
 *  • todavía sin cobro aprobado → 'esperar' (MP reintenta; timeout → 'fallido').
 */
export function decidirConfirmacionCobro(p: {
  preapprovalStatus: string
  cobroAprobadoMonto: number | null   // monto del cobro aprobado del ciclo (null = no hubo)
  montoEsperado: number
  programadoPara: string | Date
  now?: Date
  timeoutDias?: number
}): DecisionCobro {
  const now = p.now ?? new Date()
  if (p.cobroAprobadoMonto !== null && p.cobroAprobadoMonto >= p.montoEsperado) return 'aplicar'
  if (p.preapprovalStatus === 'cancelled') return 'fallido'
  const limite = new Date(p.programadoPara).getTime() + (p.timeoutDias ?? SWEEP_TIMEOUT_DIAS) * 86400_000
  if (Number.isNaN(limite) || now.getTime() > limite) return 'fallido'
  return 'esperar'
}
