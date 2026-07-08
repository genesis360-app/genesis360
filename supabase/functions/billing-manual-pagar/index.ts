import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─── Pago único de MP para tenants en modo MANUAL ("Pagar ahora") ─────────────────────────
// Plan aprobado 2026-07-08 (facturación de Fede + pago manual). A diferencia de la
// suscripción automática (preapproval, recurrente), esto es un pago ÚNICO de MP por el mes
// en curso — el cliente vuelve a pagar el mes que viene, sin compromiso de auto-débito.
// El webhook (mp-webhook, rama |manualpago|) confirma el pago y llama a
// fn_registrar_pago_manual + emitir-factura-plataforma. Mismo patrón que mp-addon/index.ts.
// 🛑 El monto SIEMPRE sale de tenants.manual_monto_mensual (server-side) — nunca del cliente.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)
    const { data: userRow } = await userClient.from('users').select('tenant_id').eq('id', user.id).single()
    const tenantId = userRow?.tenant_id
    if (!tenantId) return json({ error: 'Tenant no encontrado' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: tenant } = await admin.from('tenants')
      .select('billing_mode, manual_monto_mensual, nombre').eq('id', tenantId).single()
    if (tenant?.billing_mode !== 'manual') {
      return json({ error: 'Tu cuenta no está en modo de pago manual.' }, 400)
    }
    const monto = Number(tenant.manual_monto_mensual ?? 0)
    if (!(monto > 0)) return json({ error: 'No hay un monto mensual configurado. Contactá soporte.' }, 500)

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'

    // external_reference: `${tenantId}|manualpago|${isoTimestamp}` — el timestamp evita que
    // dos preferences del mismo tenant/mismo mes colisionen en algún índice futuro; el
    // dedupe real de idempotencia es por payment_ref (id del pago) en emitir-factura-plataforma.
    const externalRef = `${tenantId}|manualpago|${new Date().toISOString()}`

    const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{
          id: 'suscripcion_manual',
          title: `Suscripción Genesis360 — ${tenant.nombre ?? 'tu negocio'}`,
          description: 'Pago del mes en curso (modo manual, sin auto-débito)',
          quantity: 1, unit_price: monto, currency_id: 'ARS',
        }],
        external_reference: externalRef,
        back_urls: {
          success: `${appUrl}/suscripcion?status=approved&type=manualpago`,
          failure: `${appUrl}/suscripcion?status=failure&type=manualpago`,
          pending: `${appUrl}/suscripcion?status=pending&type=manualpago`,
        },
        auto_return: 'approved',
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
        statement_descriptor: 'GENESIS360',
      }),
    })
    if (!prefRes.ok) {
      console.error('billing-manual-pagar: preference falló', prefRes.status, await prefRes.text())
      return json({ error: 'No se pudo iniciar el pago en Mercado Pago. Reintentá.' }, 502)
    }
    const preference = await prefRes.json()
    console.log(`billing-manual-pagar: preference ${preference.id} tenant ${tenantId} $${monto}`)
    return json({ init_point: preference.init_point, id: preference.id })
  } catch (e) {
    console.error('billing-manual-pagar error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
