// Helpers para bloqueo de CC con proveedores (v1.8.44)
// Reglas:
//   - Si el proveedor tiene OC con CC vencida (fecha_vencimiento_pago < hoy y saldo > 0) → bloqueo
//   - Si saldo_actual_cc + nuevo_monto > limite_credito_proveedor → bloqueo
//   - Solo el DUEÑO puede aprobar override (registra en autorizaciones_cc)

import { supabase } from './supabase'

export type MotivoBloqueoCC = 'limite_excedido' | 'oc_vencida'

export interface ChequeoCCResult {
  bloqueado: boolean
  motivo?: MotivoBloqueoCC
  detalle?: string
  ocsVencidas?: { id: string; numero: number; saldo: number; fecha_vencimiento_pago: string }[]
  saldoActual?: number
  limite?: number | null
}

export async function chequearBloqueoCC(proveedorId: string, montoCcNuevo: number): Promise<ChequeoCCResult> {
  // 1) Buscar OC con CC vencidas (fecha_vencimiento_pago < hoy, no pagada)
  const hoy = new Date().toISOString().split('T')[0]
  const { data: vencidas } = await supabase.from('ordenes_compra')
    .select('id, numero, monto_total, monto_pagado, monto_descuento, fecha_vencimiento_pago, estado_pago')
    .eq('proveedor_id', proveedorId)
    .lt('fecha_vencimiento_pago', hoy)
    .in('estado_pago', ['cuenta_corriente', 'pago_parcial'])

  const ocsVencidas = (vencidas ?? [])
    .map((oc: any) => ({
      id: oc.id,
      numero: oc.numero,
      saldo: Number(oc.monto_total ?? 0) - Number(oc.monto_pagado ?? 0) - Number(oc.monto_descuento ?? 0),
      fecha_vencimiento_pago: oc.fecha_vencimiento_pago,
    }))
    .filter((oc: any) => oc.saldo > 0.5)

  if (ocsVencidas.length > 0) {
    return {
      bloqueado: true,
      motivo: 'oc_vencida',
      detalle: `Hay ${ocsVencidas.length} OC con CC vencida sin pagar. Hasta que se cancelen, no se puede crear nueva CC con este proveedor.`,
      ocsVencidas,
    }
  }

  // 2) Verificar límite de CC del proveedor (si está configurado)
  const { data: prov } = await supabase.from('proveedores')
    .select('limite_credito_proveedor')
    .eq('id', proveedorId).single()
  const limite = prov?.limite_credito_proveedor != null ? Number(prov.limite_credito_proveedor) : null

  if (limite != null && limite > 0) {
    const { data: saldo } = await supabase.rpc('fn_saldo_proveedor_cc', { p_proveedor_id: proveedorId })
    const saldoActual = Number(saldo ?? 0)
    if (saldoActual + montoCcNuevo > limite) {
      return {
        bloqueado: true,
        motivo: 'limite_excedido',
        detalle: `El saldo CC actual ($${saldoActual.toLocaleString('es-AR')}) + nuevo monto ($${montoCcNuevo.toLocaleString('es-AR')}) supera el límite del proveedor ($${limite.toLocaleString('es-AR')}).`,
        saldoActual, limite,
      }
    }
  }

  return { bloqueado: false }
}

export async function existeAutorizacionCCAprobada(proveedorId: string): Promise<boolean> {
  // Aprobaciones válidas: emitidas hace < 24h y aún no usadas (gasto/oc_id nulo)
  const { data } = await supabase.from('autorizaciones_cc')
    .select('id, created_at')
    .eq('proveedor_id', proveedorId)
    .eq('estado', 'aprobada')
    .is('oc_id', null)
    .gt('resolved_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
  return (data?.length ?? 0) > 0
}
