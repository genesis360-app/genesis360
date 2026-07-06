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

export interface BatchCalculo {
  /** Recurrente mensual nuevo (lo que va a llegar todos los meses de ahora en más). */
  recurrenteNuevo: number
  /** Lo que paga HOY (pago único). 0 si el batch baja o no cambia el monto. */
  deltaAPagar: number
  /** true si el batch no cambia nada (selección idéntica). */
  sinCambios: boolean
}

/**
 * Cálculo del batch por DELTA sobre el monto real del preapproval (preserva descuentos).
 * `montoActualMP` = auto_recurring.transaction_amount actual (GET al preapproval).
 */
export function calcularBatch(p: {
  montoActualMP: number
  packsActuales: PackSel
  packsObjetivo: PackSel
}): BatchCalculo {
  const actual = precioSel(p.packsActuales)
  const objetivo = precioSel(p.packsObjetivo)
  const recurrenteNuevo = Math.max(0, p.montoActualMP - actual + objetivo)
  const delta = recurrenteNuevo - p.montoActualMP
  const sinCambios = DIMS_BATCH.every(d => (p.packsActuales[d] ?? 0) === (p.packsObjetivo[d] ?? 0))
  return {
    recurrenteNuevo,
    deltaAPagar: delta > 0 ? delta : 0, // baja = sin cobro ni reembolso (próxima factura menor)
    sinCambios,
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
 * dimensiones en falta (lista vacía = batch permitido).
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
