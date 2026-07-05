import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Sweep de reconciliación de billing MP (UAT MP-W6 + DRIFT 1-2) ───────────────
// Lo dispara GitHub Actions cada hora (pg_cron no está habilitado). Recorre TODOS los
// preapprovals de la cuenta MP de la plataforma y clasifica (espejo testeado:
// src/lib/mpReconciliacion.ts):
//   • huerfana            → authorized + plan nuestro + SIN tenant linkeado (pago perdido
//                           en silencio — caso real Fede 2026-07-04: el checkout-return no
//                           corrió y el webhook no puede linkear porque external_reference
//                           y payer_email vienen VACÍOS en checkout por plan)
//   • drift_mp_cobra      → authorized + tenant linkeado NO active (MP cobra, DB no da acceso)
//   • drift_acceso_gratis → preapproval muerto + tenant linkeado active (acceso sin cobro)
//
// 🛑 REGLA #0: SOLO detecta y alerta a soporte por email — NUNCA activa/linkea/mueve plata
// solo (sin payer_email no hay matching confiable). Resolución humana vía admin-api
// billing.link_subscription (validado e2e en PROD).
//
// Dedupe: mp_billing_alertas (mig 256, UNIQUE(tipo, preapproval_id)) — se emailea una vez
// por hallazgo nuevo; si en una corrida posterior el hallazgo desapareció, se marca resuelto.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MP = 'https://api.mercadopago.com'
const VIVOS = ['authorized', 'pending', 'paused']
const SOPORTE_EMAIL = 'soporte@genesis360.pro'
const FROM = 'Genesis360 <noreply@genesis360.pro>'

const MP_PLAN_TIER: Record<string, 'basico' | 'pro'> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: 'basico',
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: 'pro',
}

type Tipo = 'huerfana' | 'drift_mp_cobra' | 'drift_acceso_gratis'
interface Hallazgo { tipo: Tipo; preapproval_id: string; tenant_id: string | null; detalle: Record<string, unknown> }

