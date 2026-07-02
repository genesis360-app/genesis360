// ─── Add-ons de plan (Pricing 2026, Fase 2/3) ─────────────────────────────────
// Lógica PURA de packs de add-on + serialización del external_reference que viaja
// a Mercado Pago y vuelve en el webhook. Es la fuente de verdad compartida entre la
// UI (SuscripcionPage) y los tests. Las Edge Functions (Deno) NO importan este archivo
// (módulo distinto) → mantienen una copia server-side de los packs y REVALIDAN el
// precio contra ella (nunca confían en el precio que manda el cliente).
//
// Modelo (ver G360.Wiki/wiki/business/planes-pricing.md):
//   • SKU / sucursales / usuarios → SOLO 'fijo' (recurrente, suma al preapproval MP).
//   • movimientos → 'fijo' o 'temporal' (temporal = pago único, vence a 30d del pago).
import { ADDON_PACKS } from '@/config/brand'

export type AddonDimension = 'sku' | 'movimientos' | 'sucursales' | 'usuarios'
export type AddonTipo = 'fijo' | 'temporal'

export interface AddonPack { cantidad: number; precio: number }

/** Packs disponibles para una dimensión (precio de lista, sin descuentos de plan). */
export function packsDe(dimension: AddonDimension): AddonPack[] {
  return ADDON_PACKS[dimension]?.packs ?? []
}

/** Tipos de add-on válidos para la dimensión ('fijo' y/o 'temporal'). */
export function tiposDe(dimension: AddonDimension): AddonTipo[] {
  return (ADDON_PACKS[dimension]?.tipos ?? []) as AddonTipo[]
}

/**
 * Busca un pack por dimensión + cantidad EXACTA. Devuelve null si no existe
 * (precio no confiable → no cobrar). El caller nunca debe usar un precio que no
 * salga de acá.
 */
export function findAddonPack(dimension: AddonDimension, cantidad: number): AddonPack | null {
  return packsDe(dimension).find(p => p.cantidad === cantidad) ?? null
}

/** True si la dimensión admite ese tipo de add-on (ej. sucursales NO admite 'temporal'). */
export function tipoValido(dimension: AddonDimension, tipo: AddonTipo): boolean {
  return tiposDe(dimension).includes(tipo)
}

// ─── external_reference: `${tenantId}|addon|${dimension}|${cantidad}|${tipo}` ──
// El tenantId es un UUID (sin `|`), así que el split por `|` es unívoco.

export function buildAddonRef(tenantId: string, dimension: AddonDimension, cantidad: number, tipo: AddonTipo): string {
  return `${tenantId}|addon|${dimension}|${cantidad}|${tipo}`
}

export interface ParsedAddonRef {
  tenantId: string
  dimension: AddonDimension
  cantidad: number
  tipo: AddonTipo
}

/** Parsea el external_reference nuevo. Devuelve null si no matchea el formato de add-on. */
export function parseAddonRef(ref: string): ParsedAddonRef | null {
  const parts = ref.split('|')
  if (parts.length !== 5 || parts[1] !== 'addon') return null
  const [tenantId, , dimension, cantidadStr, tipo] = parts
  const cantidad = Number(cantidadStr)
  if (!tenantId) return null
  if (!Number.isInteger(cantidad) || cantidad <= 0) return null
  if (!['sku', 'movimientos', 'sucursales', 'usuarios'].includes(dimension)) return null
  if (!['fijo', 'temporal'].includes(tipo)) return null
  return { tenantId, dimension: dimension as AddonDimension, cantidad, tipo: tipo as AddonTipo }
}

// ─── Add-ons FIJOS: precio mensual + downgrade guiado (Fase 3) ─────────────────

export interface AddonRow { dimension: AddonDimension; cantidad: number; tipo: AddonTipo }

/**
 * Precio mensual de una lista de add-ons FIJOS (se suma al precio del plan base en el
 * preapproval MP). Los temporales NO se incluyen (son pago único, no recurrente).
 * Un add-on cuya (dimension,cantidad) no matchea un pack del catálogo se ignora (precio
 * no confiable) — el cobro real lo maneja la EF contra el catálogo server-side.
 */
export function precioMensualAddonsFijos(addons: AddonRow[]): number {
  return addons
    .filter(a => a.tipo === 'fijo')
    .reduce((sum, a) => sum + (findAddonPack(a.dimension, a.cantidad)?.precio ?? 0), 0)
}

export interface DowngradeCheck {
  nuevoLimite: number    // límite efectivo tras quitar el add-on (base + add-ons restantes)
  excedente: number      // recursos ACTIVOS por encima del nuevo límite (0 = se puede bajar)
  puedeRemover: boolean  // excedente === 0
}

/**
 * Downgrade GUIADO de un add-on fijo (Decisión GO #1, REGLA #0): al quitar un add-on el
 * límite efectivo baja; si el uso actual queda por encima, el usuario debe DESACTIVAR
 * (para SKU: NO eliminar — preservar trazabilidad) `excedente` recursos ANTES de poder
 * bajar el add-on. Devuelve cuántos sobran y si ya se puede remover.
 */
export function evaluarDowngrade(params: {
  base: number                // límite base del tier (espejo de fn_plan_base_limite)
  totalAddonsActivos: number  // Σ cantidad de add-ons activos de la dimensión (incluye el que se quita)
  cantidadARemover: number    // cantidad del add-on a quitar
  usoActual: number           // recursos activos hoy (productos/usuarios/sucursales)
}): DowngradeCheck {
  const { base, totalAddonsActivos, cantidadARemover, usoActual } = params
  if (base === -1) return { nuevoLimite: -1, excedente: 0, puedeRemover: true } // ilimitado
  const nuevoLimite = base + Math.max(0, totalAddonsActivos - cantidadARemover)
  const excedente = Math.max(0, usoActual - nuevoLimite)
  return { nuevoLimite, excedente, puedeRemover: excedente === 0 }
}
