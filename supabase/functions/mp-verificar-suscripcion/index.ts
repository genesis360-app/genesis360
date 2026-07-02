import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Verificación server-side de una suscripción MP antes de activarla.
// Reemplaza el "fallback" inseguro que activaba desde el redirect del cliente
// (cualquiera podía navegar a /suscripcion?status=approved&preapproval_id=X y
// auto-activarse sin pagar). Acá se CONSULTA el preapproval contra la API de MP
// con el token de la plataforma y solo se activa si:
//   - status === 'authorized' (pago de la suscripción confirmado), y
//   - external_reference === tenant del usuario autenticado (no el de otro).
// El webhook `mp-webhook` sigue siendo el camino autoritativo; esto es el respaldo
// para cuando el usuario vuelve del checkout antes de que el webhook haya actuado.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// preapproval_plan_id (MP) → tier del plan (espejo de mp-webhook). plan_tier es la
// FUENTE DE VERDAD de los límites (fn_tenant_limite, mig 251). Los legacy max_users/
// max_productos se setean al BASE del tier solo por consistencia, no gobiernan límites.
const MP_PLAN_TIER: Record<string, 'basico' | 'pro'> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: 'basico',
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: 'pro',
}
const TIER_BASE: Record<string, { max_users: number; max_productos: number }> = {
  basico: { max_users: 5,  max_productos: 2000 },
  pro:    { max_users: 15, max_productos: 8000 },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // ── Autenticación: identificar el tenant del usuario que llama ───────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)

    const { data: userRow } = await userClient
      .from('users').select('tenant_id').eq('id', user.id).single()
    const tenantId = userRow?.tenant_id
    if (!tenantId) return json({ error: 'Tenant no encontrado' }, 400)

    const { preapproval_id } = await req.json().catch(() => ({}))
    if (!preapproval_id) return json({ error: 'Falta preapproval_id' }, 400)

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)

    // ── Verificación contra la API de MP ─────────────────────────────────────
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapproval_id}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    })
    if (!mpRes.ok) {
      console.warn(`mp-verificar-suscripcion: MP ${mpRes.status} para preapproval ${preapproval_id}`)
      return json({ activated: false, reason: 'no_encontrado' })
    }
    const sub = await mpRes.json()

    // El pago/suscripción debe estar autorizado Y pertenecer a ESTE tenant.
    if (sub.status !== 'authorized') {
      return json({ activated: false, reason: 'no_autorizado', status: sub.status })
    }
    if (sub.external_reference !== tenantId) {
      console.warn(`mp-verificar-suscripcion: external_reference ${sub.external_reference} != tenant ${tenantId}`)
      return json({ activated: false, reason: 'tenant_mismatch' }, 403)
    }

    // ── Activación (service role: bypassa el guard server-side de tenants) ────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Prorrateo / evitar doble cobro: si el tenant tenía OTRA suscripción activa,
    // cancelarla en MP antes de quedarse con la nueva (best-effort, no bloquea).
    const { data: tenantRow } = await admin
      .from('tenants').select('mp_subscription_id').eq('id', tenantId).single()
    const prevSubId = tenantRow?.mp_subscription_id
    if (prevSubId && prevSubId !== preapproval_id) {
      try {
        const cancelRes = await fetch(`https://api.mercadopago.com/preapproval/${prevSubId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        })
        console.log(`mp-verificar-suscripcion: cancelar sub anterior ${prevSubId} → ${cancelRes.status}`)
      } catch (e) {
        console.error(`mp-verificar-suscripcion: no se pudo cancelar sub anterior ${prevSubId}`, e)
      }
    }

    const tier = MP_PLAN_TIER[sub.preapproval_plan_id]
    const { error: updErr } = await admin.from('tenants').update({
      subscription_status: 'active',
      mp_subscription_id: preapproval_id,
      ...(tier ? {
        plan_tier: tier,
        max_users: TIER_BASE[tier].max_users,
        max_productos: TIER_BASE[tier].max_productos,
      } : {}),
    }).eq('id', tenantId)
    if (updErr) {
      console.error('mp-verificar-suscripcion: error activando tenant', updErr)
      return json({ error: 'No se pudo activar' }, 500)
    }

    console.log(`mp-verificar-suscripcion: tenant ${tenantId} → active (sub ${preapproval_id})`)
    return json({ activated: true })
  } catch (e) {
    console.error('mp-verificar-suscripcion error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
