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
