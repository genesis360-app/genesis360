import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Verificación server-side de una suscripción MP antes de activarla.
//
// 🛑 REGLA #0 — bug real (2026-07-02, Fede Messina): en los checkout de suscripción
// POR PLAN (`preapproval_plan_id`) Mercado Pago NO persiste el `external_reference`
// que se manda en la URL → el preapproval queda con "Código de referencia" vacío.
// Por eso NINGÚN tenant lograba linkear su preapproval (mp_subscription_id NULL en
// toda la plataforma) y ni la activación ni la cancelación funcionaban. La pertenencia
// se verifica ahora por el EMAIL DEL PAGADOR (`payer_email` del preapproval === email
// del usuario logueado) + claim exclusivo (ese preapproval no puede estar linkeado a
// otro tenant). Solo se activa si status === 'authorized' y el plan es uno NUESTRO.
//
// El `preapproval_id` llega en el redirect de MP (`/suscripcion?preapproval_id=...`);
// si no vino (el usuario cerró la pestaña antes de volver), se BUSCA en MP la
// suscripción autorizada de este pagador por payer_email. Esto cierra el agujero
// "pagó y no se le activó el plan".

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MP = 'https://api.mercadopago.com'

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
    // ── Autenticación: identificar el tenant y el email del usuario que llama ──
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
    const userEmail = (user.email ?? '').toLowerCase().trim()

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const mpHeaders = { Authorization: `Bearer ${mpToken}` }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { preapproval_id: bodyId } = await req.json().catch(() => ({}))

    // ── Resolver el preapproval del usuario ───────────────────────────────────
    const getPre = async (id: string) => {
      const r = await fetch(`${MP}/preapproval/${id}`, { headers: mpHeaders })
      return r.ok ? await r.json() : null
    }

    let sub: any = null
    if (bodyId) {
      sub = await getPre(String(bodyId))
    } else if (userEmail) {
      // Sin preapproval_id (cerró la pestaña): buscar en MP la suscripción autorizada
      // de este pagador. El filtro server-side de /preapproval/search NO es confiable
      // (devuelve todos) → filtramos client-side por payer_email + status + plan nuestro.
      try {
        const LIMIT = 100
        const encontrados: any[] = []
        for (let offset = 0; offset < 1000; offset += LIMIT) {
          const r = await fetch(`${MP}/preapproval/search?limit=${LIMIT}&offset=${offset}`, { headers: mpHeaders })
          if (!r.ok) { console.warn('mp-verificar: search MP', r.status); break }
          const s = await r.json()
          const results = s?.results ?? s?.elements ?? []
          for (const p of results) {
            const pe = (p?.payer_email ?? '').toLowerCase().trim()
            if (pe && pe === userEmail && p?.status === 'authorized' && MP_PLAN_TIER[p?.preapproval_plan_id]) {
              encontrados.push(p)
            }
          }
          if (results.length < LIMIT) break
        }
        // el más reciente autorizado
        encontrados.sort((a, b) =>
          new Date(b?.date_created ?? 0).getTime() - new Date(a?.date_created ?? 0).getTime())
        sub = encontrados[0] ?? null
      } catch (e) {
        console.error('mp-verificar: error en search MP', e)
      }
    }

    if (!sub?.id) return json({ activated: false, reason: 'no_encontrado' })

    // Log de diagnóstico: deja ver en los logs qué campos devuelve MP realmente
    // (payer_email presente? external_reference vacío? plan reconocido?).
    console.log('mp-verificar: preapproval', JSON.stringify({
      id: sub.id, status: sub.status, plan: sub.preapproval_plan_id,
      external_reference: sub.external_reference ?? null, payer_email: sub.payer_email ?? null,
    }))

    if (sub.status !== 'authorized') {
      return json({ activated: false, reason: 'no_autorizado', status: sub.status })
    }

    const tier = MP_PLAN_TIER[sub.preapproval_plan_id]
    if (!tier) return json({ activated: false, reason: 'plan_desconocido', plan: sub.preapproval_plan_id ?? null }, 400)

    // ── Pertenencia ────────────────────────────────────────────────────────────
    // external_reference viene vacío (MP no lo guarda en checkout por plan) → NO lo
    // usamos. Verificamos por payer_email. Si MP no devolviera payer_email, exigimos
    // igual el claim exclusivo de abajo + status authorized + plan nuestro.
    const subEmail = (sub.payer_email ?? '').toLowerCase().trim()
    if (subEmail && (!userEmail || subEmail !== userEmail)) {
      console.warn(`mp-verificar: payer_email ${subEmail} != user ${userEmail}`)
      return json({ activated: false, reason: 'owner_mismatch' }, 403)
    }

    // Claim exclusivo: ese preapproval no puede estar ya linkeado a OTRO tenant.
    const { data: otro } = await admin.from('tenants')
      .select('id').eq('mp_subscription_id', String(sub.id)).neq('id', tenantId).maybeSingle()
    if (otro) {
      console.warn(`mp-verificar: preapproval ${sub.id} ya reclamado por tenant ${otro.id}`)
      return json({ activated: false, reason: 'ya_reclamada' }, 409)
    }

    // ── Evitar doble cobro: cancelar una suscripción anterior distinta ──────────
    const { data: tenantRow } = await admin
      .from('tenants').select('mp_subscription_id').eq('id', tenantId).single()
    const prevSubId = tenantRow?.mp_subscription_id
    if (prevSubId && String(prevSubId) !== String(sub.id)) {
      try {
        const cancelRes = await fetch(`${MP}/preapproval/${prevSubId}`, {
          method: 'PUT',
          headers: { ...mpHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        })
        console.log(`mp-verificar: cancelar sub anterior ${prevSubId} → ${cancelRes.status}`)
      } catch (e) {
        console.error(`mp-verificar: no se pudo cancelar sub anterior ${prevSubId}`, e)
      }
    }

    // ── Activación (service role: bypassa el guard server-side de tenants) ───────
    const { error: updErr } = await admin.from('tenants').update({
      subscription_status: 'active',
      mp_subscription_id: String(sub.id),
      plan_tier: tier,
      max_users: TIER_BASE[tier].max_users,
      max_productos: TIER_BASE[tier].max_productos,
      subscription_period_end: null, // limpiar el grace de una cancelación anterior (higiene MP-C9)
    }).eq('id', tenantId)
    if (updErr) {
      console.error('mp-verificar: error activando tenant', updErr)
      return json({ error: 'No se pudo activar' }, 500)
    }

    console.log(`mp-verificar: tenant ${tenantId} → active (sub ${sub.id}, ${tier})`)
    return json({ activated: true })
  } catch (e) {
    console.error('mp-verificar-suscripcion error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
