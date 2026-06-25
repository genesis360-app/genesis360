import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// EF mp-ipn — recibe notificaciones IPN de MercadoPago para pagos regulares
// (distinto de mp-webhook que maneja suscripciones/preapproval)
//
// Flujo:
//   MP envía POST { action: "payment.updated", data: { id }, user_id }
//   1. Buscar credencial por seller_id = user_id
//   2. Verificar pago en MP API con access_token del vendedor
//   3. Buscar venta por external_reference (= venta_id UUID)
//   4. Actualizar venta: id_pago_externo + money_release_date
//   5. Log idempotencia en ventas_externas_logs
//
// Registro en MP Developers: configurar URL de notificaciones apuntando a esta EF
// PROD: https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-ipn

const MP_API_BASE = 'https://api.mercadopago.com'

/**
 * Asienta un ingreso_informativo en caja por un cobro MP de una venta existente.
 * Espejo de mp-webhook: no afecta el efectivo (informativo, para el arqueo); requiere
 * una caja OPERATIVA abierta de la sucursal (excluye la Bóveda). Sin caja → no asienta
 * pero el saldo de la venta queda conciliado igual.
 */
async function asentarIngresoInformativoMp(
  supabase: any,
  tenantId: string,
  venta: { id: string; sucursal_id: string | null; numero: number | null },
  monto: number,
): Promise<void> {
  if (!(monto > 0.01)) return
  let q = supabase.from('caja_sesiones')
    .select('id, cajas(es_caja_fuerte)')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierta')
  if (venta.sucursal_id) q = q.eq('sucursal_id', venta.sucursal_id)
  const { data: sesiones } = await q
  const operativas = (sesiones ?? []).filter((s: any) => !s.cajas?.es_caja_fuerte)
  const sesionId = operativas[0]?.id
  if (!sesionId) {
    console.warn(`mp-ipn: sin caja operativa abierta para venta ${venta.id} — ingreso informativo NO asentado`)
    return
  }
  const { error } = await supabase.from('caja_movimientos').insert({
    tenant_id: tenantId,
    sesion_id: sesionId,
    tipo:      'ingreso_informativo',
    concepto:  `[Mercado Pago] Venta #${venta.numero ?? ''}`.trim(),
    monto,
  })
  if (error) console.error('mp-ipn: error asentando ingreso_informativo en caja', error)
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: { action?: string; data?: { id?: string | number }; user_id?: number }
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { action, data, user_id } = payload

  // Solo procesamos eventos de pago
  if (!action?.startsWith('payment.')) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: 'not a payment event' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const paymentId = data?.id
  if (!paymentId) {
    return new Response('Missing payment id', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Buscar credencial MP por seller_id
  const query = supabase
    .from('mercadopago_credentials')
    .select('tenant_id, sucursal_id, access_token')
    .eq('conectado', true)

  const { data: cred, error: credErr } = user_id
    ? await query.eq('seller_id', user_id).maybeSingle()
    : await query.limit(1).maybeSingle()

  if (credErr || !cred) {
    console.error('MP credential not found for seller_id:', user_id, credErr?.message)
    return new Response('Credential not found', { status: 404 })
  }

  const { tenant_id, access_token } = cred

  // 2. Idempotencia — un payment_id solo se procesa una vez
  const webhookKey = `mp-payment-${paymentId}`
  const { data: existingLog } = await supabase
    .from('ventas_externas_logs')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('integracion', 'MercadoPago')
    .eq('webhook_external_id', webhookKey)
    .maybeSingle()

  if (existingLog) {
    console.log('Duplicate MP IPN ignored:', webhookKey)
    return new Response(
      JSON.stringify({ ok: true, duplicate: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3. Verificar pago en MP API
  const mpRes = await fetch(`${MP_API_BASE}/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${access_token}` },
  })

  if (!mpRes.ok) {
    const errText = await mpRes.text()
    console.error('Error fetching MP payment:', errText)
    return new Response('Error fetching payment from MercadoPago', { status: 502 })
  }

  const payment = await mpRes.json()

  console.log(`MP payment ${paymentId}: status=${payment.status}, external_ref=${payment.external_reference}`)

  // 4. Buscar venta por external_reference (= venta_id UUID generado por Genesis360)
  const externalRef: string | null = payment.external_reference ?? null
  const ventaCols = 'id, total, monto_pagado, estado, numero, sucursal_id'
  let venta: any = null

  if (externalRef) {
    // Intentar match por venta_id directo
    const { data: ventaById } = await supabase
      .from('ventas')
      .select(ventaCols)
      .eq('tenant_id', tenant_id)
      .eq('id', externalRef)
      .maybeSingle()

    if (ventaById) {
      venta = ventaById
    } else {
      // Fallback: match por tracking_id (número de venta o referencia externa)
      const { data: ventaByTracking } = await supabase
        .from('ventas')
        .select(ventaCols)
        .eq('tenant_id', tenant_id)
        .eq('tracking_id', externalRef)
        .maybeSingle()

      venta = ventaByTracking ?? null
    }
  }
  const ventaId: string | null = venta?.id ?? null

  // 5. Conciliar venta si se encontró y el pago fue aprobado (saldo + caja informativa)
  const monto = Number(payment.transaction_amount ?? 0)
  const releaseDate = payment.money_release_date
    ? new Date(payment.money_release_date).toISOString()
    : null
  if (venta && payment.status === 'approved') {
    const montoNuevo = Math.min((venta.monto_pagado ?? 0) + monto, venta.total ?? 0)
    const { error: updateErr } = await supabase
      .from('ventas')
      .update({
        id_pago_externo:    String(paymentId),
        money_release_date: releaseDate,
        monto_pagado:       montoNuevo,
      })
      .eq('id', venta.id)
      .eq('tenant_id', tenant_id)

    if (updateErr) {
      console.error('Error updating venta:', updateErr.message)
    } else {
      console.log(`Venta ${venta.id} conciliada con pago MP ${paymentId} (monto_pagado → ${montoNuevo})`)
      await asentarIngresoInformativoMp(supabase, tenant_id, venta, monto)
    }
  }

  // 6. Log de idempotencia (siempre, incluso si no se encontró venta) — payload_raw normalizado
  //    con `monto` para que el toast global (AppLayout) lo muestre.
  await supabase.from('ventas_externas_logs').insert({
    tenant_id,
    integracion:         'MercadoPago',
    webhook_external_id: webhookKey,
    venta_id:            ventaId,
    payload_raw:         { payment_id: paymentId, monto, venta_id: ventaId, status: payment.status, money_release_date: releaseDate },
  })

  return new Response(
    JSON.stringify({
      ok:        true,
      paymentId: String(paymentId),
      status:    payment.status,
      ventaId:   ventaId ?? null,
      matched:   ventaId !== null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
