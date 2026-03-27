import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Obtener usuario autenticado y su tenant_id
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    if (!userData?.tenant_id) throw new Error('Tenant no encontrado')

    const mpToken  = Deno.env.get('MP_ACCESS_TOKEN') ?? ''
    const appUrl   = Deno.env.get('APP_URL') ?? 'https://genesis360.pro'

    // Crear suscripción en MP — external_reference = tenant_id para que el webhook lo identifique
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        preapproval_plan_id: plan_id,
        payer_email: user.email,
        external_reference: userData.tenant_id,
        back_url: `${appUrl}/suscripcion`,
      }),
    })

    const mpData = await mpRes.json()
    console.log('MP response status:', mpRes.status, 'init_point:', mpData.init_point ? 'OK' : 'MISSING')

    if (!mpRes.ok || !mpData.init_point) {
      console.error('MP error:', JSON.stringify(mpData))
      throw new Error(mpData.message ?? `Error MP (${mpRes.status})`)
    }

    return new Response(JSON.stringify({ init_point: mpData.init_point }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
