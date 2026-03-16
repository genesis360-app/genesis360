import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { hmac } from 'https://deno.land/x/hmac@v2.0.1/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const signature = req.headers.get('x-signature')
    const requestId = req.headers.get('x-request-id')
    const body = await req.text()

    // Validar firma HMAC-SHA256
    const secret = Deno.env.get('MP_WEBHOOK_SECRET') ?? ''
    if (secret && signature) {
      const parts = signature.split(',')
      const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1]
      const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1]
      const manifest = `id:${requestId};request-id:${requestId};ts:${ts};`
      const expected = await hmac('sha256', secret, manifest, 'utf8', 'hex')
      if (expected !== v1) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const event = JSON.parse(body)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { type, data } = event

    if (type === 'subscription_preapproval') {
      const subscriptionId = data?.id
      if (!subscriptionId) throw new Error('No subscription id')

      // Consultar estado en MP API
      const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
      const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${mpToken}` },
      })
      const subscription = await mpRes.json()

      let newStatus: string
      switch (subscription.status) {
        case 'authorized': newStatus = 'active'; break
        case 'cancelled':
        case 'paused':     newStatus = 'inactive'; break
        default:           newStatus = 'inactive'
      }

      await supabase
        .from('tenants')
        .update({ subscription_status: newStatus, mp_subscription_id: subscriptionId })
        .eq('mp_subscription_id', subscriptionId)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
