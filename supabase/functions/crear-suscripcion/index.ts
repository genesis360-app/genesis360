import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// init_points de los planes (plan checkout de MP — el usuario ingresa su tarjeta en MP)
// La back_url está configurada en cada plan → https://stokio-tau.vercel.app/suscripcion
const PLAN_INIT_POINTS: Record<string, string> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${Deno.env.get('MP_PLAN_BASICO') ?? ''}`,
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${Deno.env.get('MP_PLAN_PRO') ?? ''}`,
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan_id } = await req.json()

    if (!plan_id) {
      return new Response(JSON.stringify({ error: 'Falta plan_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const init_point = PLAN_INIT_POINTS[plan_id]
    if (!init_point) {
      return new Response(JSON.stringify({ error: 'Plan no reconocido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ init_point }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
