import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Crea una MP Preference para cobrar un monto específico de una venta.
// El external_reference = venta.id permite que mp-webhook matchee el pago.

const MP_API = 'https://api.mercadopago.com'
const WEBHOOK_URL = 'https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Verificar JWT y obtener user
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: { user }, error: authErr } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  ).auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { venta_id, monto } = await req.json() as { venta_id: string; monto: number }

  if (!venta_id || !monto || monto <= 0) {
    return new Response(JSON.stringify({ error: 'venta_id y monto son requeridos' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Obtener tenant_id del usuario
  const { data: userData } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!userData) return new Response('Tenant no encontrado', { status: 404, headers: corsHeaders })
  const tenantId = userData.tenant_id

  // Obtener nombre del tenant para el título de la preference
  const { data: tenant } = await supabase
    .from('tenants').select('nombre').eq('id', tenantId).single()
  const nombreTenant = tenant?.nombre ?? 'Genesis360'

  // Obtener número de venta para el título
  const { data: venta } = await supabase
    .from('ventas').select('numero').eq('id', venta_id).eq('tenant_id', tenantId).single()
  if (!venta) {
    return new Response(JSON.stringify({ error: 'Venta no encontrada' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Buscar credenciales MP del tenant (cuenta del seller conectada)
  const { data: cred } = await supabase
    .from('mercadopago_credentials')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .eq('conectado', true)
    .maybeSingle()

  const accessToken = cred?.access_token ?? Deno.env.get('MP_ACCESS_TOKEN')
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'No hay cuenta de MercadoPago conectada. Conectala en Configuración → Integraciones.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
  const backUrl = `${appUrl}/ventas?id=${venta_id}`

  // Crear preference en MP
  const prefBody = {
    items: [{
      title: `Venta #${venta.numero} — ${nombreTenant}`,
      quantity: 1,
      unit_price: Number(monto),
      currency_id: 'ARS',
    }],
    external_reference: venta_id,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    notification_url: WEBHOOK_URL,
    auto_return: 'approved',
  }

  const mpRes = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(prefBody),
  })

  if (!mpRes.ok) {
    const errText = await mpRes.text()
    console.error('MP API error:', mpRes.status, errText)
    return new Response(JSON.stringify({ error: `Error en MercadoPago: ${mpRes.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const pref = await mpRes.json() as { id: string; init_point: string; sandbox_init_point: string }

  return new Response(
    JSON.stringify({ preference_id: pref.id, init_point: pref.init_point }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
