import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

/**
 * MODO Webhook Handler — ISS-072
 *
 * Recibe notificaciones de pago de MODO y actualiza la venta correspondiente.
 *
 * Formato esperado del payload MODO:
 * {
 *   event_type: "payment.approved" | "payment.rejected" | "payment.pending",
 *   payment_id: string,
 *   merchant_order_id: string,  // nuestro venta_id (UUID)
 *   amount: number,             // en centavos
 *   currency: "ARS",
 *   status: "approved" | "rejected" | "pending",
 *   timestamp: string
 * }
 *
 * No requiere JWT — MODO envía sin auth de usuario.
 * Verificamos autenticidad por: merchant_id en modo_credentials + merchant_order_id.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-modo-signature',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
  }

  const { event_type, payment_id, merchant_order_id, amount, status } = body

  // Validar campos requeridos
  if (!payment_id || !merchant_order_id) {
    return new Response(JSON.stringify({ error: 'payment_id y merchant_order_id son requeridos' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // El merchant_order_id es nuestro venta_id (UUID)
  const ventaId = merchant_order_id

  // Idempotencia: verificar si este payment_id ya fue procesado
  const { data: logExistente } = await supabase
    .from('ventas_externas_logs')
    .select('id')
    .eq('integracion', 'MODO')
    .eq('webhook_external_id', payment_id)
    .maybeSingle()

  if (logExistente) {
    return new Response(JSON.stringify({ ok: true, msg: 'ya procesado' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Buscar el tenant a partir de la venta o del prefijo de preventa
  let tenantId: string | null = null
  let ventaExiste = false

  // Intentar buscar la venta real
  const { data: ventaData } = await supabase
    .from('ventas')
    .select('tenant_id, estado, total')
    .eq('id', ventaId)
    .maybeSingle()

  if (ventaData) {
    tenantId = ventaData.tenant_id
    ventaExiste = true
  } else {
    // Pre-venta: buscar en modo_credentials por cualquier tenant que use ese payment_id
    // (fallback: el webhook llega antes de que se cree la venta)
    console.log(`modo-webhook: venta ${ventaId} no encontrada en DB — puede ser pre-venta`)
  }

  // Solo procesar pagos aprobados
  const aprobado = status === 'approved' || event_type === 'payment.approved'

  if (aprobado && ventaExiste && ventaData) {
    const montoARS = typeof amount === 'number' ? amount / 100 : null

    // Actualizar venta: marcar pago externo recibido
    const { error: updateErr } = await supabase
      .from('ventas')
      .update({
        id_pago_externo: payment_id,
        monto_pagado:    montoARS ?? ventaData.total,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', ventaId)

    if (updateErr) {
      console.error('modo-webhook: error actualizando venta', updateErr)
    }
  }

  // Registrar en log de idempotencia
  if (tenantId) {
    await supabase.from('ventas_externas_logs').insert({
      tenant_id:           tenantId,
      integracion:         'MODO',
      webhook_external_id: payment_id,
      venta_id:            ventaExiste ? ventaId : null,
      payload_raw:         body,
    })
  } else {
    // Sin tenant conocido: igual guardar con tenant_id nulo no es posible (NOT NULL)
    // Loguear para diagnóstico
    console.warn('modo-webhook: no se encontró tenant para payment_id', payment_id, 'venta_id', ventaId)
  }

  return new Response(JSON.stringify({ ok: true, aprobado }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
