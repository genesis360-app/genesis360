// Lógica pura de resolución del EMISOR FISCAL (multi-CUIT, F5 Fase 2 — REGLA #0).
//
// Es el ESPEJO testeable de la resolución que hace la EF `emitir-factura`:
//   emisor de una FACTURA = override del body ?? emisor de la sucursal ?? default del tenant
//   emisor de una NC      = SIEMPRE el de la factura original (cruzar de CUIT = comprobante
//                           inválido ante AFIP → 400 si el body manda otro)
// más la elección del certificado (por emisor, con fallback a la fila legacy sin emisor)
// y la validación del punto de venta (los PV de AFIP son POR CUIT).
//
// ⚠ Mantener sincronizado con: supabase/functions/emitir-factura/index.ts
// Diseño completo: G360.Wiki/wiki/features/multi-cuit.md

export interface ResolucionEmisorInput {
  esNC: boolean
  /** emisor_id del body (override explícito del modal). */
  bodyEmisorId?: string | null
  /** ventas.emisor_id de la factura original (solo relevante para NC). */
  ventaEmisorId?: string | null
  /** sucursales.emisor_fiscal_id de la sucursal de la venta. */
  sucursalEmisorId?: string | null
  /** id del emisor default del tenant (es_default = true). */
  defaultEmisorId?: string | null
}

export interface ResolucionEmisor {
  emisorId: string | null
  /** Mensaje de rechazo (400) — solo cuando la combinación es inválida. */
  error?: string
}

/**
 * Resuelve QUÉ emisor emite el comprobante. Devuelve error (→ 400) si una NC intenta
 * emitirse con un emisor distinto al de su factura original.
 */
export function resolverEmisorId(i: ResolucionEmisorInput): ResolucionEmisor {
  if (i.esNC && i.ventaEmisorId) {
    if (i.bodyEmisorId && i.bodyEmisorId !== i.ventaEmisorId) {
      return {
        emisorId: null,
        error: 'La Nota de Crédito debe emitirse con el mismo emisor (CUIT) que la factura original.',
      }
    }
    return { emisorId: i.ventaEmisorId }
  }
  return { emisorId: i.bodyEmisorId ?? i.sucursalEmisorId ?? i.defaultEmisorId ?? null }
}

export interface CertRowLike {
  cert_crt_path: string
  cert_key_path: string
  emisor_id?: string | null
}

/**
 * Elige el certificado del emisor entre los certificados ACTIVOS del tenant:
 * primero el propio del emisor; si no hay, la fila legacy sin emisor (pre-mig 267).
 */
export function elegirCertificado<T extends CertRowLike>(
  certRows: T[] | null | undefined,
  emisorId: string | null,
): T | null {
  const rows = certRows ?? []
  return rows.find(c => !!emisorId && c.emisor_id === emisorId)
    ?? rows.find(c => !c.emisor_id)
    ?? null
}

// ─── Identidad del emisor para COMPROBANTES (cutover mig 271 — fuente única) ────────────
// Desde v1.133.0 los PDFs (factura/NC/presupuesto/remito) leen la identidad fiscal de
// `emisores_fiscales`, NUNCA de `tenants.*` (que quedó como espejo de solo-lectura legacy).
// El bug que esto arregla: con multi-CUIT, el CAE sale con el CUIT del EMISOR de la venta
// pero el papel imprimía el del tenant → un comprobante que no coincide con AFIP.

export interface IdentidadEmisor {
  id: string
  cuit: string
  razon_social_fiscal: string | null
  condicion_iva_emisor: string | null
  domicilio_fiscal: string | null
  ingresos_brutos: string | null
  inicio_actividades: string | null
  banco: string | null
  cbu: string | null
  alias_cbu: string | null
  leyenda_comprobante: string | null
  logo_url: string | null
  es_default: boolean
  activo: boolean
}

/** Columnas a seleccionar de `emisores_fiscales` para armar un comprobante. */
export const IDENTIDAD_EMISOR_COLS =
  'id, cuit, razon_social_fiscal, condicion_iva_emisor, domicilio_fiscal, ingresos_brutos, ' +
  'inicio_actividades, banco, cbu, alias_cbu, leyenda_comprobante, logo_url, es_default, activo'

/**
 * Elige QUÉ identidad imprime el comprobante: emisor de la VENTA ?? emisor de la sucursal ??
 * default del tenant (la misma cadena que `resolverEmisorId`, sobre filas ya traídas).
 *
 * ⚠ A PROPÓSITO no filtra `activo`: un comprobante emitido por un emisor luego desactivado
 * debe seguir imprimiendo LA IDENTIDAD QUE LO EMITIÓ (regla #7: el registro fiscal histórico
 * no se juzga contra la configuración actual). Solo el fallback a default exige el vigente.
 */
export function elegirIdentidadEmisor<T extends { id: string; es_default: boolean }>(
  emisores: T[] | null | undefined,
  opts: { ventaEmisorId?: string | null; sucursalEmisorId?: string | null } = {},
): T | null {
  const rows = emisores ?? []
  const porId = (id?: string | null) => (id ? rows.find(e => e.id === id) ?? null : null)
  return porId(opts.ventaEmisorId) ?? porId(opts.sucursalEmisorId) ?? rows.find(e => e.es_default) ?? null
}

/**
 * Punto de venta a IMPRIMIR en el comprobante: el primero configurado DEL EMISOR (las filas
 * legacy sin emisor cuentan como del default). Devuelve null si el emisor no tiene ninguno
 * (el caller decide el fallback — hoy 1, el comportamiento legacy).
 * Antes el PDF hacía `limit(1)` sobre TODOS los PV del tenant → en multi-CUIT podía imprimir
 * el PV de OTRO CUIT (los PV de AFIP son por CUIT).
 */
export function puntoVentaDelEmisor(
  pvRows: PvRowLike[] | null | undefined,
  emisorId: string | null,
  esDefault: boolean,
): number | null {
  const delEmisor = (pvRows ?? [])
    .filter(p => (!!emisorId && p.emisor_id === emisorId) || (esDefault && !p.emisor_id))
    .sort((a, b) => Number(a.numero) - Number(b.numero))
  return delEmisor.length ? Number(delEmisor[0].numero) : null
}

export interface PvRowLike {
  numero: number | string
  emisor_id?: string | null
}

/**
 * Valida el punto de venta contra los PV configurados DEL EMISOR (las filas legacy sin
 * emisor cuentan como del emisor default). Si el emisor no tiene ningún PV configurado,
 * se permite cualquier número (comportamiento legacy: el default era PV 1 sin config).
 */
export function validarPuntoVenta(
  pvRows: PvRowLike[] | null | undefined,
  emisorId: string | null,
  esDefault: boolean,
  puntoVenta: number,
): { ok: boolean; error?: string } {
  const delEmisor = (pvRows ?? []).filter(
    p => (!!emisorId && p.emisor_id === emisorId) || (esDefault && !p.emisor_id),
  )
  if (delEmisor.length === 0) return { ok: true }
  if (delEmisor.some(p => Number(p.numero) === Number(puntoVenta))) return { ok: true }
  return {
    ok: false,
    error: `El punto de venta ${puntoVenta} no está configurado para este emisor (los puntos de venta de AFIP son por CUIT).`,
  }
}
