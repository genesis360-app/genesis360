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
    const { plan_id } = await req.json()

    if (!plan_id) {
      return new Response(JSON.stringify({ error: 'Falta plan_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Leer env vars dentro del handler (no a nivel de módulo)
    const planBasico = Deno.env.get('MP_PLAN_BASICO') ?? ''
    const planPro    = Deno.env.get('MP_PLAN_PRO') ?? ''

    const PLAN_INIT_POINTS: Record<string, string> = {
      [planBasico]: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${planBasico}`,
      [planPro]:    `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${planPro}`,
    }

    const init_point = PLAN_INIT_POINTS[plan_id]
    if (!init_point) {
      return new Response(JSON.stringify({ error: `Plan no reconocido: ${plan_id}` }), {
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
