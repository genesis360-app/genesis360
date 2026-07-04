/**
 * mpAddonFijo.ts — ESPEJO PURO del contrato del EF `mp-addon-fijo` (Deno): alta/baja de
 * add-ons FIJOS que cambian el monto recurrente de la suscripción MP (PUT delta sobre el
 * preapproval). Patrón ccLogic: mirror de la DECISIÓN, el I/O (fetch a MP, insert/delete
 * en DB) lo hace el EF y acá llega como observaciones ya resueltas.
 *
 * 🛑 REGLA #0 (plata) — garantías que este contrato fija (UAT MP-AD2/AD3/AD4/AD6):
 *   • El precio SIEMPRE sale del catálogo (`findAddonPack`); pack inexistente → no se cobra.
 *   • ALTA fail-closed: si el PUT a MP falla, NO se otorga el add-on (nada de upgrade gratis).
 *   • ALTA con insert fallido tras PUT exitoso → hay que REVERTIR el monto en MP (si no, el
 *     cliente paga de más sin add-on registrado).
 *   • BAJA fail-closed: si el PUT falla, NO se quita el add-on (el monto en MP no bajó).
 *   • El delta preserva el descuento del plan base (se opera sobre el monto ACTUAL de MP,
 *     nunca se recalcula desde el precio de lista).
 *
 * Este módulo es un mirror; si cambia el EF, actualizar acá + los tests EN EL MISMO cambio.
 */
import { findAddonPack, tipoValido, type AddonDimension } from './addons'

// ─── ALTA ──────────────────────────────────────────────────────────────────────

export type AltaFijoError =
  | 'sin_suscripcion_activa' // tenant sin mp_subscription_id o status !== 'active' → 400
  | 'monto_invalido'         // el GET del preapproval no dio un monto > 0 → 502
  | 'pack_invalido'          // dimensión/cantidad fuera del catálogo de fijos → 400
  | 'mp_put_fallo'           // MP no confirmó el nuevo monto → 502, NO otorgar
  | 'insert_fallo'           // MP ya cobra el nuevo monto pero la DB no registró → revertir

export interface AltaFijoResultado {
  otorgado: boolean
  /** Monto que quedó (o debería quedar) cobrando MP tras la operación. */
  nuevoMonto: number | null
  /** true → el caller DEBE intentar volver el monto de MP a `montoActual` (MP-AD4). */
  revertirMontoEnMP: boolean
  error: AltaFijoError | null
}

export function evaluarAltaAddonFijo(p: {
  subscriptionActiva: boolean
  tienePreapproval: boolean
  dimension: string
  cantidad: number
  /** auto_recurring.transaction_amount actual del preapproval (0/NaN si el GET falló). */
  montoActual: number
  putOk: boolean
  insertOk: boolean
}): AltaFijoResultado {
  const rechazo = (error: AltaFijoError): AltaFijoResultado =>
    ({ otorgado: false, nuevoMonto: null, revertirMontoEnMP: false, error })

  if (!p.tienePreapproval || !p.subscriptionActiva) return rechazo('sin_suscripcion_activa')
  if (!(p.montoActual > 0)) return rechazo('monto_invalido')

  const dim = p.dimension as AddonDimension
  const pack = tipoValido(dim, 'fijo') ? findAddonPack(dim, p.cantidad) : null
  if (!pack) return rechazo('pack_invalido')

  const nuevoMonto = p.montoActual + pack.precio
  // Fail-closed: MP tiene que confirmar el nuevo monto ANTES de otorgar (MP-AD3).
  if (!p.putOk) return rechazo('mp_put_fallo')
  if (!p.insertOk) {
    // MP ya cobra de más y la DB no registró el add-on → revertir (MP-AD4).
    return { otorgado: false, nuevoMonto: p.montoActual, revertirMontoEnMP: true, error: 'insert_fallo' }
  }
  return { otorgado: true, nuevoMonto, revertirMontoEnMP: false, error: null }
}

// ─── BAJA ──────────────────────────────────────────────────────────────────────

export type BajaFijoError =
  | 'sin_suscripcion_activa'
  | 'monto_invalido'
  | 'addon_no_encontrado'    // no existe / no es del tenant / no es tipo 'fijo' → 404
  | 'mp_put_fallo'           // MP no confirmó el monto bajado → 502, NO quitar
  | 'delete_fallo'           // MP ya cobra menos pero la fila no se borró → drift a conciliar

export interface BajaFijoResultado {
  quitado: boolean
  nuevoMonto: number | null
  /** Downgrade guiado: el uso actual excede el límite sin este add-on (MP-AD5). No es error. */
  blocked: { excedente: number; nuevoLimite: number; uso: number } | null
  error: BajaFijoError | null
}

export function evaluarBajaAddonFijo(p: {
  subscriptionActiva: boolean
  tienePreapproval: boolean
  addonEncontrado: boolean
  addonTipo: string | null
  dimension: string
  cantidad: number
  /**
   * Límite EFECTIVO de la dimensión (fn_tenant_limite, INCLUYE el add-on a quitar).
   * -1 = ilimitado. null = dimensión sin guard de estado (movimientos: tope soft de flujo).
   */
  limiteEfectivo: number | null
  /** Recursos ACTIVOS del tenant en esa dimensión (solo si hay guard). */
  uso: number
  montoActual: number
  putOk: boolean
  deleteOk: boolean
}): BajaFijoResultado {
  const rechazo = (error: BajaFijoError): BajaFijoResultado =>
    ({ quitado: false, nuevoMonto: null, blocked: null, error })

  if (!p.tienePreapproval || !p.subscriptionActiva) return rechazo('sin_suscripcion_activa')
  if (!(p.montoActual > 0)) return rechazo('monto_invalido')
  if (!p.addonEncontrado || p.addonTipo !== 'fijo') return rechazo('addon_no_encontrado')

  // Guard de downgrade guiado (solo dimensiones de ESTADO; -1 = ilimitado no bloquea).
  if (p.limiteEfectivo !== null && p.limiteEfectivo !== -1) {
    const nuevoLimite = p.limiteEfectivo - p.cantidad
    if (p.uso > nuevoLimite) {
      return {
        quitado: false, nuevoMonto: null, error: null,
        blocked: { excedente: p.uso - nuevoLimite, nuevoLimite, uso: p.uso },
      }
    }
  }

  // El precio sale del catálogo; si el pack ya no existe (catálogo cambió), precio 0:
  // se quita el add-on sin bajar el monto (espejo del `pack?.precio ?? 0` del EF).
  const dim = p.dimension as AddonDimension
  const precio = findAddonPack(dim, p.cantidad)?.precio ?? 0
  const nuevoMonto = Math.max(0, p.montoActual - precio)

  if (!p.putOk) return rechazo('mp_put_fallo')
  if (!p.deleteOk) {
    // MP ya bajó el monto pero la fila sigue → favorable al cliente pero es drift (soporte).
    return { quitado: false, nuevoMonto, blocked: null, error: 'delete_fallo' }
  }
  return { quitado: true, nuevoMonto, blocked: null, error: null }
}
