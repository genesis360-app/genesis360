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

const MP_PLAN_TIER: Record<string, 'basico' | 'pro' | 'enterprise'> = {
  [Deno.env.get('MP_PLAN_BASICO')     ?? '']: 'basico',
  [Deno.env.get('MP_PLAN_PRO')        ?? '']: 'pro',
  // Pricing v7: secret nuevo; mientras no exista, '' no coincide con ningún preapproval_plan_id real.
  [Deno.env.get('MP_PLAN_ENTERPRISE') ?? '']: 'enterprise',
}

type Tipo = 'huerfana' | 'drift_mp_cobra' | 'drift_acceso_gratis'
interface Hallazgo { tipo: Tipo; preapproval_id: string; tenant_id: string | null; detalle: Record<string, unknown> }

// Espejo de src/lib/mpReconciliacion.ts (testeado con vitest) — mantener idéntico.
// Espejo de candidatosHuerfana / esPosibleDuplicado (src/lib/mpReconciliacion.ts, mig 464) — mantener idéntico.
const VENTANA_CANDIDATO_MS = 3 * 60 * 60 * 1000
type Intento = { tenant_id: string; mp_plan_id: string; created_at: string; vinculado_at: string | null }
function candidatosHuerfana(pre: { preapproval_plan_id: string; date_created: string }, intentos: Intento[]): string[] {
  const t = new Date(pre.date_created).getTime()
  if (!Number.isFinite(t)) return []
  const enVentana = intentos
    .filter(i => i.mp_plan_id === pre.preapproval_plan_id && !i.vinculado_at)
    .map(i => ({ tenant: i.tenant_id, dt: t - new Date(i.created_at).getTime() }))
    .filter(x => Number.isFinite(x.dt) && x.dt >= -60_000 && x.dt <= VENTANA_CANDIDATO_MS)
    .sort((a, b) => Math.abs(a.dt) - Math.abs(b.dt))
  return [...new Set(enVentana.map(x => x.tenant))]
}
function esPosibleDuplicado(pre: { id: string; date_created: string }, candidato: string,
  otras: Array<{ id: string; date_created: string; tenant_id: string | null; candidatos: string[] }>): boolean {
  const t = new Date(pre.date_created).getTime()
  return otras.some(o => o.id !== pre.id &&
    (o.tenant_id === candidato || o.candidatos.includes(candidato)) &&
    Math.abs(new Date(o.date_created).getTime() - t) <= 24 * 60 * 60 * 1000)
}

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

  // GUARD-CRON (auditoria de seguridad 2026-09-20): esta funcion la dispara GitHub Actions
  // o alguna otra Edge Function, nunca un navegador. Antes el unico filtro era `verify_jwt`,
  // que se satisface con la ANON KEY — y la anon key viaja en el bundle que descarga
  // cualquiera, asi que la funcion estaba abierta a internet. Exige CRON_SECRET (workflows)
  // o la service key (llamadas EF -> EF). Sin CRON_SECRET cargado, solo entra la service key.
  {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const enviado = req.headers.get('x-cron-secret') ?? ''
    const auth = req.headers.get('Authorization') ?? ''
    const autorizado =
      (cronSecret !== '' && enviado === cronSecret) ||
      (serviceKey !== '' && auth.includes(serviceKey))
    if (!autorizado) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

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

    // 3b) Mig 464: nombrar al negocio candidato de cada huérfana (intentó ese plan en las 3 h previas) y marcar si
    //     parece un pago DUPLICADO. Incidente 2026-09-28: dos huérfanas del mismo negocio a 40 s, sin nombre en la
    //     alerta → descartadas como "prueba". Sigue sin vincular solo: lo decide soporte con "Linkear suscripción".
    const huerfanas = hallazgos.filter(h => h.tipo === 'huerfana')
    if (huerfanas.length) {
      const desde = new Date(Math.min(...huerfanas.map(h => new Date(String(h.detalle.date_created)).getTime()))
        - VENTANA_CANDIDATO_MS - 60_000)
      const { data: intentos } = await supabase.from('mp_suscripcion_intentos')
        .select('tenant_id, mp_plan_id, created_at, vinculado_at')
        .gte('created_at', isNaN(desde.getTime()) ? new Date(0).toISOString() : desde.toISOString())
      const planDe = new Map(nuestros.map(p => [String(p.id), String(p.preapproval_plan_id)]))
      const conCand = huerfanas.map(h => ({
        h,
        candidatos: candidatosHuerfana(
          { preapproval_plan_id: planDe.get(h.preapproval_id) ?? '', date_created: String(h.detalle.date_created) },
          (intentos ?? []) as Intento[]),
      }))
      const otras = [
        ...conCand.map(c => ({ id: c.h.preapproval_id, date_created: String(c.h.detalle.date_created), tenant_id: null, candidatos: c.candidatos })),
        ...nuestros.filter(p => p?.status === 'authorized' && linkedByPre.has(String(p.id)))
          .map(p => ({ id: String(p.id), date_created: String(p.date_created), tenant_id: linkedByPre.get(String(p.id))!.id, candidatos: [] as string[] })),
      ]
      const ids = [...new Set(conCand.flatMap(c => c.candidatos))]
      const nombres = new Map<string, string>()
      if (ids.length) {
        const { data: ts } = await supabase.from('tenants').select('id, nombre').in('id', ids)
        for (const t of ts ?? []) nombres.set(String(t.id), String(t.nombre))
      }
      for (const { h, candidatos } of conCand) {
        h.detalle.candidatos = candidatos.map(id => ({ tenant_id: id, nombre: nombres.get(id) ?? null }))
        h.detalle.posible_duplicado = candidatos.some(c =>
          esPosibleDuplicado({ id: h.preapproval_id, date_created: String(h.detalle.date_created) }, c, otras))
      }
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
        // Mig 445: si reaparece es un hecho nuevo → también se limpia un descarte anterior.
        .upsert({ tipo: h.tipo, preapproval_id: h.preapproval_id, tenant_id: h.tenant_id, detalle: h.detalle, resolved_at: null, descartada_at: null, descartada_por: null, nota: null },
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
      const candTxt = (h: Hallazgo) => {
        const c = (h.detalle.candidatos ?? []) as Array<{ tenant_id: string; nombre: string | null }>
        if (h.tipo !== 'huerfana') return ''
        const dup = h.detalle.posible_duplicado ? '<br><b style="color:#c00">⚠ POSIBLE PAGO DUPLICADO: cancelar en MP y devolver</b>' : ''
        if (!c.length) return '<br><i>Sin negocio candidato (nadie salió de /suscripcion a ese plan en las 3 h previas).</i>' + dup
        return `<br>Probable negocio: <b>${c.map(x => `${x.nombre ?? '?'} (${x.tenant_id})`).join(' · ')}</b>` +
          (c.length > 1 ? ' <i>(ambiguo)</i>' : '') + dup
      }
      const filas = nuevos.map(h =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${h.tipo}</b>${candTxt(h)}</td>` +
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
