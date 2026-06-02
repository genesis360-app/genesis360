import type { SupabaseClient } from '@supabase/supabase-js'

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

  const pendientes = (ventas ?? []).filter((v: any) => (v.total ?? 0) - (v.monto_pagado ?? 0) > 0.5)

  let restante = monto
  let aplicado = 0
  let saldadas = 0
  for (const v of pendientes) {
    if (restante <= 0.5) break
    const saldo = (v.total ?? 0) - (v.monto_pagado ?? 0)
    const abono = Math.min(restante, saldo)
    const nuevoMontoPagado = (v.monto_pagado ?? 0) + abono
    let medios: any[] = []
    try { medios = JSON.parse(v.medio_pago ?? '[]') } catch { medios = [] }
    medios.push({ tipo: metodo, monto: abono })
    // No tocamos `estado`: la venta CC ya está despachada/facturada; solo salda el receivable.
    await supabase.from('ventas').update({
      monto_pagado: nuevoMontoPagado,
      medio_pago: JSON.stringify(medios),
    }).eq('id', v.id)
    restante -= abono
    aplicado += abono
    if (nuevoMontoPagado >= (v.total ?? 0) - 0.5) saldadas++
  }
  return { aplicado, ventasSaldadas: saldadas }
}
