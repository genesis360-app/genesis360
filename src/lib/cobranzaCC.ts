import type { SupabaseClient } from '@supabase/supabase-js'
import { planificarCobranzaFIFO } from '@/lib/ccLogic'

/**
 * Cobranza de cuenta corriente — distribución FIFO sobre las ventas CC pendientes
 * del cliente (más antigua primero). Reusado por la ficha del cliente (ClientesPage),
 * el POS (VentasPage) y Caja (CajaPage) para que las 3 vías se comporten igual (B5).
 *
 * Nota: no genera movimiento de caja (comportamiento histórico de la cobranza por
 * ficha). El abono se acumula en `ventas.medio_pago` y reduce el saldo pendiente.
 */
export async function cobrarDeudaCCFIFO(
  supabase: SupabaseClient,
  args: { tenantId: string; clienteId: string; monto: number; metodo: string },
): Promise<{ aplicado: number; ventasSaldadas: number }> {
  const { tenantId, clienteId, monto, metodo } = args
  if (!(monto > 0)) return { aplicado: 0, ventasSaldadas: 0 }

  const { data: ventas } = await supabase
    .from('ventas')
    .select('id, total, monto_pagado, estado, medio_pago, created_at')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', clienteId)
    .eq('es_cuenta_corriente', true)
    .in('estado', ['despachada', 'facturada'])
    .order('created_at', { ascending: true })

  // Reparto FIFO puro (lógica testeable en ccLogic.ts); las ventas vienen ordenadas asc.
  const { updates, aplicado, ventasSaldadas } = planificarCobranzaFIFO(ventas ?? [], monto, metodo)

  // No tocamos `estado`: la venta CC ya está despachada/facturada; solo salda el receivable.
  for (const u of updates) {
    await supabase.from('ventas').update({
      monto_pagado: u.nuevoMontoPagado,
      medio_pago: u.nuevoMedioPago,
    }).eq('id', u.id)
  }
  return { aplicado, ventasSaldadas }
}
