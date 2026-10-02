import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Crea una MP Preference para cobrar un monto específico de una venta.
// El external_reference = venta.id permite que mp-webhook matchee el pago.
//
// 🛑 REGLA #0 (2026-10-02): la preferencia se crea SIEMPRE con la cuenta MP del NEGOCIO. Antes, sin credencial (o con
// dos conectadas, que rompían el `.maybeSingle()`) caía al MP_ACCESS_TOKEN de la PLATAFORMA → el cliente le pagaba a
// Genesis360 y la venta no se conciliaba. Al 02/10 ningún negocio de PROD tenía MP conectado: todo link/QR salía así.

const MP_API = 'https://api.mercadopago.com'
// El webhook del MISMO proyecto (antes estaba fijo a PROD, también desde DEV).
const WEBHOOK_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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

  // Obtener número de venta para el título (puede no existir aún en venta directa)
  const { data: venta } = await supabase
    .from('ventas').select('numero, total, costo_envio, monto_pagado, sucursal_id, estado')
    .eq('id', venta_id).eq('tenant_id', tenantId).maybeSingle()

  // Venta existente: el monto no puede superar su saldo (total + envío − pagado; el numeric llega como string).
  // Sin venta = pre-venta del POS (todavía no se guardó): el monto es el que se está cobrando en el checkout.
  if (venta) {
    if (venta.estado === 'cancelada') return json({ error: 'La venta está cancelada.' }, 400)
    const saldo = parseFloat(String(venta.total ?? 0)) + parseFloat(String(venta.costo_envio ?? 0))
      - parseFloat(String(venta.monto_pagado ?? 0))
    if (!(saldo > 0.5)) return json({ error: 'La venta no tiene saldo pendiente.' }, 400)
    if (Number(monto) > saldo + 0.5) {
      return json({ error: `El monto ($${Number(monto)}) supera el saldo pendiente de la venta ($${Math.round(saldo * 100) / 100}).` }, 400)
    }
  }

  // Credencial MP del NEGOCIO. Puede haber más de una (por sucursal): primero la de la sucursal de la venta, después
  // la del negocio sin sucursal, después la más reciente. NUNCA la cuenta de la plataforma.
  const { data: creds } = await supabase
    .from('mercadopago_credentials')
    .select('access_token, sucursal_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('conectado', true)
    .order('created_at', { ascending: false })
  const lista = (creds ?? []).filter((c: any) => !!c.access_token)
  const cred = lista.find((c: any) => venta?.sucursal_id && c.sucursal_id === venta.sucursal_id)
    ?? lista.find((c: any) => !c.sucursal_id)
    ?? lista[0]
  const accessToken = cred?.access_token
  if (!accessToken) {
    return json({ error: 'No hay cuenta de Mercado Pago conectada. Conectala en Configuración → Integraciones.' }, 400)
  }

  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
  const backUrl = `${appUrl}/ventas?id=${venta_id}`

  // Crear preference en MP
  const prefBody = {
    items: [{
      title: venta?.numero ? `Venta #${venta.numero} — ${nombreTenant}` : `Compra en ${nombreTenant}`,
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