// Espejo de src/lib/mpReconciliacion.ts (testeado con vitest) — mantener idéntico.
function clasificar(esPlanNuestro: boolean, status: string, linkedTenantStatus: string | null):
  'ignorar' | 'ok' | Tipo {
  if (!esPlanNuestro) return 'ignorar'
  if (status === 'authorized') {
    if (linkedTenantStatus === null) return 'huerfana'
    if (linkedTenantStatus === 'active') return 'ok'
    return 'drift_mp_cobra'
  }
  if (VIVOS.includes(status)) return 'ignorar'
  if (linkedTenantStatus === 'active') return 'drift_acceso_gratis'
  return 'ignorar'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) {
      return new Response(JSON.stringify({ ok: false, error: 'MP no configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const H = { Authorization: `Bearer ${mpToken}` }

    // 1) Todos los preapprovals de la cuenta (el filtro server-side de /search no es
    //    confiable — mismo patrón que cancel-suscripcion). Techo 2000.
    const pres: any[] = []
    for (let offset = 0; offset < 2000; offset += 100) {
      const r = await fetch(`${MP}/preapproval/search?limit=100&offset=${offset}`, { headers: H })
      if (!r.ok) { console.warn('mp-reconciliacion: search MP', r.status); break }
      const s = await r.json()
      const results = s?.results ?? s?.elements ?? []
      pres.push(...results)
      if (results.length < 100) break
    }

    const nuestros = pres.filter(p => p?.id && MP_PLAN_TIER[p?.preapproval_plan_id])

    // 2) Tenants linkeados a esos ids (una sola query).
    const ids = nuestros.map(p => String(p.id))
    const linkedByPre = new Map<string, { id: string; subscription_status: string }>()
    if (ids.length) {
      const { data: tenants } = await supabase
        .from('tenants').select('id, subscription_status, mp_subscription_id')
        .in('mp_subscription_id', ids)
      for (const t of tenants ?? []) linkedByPre.set(String(t.mp_subscription_id), t)
    }

    // 3) Clasificar.
    const hallazgos: Hallazgo[] = []
    for (const p of nuestros) {
      const preId = String(p.id)
      const linked = linkedByPre.get(preId) ?? null
      const c = clasificar(true, String(p?.status ?? ''), linked?.subscription_status ?? null)
      if (c === 'ignorar' || c === 'ok') continue
      hallazgos.push({
        tipo: c, preapproval_id: preId, tenant_id: linked?.id ?? null,
        detalle: {
          mp_status: p?.status ?? null,
          plan: MP_PLAN_TIER[p?.preapproval_plan_id] ?? null,
          monto: p?.auto_recurring?.transaction_amount ?? null,
          date_created: p?.date_created ?? null,
          tenant_status: linked?.subscription_status ?? null,
        },
      })
    }

    // 4) Dedupe contra mp_billing_alertas: nuevos = no registrados sin resolver.
    const { data: abiertas } = await supabase
      .from('mp_billing_alertas').select('tipo, preapproval_id').is('resolved_at', null)
    const abiertasKey = new Set((abiertas ?? []).map((a: any) => `${a.tipo}|${a.preapproval_id}`))
    const actualesKey = new Set(hallazgos.map(h => `${h.tipo}|${h.preapproval_id}`))

    const nuevos = hallazgos.filter(h => !abiertasKey.has(`${h.tipo}|${h.preapproval_id}`))
    for (const h of nuevos) {
      // upsert por si el hallazgo existió, se resolvió y reapareció (reabre: resolved_at=null)
      const { error } = await supabase.from('mp_billing_alertas')
        .upsert({ tipo: h.tipo, preapproval_id: h.preapproval_id, tenant_id: h.tenant_id, detalle: h.detalle, resolved_at: null },
          { onConflict: 'tipo,preapproval_id' })
      if (error) console.error('mp-reconciliacion: upsert alerta', h.preapproval_id, error)
    }

    // 5) Marcar resueltas las abiertas que ya no aparecen.
    const resueltas = (abiertas ?? []).filter((a: any) => !actualesKey.has(`${a.tipo}|${a.preapproval_id}`))
    for (const a of resueltas) {
      await supabase.from('mp_billing_alertas')
        .update({ resolved_at: new Date().toISOString() })
        .eq('tipo', a.tipo).eq('preapproval_id', a.preapproval_id).is('resolved_at', null)
    }

    // 6) Email a soporte SOLO si hay hallazgos nuevos (dedupe = una vez por hallazgo).
    let emailed = false
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (nuevos.length && resendKey) {
      const filas = nuevos.map(h =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${h.tipo}</b></td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace">${h.preapproval_id}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${h.tenant_id ?? '—'}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${JSON.stringify(h.detalle)}</td></tr>`).join('')
      const html = `<h2>🛑 Reconciliación billing MP — ${nuevos.length} hallazgo(s) nuevo(s)</h2>
<p><b>huerfana</b> = pago authorized sin tenant (cliente pagó y no tiene acceso) → linkear con
"Linkear suscripción" en el panel (billing.link_subscription). <b>drift_mp_cobra</b> = MP cobra y
el tenant no está active. <b>drift_acceso_gratis</b> = tenant active con preapproval muerto.</p>
<table style="border-collapse:collapse;font-size:13px"><tr>
<th style="text-align:left;padding:6px 10px">Tipo</th><th style="text-align:left;padding:6px 10px">Preapproval</th>
<th style="text-align:left;padding:6px 10px">Tenant</th><th style="text-align:left;padding:6px 10px">Detalle</th></tr>${filas}</table>
<p style="color:#888;font-size:12px">EF mp-reconciliacion · corre cada hora · dedupe por (tipo, preapproval_id) en mp_billing_alertas</p>`
      const er = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [SOPORTE_EMAIL], subject: `🛑 Billing MP: ${nuevos.length} hallazgo(s) — reconciliación`, html }),
      })
      emailed = er.ok
      if (!er.ok) console.error('mp-reconciliacion: Resend', er.status, await er.text())
    }

    const counts = { huerfana: 0, drift_mp_cobra: 0, drift_acceso_gratis: 0 } as Record<Tipo, number>
    for (const h of hallazgos) counts[h.tipo]++

    return new Response(JSON.stringify({
      ok: true,
      preapprovals_revisados: pres.length,
      de_planes_nuestros: nuestros.length,
      hallazgos: counts,
      nuevos: nuevos.length,
      resueltos: resueltas.length,
      emailed,
      ran_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('mp-reconciliacion error', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
