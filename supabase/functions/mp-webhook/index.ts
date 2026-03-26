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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const body = await req.text()
    const event = JSON.parse(body)

    console.log('MP Webhook received:', event.type, event.data?.id)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    const { type, data } = event

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

    if (type === 'payment') {
      const paymentId = data?.id
      if (!paymentId) throw new Error('No payment id')

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      })
      const payment = await mpRes.json()
      console.log('Payment status:', payment.status, 'ref:', payment.external_reference)

      if (payment.status === 'approved' && payment.external_reference) {
        const ref: string = payment.external_reference

        if (ref.endsWith('|addon_movimientos')) {
          // Add-on de movimientos: incrementar addon_movimientos en +500
          const tenantId = ref.replace('|addon_movimientos', '')
          const { data: tenantRow } = await supabase.from('tenants')
            .select('addon_movimientos').eq('id', tenantId).single()
          const actual = tenantRow?.addon_movimientos ?? 0
          await supabase.from('tenants').update({
            addon_movimientos: actual + 500,
          }).eq('id', tenantId)
          console.log(`Tenant ${tenantId} addon_movimientos: ${actual} → ${actual + 500}`)
        } else {
          // Pago de suscripción normal
          await supabase.from('tenants').update({
            subscription_status: 'active',
          }).eq('id', ref)
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
