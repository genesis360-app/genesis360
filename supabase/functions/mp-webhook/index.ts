import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
}

// Límites por plan MP (preapproval_plan_id → límites)
const MP_PLAN_LIMITS: Record<string, { max_users: number; max_productos: number }> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: { max_users: 2,  max_productos: 500 },
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: { max_users: 10, max_productos: 5000 },
}

/**
 * Asienta un ingreso_informativo en caja por un cobro MP de una venta YA existente
 * (reserva/saldo cobrado por QR/link). No afecta el saldo de efectivo (es informativo,
 * para el arqueo). Requiere una sesión de caja OPERATIVA abierta (excluye la Bóveda).
 * REGLA #0: si no hay caja abierta, no se asienta (no se puede contra una caja cerrada)
 * pero se loguea para conciliación manual; el saldo de la venta SÍ queda conciliado.
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
  // Excluir la Bóveda/Caja Fuerte (igual que el POS) — solo cajas operativas
  const operativas = (sesiones ?? []).filter((s: any) => !s.cajas?.es_caja_fuerte)
  const sesionId = operativas[0]?.id
  if (!sesionId) {
    console.warn(`mp-webhook: sin caja operativa abierta para venta ${venta.id} (sucursal ${venta.sucursal_id ?? 'NULL'}) — ingreso informativo NO asentado (saldo de venta SÍ conciliado)`)
    return
  }
  const { error } = await supabase.from('caja_movimientos').insert({
    tenant_id:  tenantId,
    sesion_id:  sesionId,
    tipo:       'ingreso_informativo',
    concepto:   `[Mercado Pago] Venta #${venta.numero ?? ''}`.trim(),
    monto,
  })
  if (error) console.error('mp-webhook: error asentando ingreso_informativo en caja', error)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const body = await req.text()
    const event = JSON.parse(body)

    console.log('MP Webhook received:', event.type, event.data?.id, 'user_id:', event.user_id)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    const { type, data } = event

    // ── Suscripciones ────────────────────────────────────────────────────────
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const subscriptionId = data?.id
      if (!subscriptionId) throw new Error('No subscription id')

      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      })
      const subscription = await mpRes.json()
      console.log('Subscription status:', subscription.status, 'plan:', subscription.preapproval_plan_id)

      let newStatus: string
      switch (subscription.status) {
        case 'authorized': newStatus = 'active'; break
        case 'cancelled':  newStatus = 'cancelled'; break
        case 'paused':     newStatus = 'inactive'; break
        case 'pending':    newStatus = 'trial'; break
        default:           newStatus = 'inactive'
      }

      const tenantId = subscription.external_reference
      if (tenantId) {
        const planLimits = MP_PLAN_LIMITS[subscription.preapproval_plan_id] ?? {}
        await supabase.from('tenants').update({
          subscription_status: newStatus,
          mp_subscription_id: subscriptionId,
          ...(newStatus === 'active' && planLimits.max_users ? {
            max_users: planLimits.max_users,
            max_productos: planLimits.max_productos,
          } : {}),
        }).eq('id', tenantId)
        console.log(`Tenant ${tenantId} → ${newStatus}`, planLimits)
      }
    }

    // ── Pagos ────────────────────────────────────────────────────────────────
    if (type === 'payment') {
      const paymentId = data?.id
      if (!paymentId) throw new Error('No payment id')

      // Determinar si es pago de un seller conectado (venta) o de plataforma
      const sellerId: number | undefined = event.user_id
      let sellerCred: { tenant_id: string; access_token: string } | null = null

      if (sellerId) {
        const { data: sc } = await supabase
          .from('mercadopago_credentials')
          .select('tenant_id, access_token')
          .eq('seller_id', String(sellerId))
          .eq('conectado', true)
          .maybeSingle()
        sellerCred = sc ?? null
      }

      const tokenToUse = sellerCred?.access_token ?? mpToken
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      })
      const payment = await mpRes.json()
      console.log('Payment status:', payment.status, 'ref:', payment.external_reference, 'seller:', !!sellerCred)

      if (payment.status === 'approved' && payment.external_reference) {
        const ref: string = payment.external_reference

        if (sellerCred) {
          // ── Pago de VENTA de un seller conectado ────────────────────────
          const monto = Number(payment.transaction_amount ?? 0)
          const releaseDate = payment.money_release_date
            ? new Date(payment.money_release_date).toISOString()
            : null
          const isUUID = /^[0-9a-f-]{36}$/i.test(ref)

          // Buscar la venta por id (external_reference = venta.id UUID)
          const { data: venta } = isUUID
            ? await supabase
                .from('ventas')
                .select('id, total, monto_pagado, estado, numero, sucursal_id')
                .eq('id', ref)
                .eq('tenant_id', sellerCred.tenant_id)
                .maybeSingle()
            : { data: null }

          if (venta) {
            // Idempotencia: insertar el log PRIMERO. El UNIQUE(tenant,integracion,external_id)
            // garantiza que un reintento de MP (envía varias notificaciones) no re-procese el
            // pago. Si el insert falla por algo distinto a duplicado, abortamos sin tocar plata.
            const logKey = `mp-payment-${paymentId}`
            const { error: logErr } = await supabase.from('ventas_externas_logs').insert({
              tenant_id:           sellerCred.tenant_id,
              integracion:         'MercadoPago',
              webhook_external_id: logKey,
              venta_id:            venta.id,
              payload_raw:         { payment_id: paymentId, monto, venta_id: venta.id, money_release_date: releaseDate },
            })
            if (logErr) {
              if ((logErr as any).code === '23505') {
                console.log('Pago MP ya procesado (idempotente):', logKey)
              } else {
                console.error('mp-webhook: no se pudo registrar idempotencia — abortando para no duplicar plata', logErr)
                throw new Error(`idempotencia ventas_externas_logs: ${logErr.message}`)
              }
            } else {
              // Conciliar el saldo de la venta (cap al total) + asentar caja informativa.
              const montoNuevo = Math.min((venta.monto_pagado ?? 0) + monto, venta.total ?? 0)
              const { error: updErr } = await supabase.from('ventas').update({
                id_pago_externo:    String(paymentId),
                money_release_date: releaseDate,
                monto_pagado:       montoNuevo,
              }).eq('id', venta.id)
              if (updErr) console.error('mp-webhook: error actualizando venta', updErr)
              else console.log(`Venta ${venta.id}: monto_pagado ${venta.monto_pagado} → ${montoNuevo}`)

              await asentarIngresoInformativoMp(supabase, sellerCred.tenant_id, venta, monto)
            }
          } else if (isUUID) {
            // Venta aún no existe (venta directa con pre-venta UUID): el webhook llegó antes
            // de finalizar. Guardamos el pago para que registrarVenta lo aplique al finalizar
            // (que es donde se asienta la caja según el medio del carrito).
            console.log('Venta no existe aún, guardando pago pre-venta:', ref)
            const { error: preErr } = await supabase.from('ventas_externas_logs').insert({
              tenant_id:           sellerCred.tenant_id,
              integracion:         'MercadoPago',
              webhook_external_id: `mp-preventa-${ref}`,
              payload_raw:         { payment_id: paymentId, monto, pre_venta_id: ref, money_release_date: releaseDate },
            })
            if (preErr && (preErr as any).code !== '23505') console.error('mp-webhook: error guardando pago pre-venta', preErr)
          }
        } else {
          // ── Pago de PLATAFORMA (suscripción / add-on) ───────────────────
          if (ref.endsWith('|addon_movimientos')) {
            const tenantId = ref.replace('|addon_movimientos', '')
            const { data: tenantRow } = await supabase.from('tenants')
              .select('addon_movimientos').eq('id', tenantId).single()
            const actual = tenantRow?.addon_movimientos ?? 0
            await supabase.from('tenants').update({
              addon_movimientos: actual + 500,
            }).eq('id', tenantId)
            console.log(`Tenant ${tenantId} addon_movimientos: ${actual} → ${actual + 500}`)
          } else {
            await supabase.from('tenants').update({
              subscription_status: 'active',
            }).eq('id', ref)
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('Webhook error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
