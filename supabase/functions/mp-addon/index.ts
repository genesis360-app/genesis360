import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADDON_CANTIDAD = 500
const ADDON_PRECIO   = 990 // ARS

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No autorizado')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Obtener usuario autenticado
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) throw new Error('Usuario no autenticado')

    // Obtener tenant_id del usuario
    const { data: userRow, error: userRowErr } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    if (userRowErr || !userRow) throw new Error('Tenant no encontrado')

    const tenantId = userRow.tenant_id
    const appUrl = Deno.env.get('APP_URL') ?? 'https://stokio-tau.vercel.app'
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) throw new Error('MP_ACCESS_TOKEN no configurado')

    // Crear preferencia MP (pago único)
    const preferenceBody = {
      items: [{
        id: 'addon_movimientos_500',
        title: `+${ADDON_CANTIDAD} movimientos extra`,
        description: 'Pack adicional de movimientos de stock — válido hasta fin de mes',
        quantity: 1,
        unit_price: ADDON_PRECIO,
        currency_id: 'ARS',
      }],
      external_reference: `${tenantId}|addon_movimientos`,
      back_urls: {
        success: `${appUrl}/suscripcion?status=approved&type=addon`,
        failure: `${appUrl}/suscripcion?status=failure&type=addon`,
        pending: `${appUrl}/suscripcion?status=pending&type=addon`,
      },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      statement_descriptor: 'STOKIO ADDON',
    }

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferenceBody),
    })

    if (!mpRes.ok) {
      const err = await mpRes.text()
      throw new Error(`MP error ${mpRes.status}: ${err}`)
    }

    const preference = await mpRes.json()
    console.log('Preference created:', preference.id, 'for tenant:', tenantId)

    return new Response(JSON.stringify({ init_point: preference.init_point, id: preference.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('mp-addon error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
