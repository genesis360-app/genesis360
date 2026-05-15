import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

/**
 * MODO Payment Intent Creator — ISS-072
 *
 * Genera un QR MODO y un deep link de pago para cobrar en el POS.
 * Usa las credenciales del tenant almacenadas en `modo_credentials`.
 *
 * API MODO (merchants.modo.com.ar):
 *   POST /api/v1/payment/create
 *   Auth: Bearer {api_key}
 *   Body: { merchant_id, amount, currency, description, merchant_order_id, callback_url }
 *   Response: { payment_id, qr, deep_link, expiration }
 *
 * TODO: Verificar endpoints y estructura exacta con MODO cuando lleguen las credenciales.
 *       Sandbox: https://merchants-sandbox.modo.com.ar/api/v1
 *       Prod:    https://merchants.modo.com.ar/api/v1
 */

const MODO_API_PROD = 'https://merchants.modo.com.ar/api/v1'
const MODO_API_TEST = 'https://merchants-sandbox.modo.com.ar/api/v1'

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

  // Verificar JWT
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

  // Obtener tenant_id
  const { data: userData } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()
  if (!userData) return new Response('Tenant no encontrado', { status: 404, headers: corsHeaders })
  const tenantId = userData.tenant_id

  // Datos del tenant y venta
  const [{ data: tenant }, { data: venta }, { data: cred }] = await Promise.all([
    supabase.from('tenants').select('nombre').eq('id', tenantId).single(),
    supabase.from('ventas').select('numero').eq('id', venta_id).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('modo_credentials')
      .select('merchant_id, api_key, ambiente').eq('tenant_id', tenantId).eq('conectado', true).maybeSingle(),
  ])

  if (!cred) {
    return new Response(JSON.stringify({ error: 'No hay cuenta MODO conectada. Configurala en Configuración → Integraciones.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const baseUrl = cred.ambiente === 'prod' ? MODO_API_PROD : MODO_API_TEST
  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'

  const description = venta?.numero
    ? `Venta #${venta.numero} — ${tenant?.nombre ?? 'Genesis360'}`
    : `Pago en ${tenant?.nombre ?? 'Genesis360'}`

  // Crear intención de pago en MODO
  // TODO: ajustar body y headers según la doc oficial de MODO cuando lleguen las credenciales
  const modoBody = {
    merchant_id: cred.merchant_id,
    amount: Math.round(monto * 100),        // MODO recibe en centavos
    currency: 'ARS',
    description,
    merchant_order_id: venta_id,
    callback_url: `${appUrl}/ventas?id=${venta_id}`,
    notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/modo-webhook`,
  }

  const modoRes = await fetch(`${baseUrl}/payment/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cred.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(modoBody),
  })

  if (!modoRes.ok) {
    const errText = await modoRes.text()
    console.error('MODO API error:', modoRes.status, errText)
    return new Response(JSON.stringify({ error: `Error en MODO: ${modoRes.status} — ${errText}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const modoData = await modoRes.json() as {
    payment_id: string
    qr: string          // string del QR para mostrar como imagen
    deep_link: string   // URL para compartir (WhatsApp, email, etc.)
    expiration?: string
  }

  return new Response(
    JSON.stringify({
      payment_id: modoData.payment_id,
      qr: modoData.qr,
      deep_link: modoData.deep_link,
      expiration: modoData.expiration,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
