import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan_id, tenant_id, back_url, payer_email } = await req.json()

    if (!plan_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) throw new Error('MP_ACCESS_TOKEN no configurado')

    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        preapproval_plan_id: plan_id,
        back_url: back_url ?? 'https://stokio-tau.vercel.app/suscripcion',
        external_reference: tenant_id,
        ...(payer_email ? { payer_email } : {}),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message ?? 'Error en Mercado Pago')
    }

    return new Response(JSON.stringify({ init_point: data.init_point, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
