import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ───────────────────────────────────────────────────────────────────────────
// admin-api — capa de datos del PANEL INTERNO (admin.genesis360.pro).
// 1) identifica al caller (JWT) · 2) valida agente activo · 3) AUTORIZA por rol/módulo
// 4) AUDITA accesos a datos de clientes · 5) usa service_role (RLS por-tenant intacta).
// ───────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const ROLE_MODULES: Record<string, string[]> = {
  admin:     ['dashboard', 'customers', 'crm', 'support', 'analytics', 'billing', 'users'],
  support:   ['dashboard', 'customers', 'support'],
  marketing: ['dashboard', 'crm', 'analytics'],
  billing:   ['dashboard', 'billing'],
}
const ACTION_MODULE: Record<string, string> = {
  'auth.whoami': 'dashboard',
  'auth.change_password': 'dashboard',
  'metrics.overview': 'dashboard',
  'customers.list': 'customers',
  'customers.get': 'customers',
  // Herramientas de soporte sobre un cliente. `extend_trial` y `reset_password` son de `admin`
  // (el guard explícito vive adentro del case, igual que la baja).
  'customers.extend_trial': 'customers',
  'customers.reset_password': 'customers',
  'audit.list': 'dashboard',
  // Baja de un tenant desde el panel de soporte. Van en el módulo `customers` (es donde vive la
  // pantalla), pero OJO: `support` también tiene ese módulo, y borrar un negocio entero no puede
  // ser cosa de soporte. El guard real es `soloAdmin()` adentro de cada case.
  'customers.delete_preview': 'customers',
  'customers.schedule_delete': 'customers',
  'customers.cancel_delete': 'customers',
  'customers.purge_now': 'customers',
  'impersonation.start': 'customers',
  'support.tickets.list': 'support',
  'support.tickets.get': 'support',
  'support.tickets.create': 'support',
  'support.tickets.reply': 'support',
  'support.tickets.update': 'support',
  'agents.list': 'users',
  'agents.create': 'users',
  'agents.update': 'users',
  'billing.overview': 'billing',
  'billing.cancel_subscription': 'billing',
  'billing.link_subscription': 'billing',
  'billing.manual_tenants_list': 'billing',
  'billing.manual_record_payment': 'billing',
  'billing.manual_history': 'billing',
  'billing.platform_facturas_stats': 'billing',
  'crm.leads.list': 'crm',
  'crm.leads.create': 'crm',
  'crm.leads.update': 'crm',
}
const ROLES = ['admin', 'support', 'marketing', 'billing']
const DAY = 86400000
const MP = 'https://api.mercadopago.com'
const MP_VIVOS = ['authorized', 'pending', 'paused']

// preapproval_plan_id (MP) → tier. Espejo de mp-verificar-suscripcion / mp-webhook.
// plan_tier es la fuente de verdad de los límites (fn_tenant_limite); los max_users/
// max_productos se setean al BASE del tier solo por consistencia.
const MP_PLAN_TIER: Record<string, 'basico' | 'pro'> = {
  [Deno.env.get('MP_PLAN_BASICO') ?? '']: 'basico',
  [Deno.env.get('MP_PLAN_PRO')    ?? '']: 'pro',
}
const TIER_BASE: Record<string, { max_users: number; max_productos: number }> = {
  basico: { max_users: 5,  max_productos: 2000 },
  pro:    { max_users: 15, max_productos: 8000 },
}

// Cancela el/los preapproval(s) del tenant en Mercado Pago (mismo circuito que el EF
// cancel-suscripcion). Camino principal: el id GUARDADO (mp_subscription_id, verificado al
// activar). ⚠️ En checkout por plan MP NO guarda el external_reference, así que la pertenencia
// del id guardado NO se puede gatear por él (bug histórico que fail-abría: dejaba la cuenta
// 'cancelled' sin cancelar en MP). Fail-closed: si hay id guardado y no se confirma que quedó
// fuera de cobro, agrega 'no_confirmado' a errores → el caller NO marca cancelado.
async function cancelarSubMP(svc: any, tenantId: string, mpToken: string): Promise<{ mp_cancelled: number; errores: string[]; periodEnd: string | null }> {
  const H = { Authorization: `Bearer ${mpToken}` }
  const { data: t } = await svc.from('tenants').select('mp_subscription_id').eq('id', tenantId).single()
  const storedId = t?.mp_subscription_id ? String(t.mp_subscription_id) : null
  const cand = new Set<string>()
  if (storedId) cand.add(storedId)
  // MP-C9: fin del período pagado (grace al cancelar). MP lo trae como next_payment_date.
  let periodEnd: string | null = null
  try {
    for (let off = 0; off < 1000; off += 100) {
      const r = await fetch(`${MP}/preapproval/search?external_reference=${encodeURIComponent(tenantId)}&limit=100&offset=${off}`, { headers: H })
      if (!r.ok) break
      const s = await r.json()
      const results = s?.results ?? []
      for (const x of results) if (x?.id && x?.external_reference === tenantId) cand.add(String(x.id))
      if (results.length < 100) break
    }
  } catch (_) { /* best-effort */ }
  // H8/MP-C7 (unificado con cancel-suscripcion): si el tenant NUNCA se linkeó
  // (mp_subscription_id NULL — pre-fix), buscar su suscripción viva en MP por el
  // payer_email del DUEÑO para poder frenar el cobro igual. Sin esto, cancelar desde
  // el panel un tenant sin link "tenía éxito" sin cancelar nada en MP (fail-open).
  const ownedByEmail = new Set<string>()
  if (!storedId) {
    try {
      const { data: owner } = await svc.from('users')
        .select('id').eq('tenant_id', tenantId).eq('rol', 'DUEÑO').limit(1).maybeSingle()
      let ownerEmail: string | null = null
      if (owner?.id) {
        const { data: au } = await svc.auth.admin.getUserById(owner.id)
        ownerEmail = au?.user?.email ? String(au.user.email).toLowerCase().trim() : null
      }
      if (ownerEmail) {
        for (let off = 0; off < 1000; off += 100) {
          const r = await fetch(`${MP}/preapproval/search?limit=100&offset=${off}`, { headers: H })
          if (!r.ok) break
          const s = await r.json()
          const results = s?.results ?? []
          for (const p of results) {
            const pe = (p?.payer_email ?? '').toLowerCase().trim()
            if (p?.id && pe && pe === ownerEmail && MP_VIVOS.includes(p?.status)) {
              cand.add(String(p.id)); ownedByEmail.add(String(p.id))
            }
          }
          if (results.length < 100) break
        }
      }
    } catch (_) { /* best-effort */ }
  }
  let mp_cancelled = 0
  const errores: string[] = []
  // 🛑 Fail-closed real: si hay un preapproval GUARDADO, exigimos confirmar que quedó fuera
  // de cobro (o ya estaba cancelado / no vivo) antes de que el caller marque 'cancelled'.
  let storedConfirmado = storedId ? false : true
  for (const id of cand) {
    const g = await fetch(`${MP}/preapproval/${id}`, { headers: H })
    if (!g.ok) { if (id === storedId) errores.push(`${id}:get_${g.status}`); continue }
    const pre = await g.json()
    // Pertenencia: por external_reference (histórico) O por ser el id guardado del tenant
    // (verificado al activar) O hallado por payer_email del DUEÑO (H8, tenants sin link).
    const esDelTenant = pre?.external_reference === tenantId || id === storedId || ownedByEmail.has(id)
    if (!esDelTenant) continue                                    // no es de este tenant
    const npd = pre?.next_payment_date ?? pre?.summarized?.next_payment_date
    if (npd) {
      const d = new Date(npd)
      if (!isNaN(d.getTime()) && (!periodEnd || d.getTime() > new Date(periodEnd).getTime())) periodEnd = d.toISOString()
    }
    if (pre?.status === 'cancelled') { mp_cancelled++; if (id === storedId) storedConfirmado = true; continue }
    if (!MP_VIVOS.includes(pre?.status)) { if (id === storedId) storedConfirmado = true; continue }
    const put = await fetch(`${MP}/preapproval/${id}`, {
      method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
    })
    if (put.ok) { mp_cancelled++; if (id === storedId) storedConfirmado = true }
    else errores.push(`${id}:${put.status}`)
  }
  if (storedId && !storedConfirmado) errores.push('no_confirmado')
  return { mp_cancelled, errores, periodEnd }
}

/**
 * ¿Este tenant PARECE tener cobro vivo en Mercado Pago?
 *
 * Solo informativo (se muestra en el preview). NO se usa para decidir si cancelar: un tenant cuyo
 * checkout nunca terminó de linkearse queda con `mp_subscription_id` NULL y sin estado 'active', y
 * sin embargo puede tener un preapproval cobrando (el escenario H8/MP-C7 que `cancelarSubMP` sabe
 * resolver buscando por el mail del dueño). Gatear la cancelación con esto saltearía justo ese caso.
 */
const cobroVivo = (t: { subscription_status?: string | null; mp_subscription_id?: string | null }) =>
  t.subscription_status === 'active' || !!t.mp_subscription_id

// MRR + distribución por plan (join tenants→planes). Paga = plan_id no nulo y fuera de trial.
async function computeBilling(svc: any) {
  const nowIso = new Date().toISOString()
  const { data: tenants } = await svc.from('tenants').select('plan_id, trial_ends_at')
  const { data: planes } = await svc.from('planes').select('id, nombre, precio_mensual')
  const precioById = new Map((planes ?? []).map((p: any) => [p.id, p]))
  const porPlan = new Map<string, { nombre: string; precio_mensual: number; tenants: number; subtotal: number }>()
  let mrr = 0
  for (const t of tenants ?? []) {
    if (!t.plan_id) continue
    const enTrial = t.trial_ends_at && t.trial_ends_at > nowIso
    const plan = precioById.get(t.plan_id) as any
    if (!plan) continue
    const key = plan.id
    const row = porPlan.get(key) ?? { nombre: plan.nombre, precio_mensual: Number(plan.precio_mensual ?? 0), tenants: 0, subtotal: 0 }
    row.tenants += 1
    if (!enTrial) { row.subtotal += Number(plan.precio_mensual ?? 0); mrr += Number(plan.precio_mensual ?? 0) }
    porPlan.set(key, row)
  }
  return { mrr, por_plan: Array.from(porPlan.values()) }
}

/**
 * Qué se pierde si se borra este tenant. Se usa para DOS cosas: mostrárselo al agente antes de
 * que confirme, y dejarlo escrito en la auditoría — una vez ejecutado el CASCADE no queda nada
 * que contar, así que si no se toma la foto antes, se pierde para siempre.
 */
async function inventarioTenant(svc: any, tenantId: string) {
  const tabla = async (t: string, col = 'tenant_id') => {
    const { count } = await svc.from(t).select('id', { count: 'exact', head: true }).eq(col, tenantId)
    return count ?? 0
  }
  const [usuarios, sucursales, ventas, productos, clientes, gastos, movimientos] = await Promise.all([
    tabla('users'), tabla('sucursales'), tabla('ventas'), tabla('productos'),
    tabla('clientes'), tabla('gastos'), tabla('movimientos_stock'),
  ])
  // 🛑 Lo fiscal se cuenta aparte: un comprobante con CAE ya fue informado a AFIP y tiene
  // obligación de conservación. No se bloquea acá (esa decisión es del negocio, no de esta
  // función), pero NO puede pasar inadvertido — ver el guard de `confirmFiscal`.
  const { count: conCae } = await svc.from('ventas')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('cae', 'is', null)
  return {
    usuarios, sucursales, ventas, productos, clientes, gastos, movimientos,
    comprobantes_fiscales_con_cae: conCae ?? 0,
  }
}

/**
 * Las cuentas de acceso (auth) del tenant, con su mail. Se toman ANTES del DELETE: el CASCADE
 * borra `users` y después ya no hay forma de saber qué mails quedaron colgados.
 *
 * `es_agente` marca a los que además son agentes del panel de soporte — viven en el MISMO pool de
 * `auth.users` que los clientes (mig 221), así que borrar uno por arrastre dejaría a soporte sin
 * acceso. Nunca se borran.
 */
async function cuentasAuthDelTenant(svc: any, tenantId: string) {
  const { data: filas } = await svc.from('users').select('id, rol, nombre_display').eq('tenant_id', tenantId)
  const out: Array<{ id: string; rol: string; nombre: string | null; email: string | null; es_agente: boolean }> = []
  for (const u of filas ?? []) {
    const { data: authU } = await svc.auth.admin.getUserById(u.id).catch(() => ({ data: null }))
    const { data: ag } = await svc.from('support_agents').select('id').eq('id', u.id).maybeSingle()
    out.push({
      id: u.id, rol: u.rol, nombre: u.nombre_display ?? null,
      email: authU?.user?.email ?? null, es_agente: !!ag,
    })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'No autenticado' }, 401)
    const { data: userData, error: userErr } = await svc.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)
    const uid = userData.user.id

    const { data: agent } = await svc.from('support_agents')
      .select('id, email, nombre, rol, activo').eq('id', uid).eq('activo', true).maybeSingle()
    if (!agent) return json({ error: 'Acceso denegado: no sos un agente activo.' }, 403)

    const { action, ...payload } = await req.json().catch(() => ({ action: '' }))
    if (!action) return json({ error: 'Falta "action"' }, 400)
    const mod = ACTION_MODULE[action]
    if (!mod) return json({ error: `Acción desconocida: ${action}` }, 400)
    if (!(ROLE_MODULES[agent.rol] ?? []).includes(mod)) {
      return json({ error: `Tu rol (${agent.rol}) no tiene acceso a "${mod}".` }, 403)
    }
    const p = payload as any
    const audit = async (extra: Record<string, unknown> = {}) => {
      await svc.from('admin_audit_log').insert({
        agent_id: uid, agent_email: agent.email, action,
        target_tenant_id: p.tenantId ?? null,
        metadata: Object.keys(extra).length ? extra : null,
        user_agent: req.headers.get('user-agent'),
      }).then(() => {}, () => {})
    }

    switch (action) {
      case 'auth.whoami':
        return json({ agent })

      case 'auth.change_password': {
        const pw = String(p.password ?? '')
        if (pw.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
        const { error } = await svc.auth.admin.updateUserById(uid, { password: pw })
        if (error) return json({ error: error.message }, 400)
        await audit({ self_password_change: true })
        return json({ ok: true })
      }

      case 'metrics.overview': {
        const ago30 = new Date(Date.now() - 30 * DAY).toISOString()
        const [t, a30, tickets] = await Promise.all([
          svc.from('tenants').select('id', { count: 'exact', head: true }),
          svc.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', ago30),
          svc.from('support_tickets').select('id', { count: 'exact', head: true }).neq('estado', 'cerrado'),
        ])
        const { data: modos } = await svc.from('tenants').select('modo_operacion')
        const basico = (modos ?? []).filter((m: any) => m.modo_operacion === 'basico').length
        const { mrr } = await computeBilling(svc)

        // Lo que el equipo tiene que MIRAR hoy, no solo el tamaño del negocio. Sale del mismo RPC
        // que la lista de clientes (mig 410) para que los números coincidan con lo que se ve ahí.
        // 🛑 "En trial" NO es `subscription_status === 'trial'`: ese campo se queda en 'trial' para
        // siempre aunque la fecha haya pasado. Al 2026-09-12, 5 de los 6 "en trial" de PROD ya
        // estaban vencidos — contarlos como prueba activa infla el pipeline con gente que ya se fue.
        const { data: overview } = await svc.rpc('fn_admin_tenants_overview', { p_q: null, p_limit: 500 })
        const ahora = Date.now()
        const en7 = ahora + 7 * DAY
        const hace30 = ahora - 30 * DAY
        let trialVigente = 0, trialPorVencer = 0, trialVencido = 0, bajasProgramadas = 0, sinActividad30 = 0
        for (const c of (overview ?? []) as any[]) {
          const fin = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : null
          if (c.subscription_status === 'trial' && fin !== null) {
            if (fin <= ahora) trialVencido++
            else if (fin <= en7) trialPorVencer++
            else trialVigente++
          }
          if (c.delete_scheduled_at) bajasProgramadas++
          const acc = c.ultimo_acceso ? new Date(c.ultimo_acceso).getTime() : null
          if (acc === null || acc < hace30) sinActividad30++
        }

        return json({ metrics: {
          total: t.count ?? 0, altas30: a30.count ?? 0,
          enTrial: trialVigente + trialPorVencer,
          trialPorVencer, trialVencido, bajasProgramadas, sinActividad30,
          ticketsAbiertos: tickets.count ?? 0, basico, avanzado: (modos?.length ?? 0) - basico, mrr,
        } })
      }

      case 'billing.overview': {
        const { mrr, por_plan } = await computeBilling(svc)
        return json({ mrr, por_plan })
      }

      case 'billing.cancel_subscription': {
        if (!p.tenantId) return json({ error: 'Falta tenantId' }, 400)
        const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
        if (!mpToken) return json({ error: 'MP no configurado' }, 500)
        const { mp_cancelled, errores, periodEnd } = await cancelarSubMP(svc, p.tenantId, mpToken)
        // Fail-closed (REGLA #0): si algún preapproval vivo no se pudo cancelar, NO
        // marcamos cancelada la cuenta (seguiría cobrando y el panel mentiría).
        if (errores.length) {
          await audit({ tenantId: p.tenantId, errores })
          return json({ error: 'No se pudo cancelar en Mercado Pago. Reintentá o revisá el panel de MP.', detalle: errores }, 502)
        }
        // MP-C9: el acceso perdura hasta el fin del período pagado.
        const graceEnd = periodEnd ?? new Date(Date.now() + 30 * 86400000).toISOString()
        const { error } = await svc.from('tenants')
          .update({ subscription_status: 'cancelled', subscription_period_end: graceEnd }).eq('id', p.tenantId)
        if (error) return json({ error: 'Se canceló en MP pero no se pudo actualizar la cuenta.' }, 500)
        await audit({ tenantId: p.tenantId, mp_cancelled, period_end: graceEnd })
        return json({ ok: true, mp_cancelled, period_end: graceEnd })
      }

      case 'billing.link_subscription': {
        // Soporte: linkear a un tenant una suscripción MP que quedó HUÉRFANA (activa en MP
        // pero sin linkear en la app). Pasa cuando el checkout-return falló o el cliente cerró
        // la pestaña; como MP manda payer_email/external_reference VACÍOS en checkout por plan,
        // la app no puede autorrecuperarla → soporte la linkea a mano con el preapproval_id.
        // 🛑 REGLA #0: verifica contra MP (authorized + plan nuestro + no reclamada) ANTES de
        // activar, y cancela una suscripción anterior DISTINTA para evitar doble cobro.
        const tenantId = String(p.tenantId ?? '')
        const preId = String(p.preapprovalId ?? '').trim()
        if (!tenantId || !preId) return json({ error: 'Faltan tenantId y preapprovalId' }, 400)
        const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
        if (!mpToken) return json({ error: 'MP no configurado' }, 500)
        const H = { Authorization: `Bearer ${mpToken}` }

        const { data: tRow } = await svc.from('tenants').select('id, mp_subscription_id, plan_tier').eq('id', tenantId).maybeSingle()
        if (!tRow) return json({ error: 'Tenant no encontrado' }, 404)

        // 1) Traer el preapproval de MP
        const gr = await fetch(`${MP}/preapproval/${preId}`, { headers: H })
        if (!gr.ok) return json({ error: `No se encontró el preapproval en Mercado Pago (${gr.status}).` }, 404)
        const sub = await gr.json()
        // 2) Debe estar autorizado (cobrando)
        if (sub?.status !== 'authorized') {
          return json({ error: `El preapproval no está autorizado (estado: ${sub?.status ?? 'desconocido'}). No se activa.` }, 409)
        }
        // 3) Debe ser un plan NUESTRO
        const tier = sub?.preapproval_plan_id ? MP_PLAN_TIER[sub.preapproval_plan_id] : undefined
        if (!tier) return json({ error: `Plan no reconocido (${sub?.preapproval_plan_id ?? 'sin plan'}).` }, 400)
        // 4) Claim exclusivo: no puede estar linkeado a OTRO tenant
        const { data: otro } = await svc.from('tenants')
          .select('id').eq('mp_subscription_id', preId).neq('id', tenantId).maybeSingle()
        if (otro) return json({ error: `Ese preapproval ya está asociado a otro negocio (${otro.id}).` }, 409)

        // 5) Evitar doble cobro: cancelar en MP una suscripción anterior DISTINTA y viva
        let prev_cancel_error: string | null = null
        const prevId = tRow.mp_subscription_id ? String(tRow.mp_subscription_id) : null
        if (prevId && prevId !== preId) {
          try {
            const pg = await fetch(`${MP}/preapproval/${prevId}`, { headers: H })
            const prev = pg.ok ? await pg.json() : null
            if (prev && MP_VIVOS.includes(prev.status)) {
              const put = await fetch(`${MP}/preapproval/${prevId}`, {
                method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
              })
              if (!put.ok) prev_cancel_error = `${prevId}:${put.status}`
            }
          } catch (_) { prev_cancel_error = `${prevId}:excepcion` }
        }

        // 6) Activar (service_role: bypassa el guard server-side de tenants, mig 247)
        // Fase 2 (mig 260): si el tenant YA está linkeado a este mismo preapproval con un
        // tier pago en DB (upgrade por batch — el preapproval sigue en el plan MP original),
        // el tier de DB manda: re-linkear NO debe degradarlo.
        const tierDB = String((tRow as any)?.plan_tier ?? '')
        const mismaSubConTier = prevId === preId && ['basico', 'pro', 'enterprise'].includes(tierDB)
        const { error: updErr } = await svc.from('tenants').update({
          subscription_status: 'active',
          mp_subscription_id: preId,
          ...(mismaSubConTier ? {} : {
            plan_tier: tier,
            max_users: TIER_BASE[tier].max_users,
            max_productos: TIER_BASE[tier].max_productos,
          }),
          subscription_period_end: null, // limpiar el grace de una cancelación anterior (higiene MP-C9)
        }).eq('id', tenantId)
        if (updErr) return json({ error: 'Se verificó en MP pero no se pudo activar la cuenta.' }, 500)

        const tierFinal = mismaSubConTier ? tierDB : tier
        await audit({ tenantId, preapproval_id: preId, tier: tierFinal, prev_cancel_error })
        return json({ ok: true, tier: tierFinal, prev_cancel_error })
      }

      // ── Pago manual (billing_mode='manual') — plan aprobado 2026-07-08 ──────────
      case 'billing.manual_tenants_list': {
        const { data, error } = await svc.from('tenants')
          .select('id, nombre, plan_tier, subscription_status, manual_monto_mensual, manual_paid_until')
          .eq('billing_mode', 'manual').order('manual_paid_until', { ascending: true, nullsFirst: true })
        if (error) throw error
        return json({ tenants: data ?? [] })
      }

      case 'billing.manual_history': {
        if (!p.tenantId) return json({ error: 'Falta tenantId' }, 400)
        const { data, error } = await svc.from('billing_manual_pagos')
          .select('id, monto, medio, referencia, periodo_desde, periodo_hasta, registrado_por, mp_payment_id, notas, created_at')
          .eq('tenant_id', p.tenantId).order('created_at', { ascending: false }).limit(50)
        if (error) throw error
        return json({ pagos: data ?? [] })
      }

      case 'billing.manual_record_payment': {
        const tenantId = String(p.tenantId ?? '')
        const monto = Number(p.monto ?? 0)
        const medio = String(p.medio ?? '')
        if (!tenantId || !(monto > 0)) return json({ error: 'Faltan tenantId y monto' }, 400)
        if (!['transferencia', 'efectivo', 'tarjeta_mp', 'otro'].includes(medio)) {
          return json({ error: 'Medio inválido' }, 400)
        }
        const { data: t } = await svc.from('tenants').select('billing_mode, nombre').eq('id', tenantId).maybeSingle()
        if (!t) return json({ error: 'Tenant no encontrado' }, 404)
        if (t.billing_mode !== 'manual') return json({ error: 'Ese tenant no está en modo de pago manual.' }, 400)

        const { data: hasta, error: rpcErr } = await svc.rpc('fn_registrar_pago_manual', {
          p_tenant_id: tenantId, p_monto: monto, p_medio: medio,
          p_referencia: p.referencia ?? null, p_registrado_por: uid,
          p_mp_payment_id: null, p_notas: p.notas ?? null,
        })
        if (rpcErr) return json({ error: `No se pudo registrar el pago: ${rpcErr.message}` }, 500)

        // Facturación automática de plataforma (fail-open: no bloquea el registro del pago).
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/emitir-factura-plataforma`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              monto, origen_pago: 'manual_staff', tenant_origen_id: tenantId,
              payment_ref: `staff-${tenantId}-${Date.now()}`,
              concepto: `Suscripción Genesis360 — ${t.nombre ?? tenantId} — pago manual (${medio})`,
            }),
          })
        } catch (e) {
          console.error('billing.manual_record_payment: emitir-factura-plataforma falló', e)
        }

        await audit({ tenantId, monto, medio, manual_paid_until: hasta })
        return json({ ok: true, manual_paid_until: hasta })
      }

      case 'billing.platform_facturas_stats': {
        const desdeAnio = new Date(new Date().getFullYear(), 0, 1).toISOString()
        const { data, error } = await svc.from('platform_facturas')
          .select('monto').gte('created_at', desdeAnio)
        if (error) throw error
        const total = (data ?? []).reduce((s: number, f: any) => s + Number(f.monto ?? 0), 0)
        return json({ facturado_anio_actual: total, cantidad: data?.length ?? 0 })
      }

      case 'crm.leads.list': {
        const { data, error } = await svc.from('leads')
          .select('id, nombre, empresa, email, telefono, estado, valor_estimado, origen, asignado_a, created_at, updated_at')
          .order('updated_at', { ascending: false }).limit(300)
        if (error) throw error
        return json({ leads: data ?? [] })
      }

      case 'crm.leads.create': {
        if (!p.nombre) return json({ error: 'Falta nombre' }, 400)
        const { data, error } = await svc.from('leads').insert({
          nombre: p.nombre, empresa: p.empresa ?? null, email: p.email ?? null, telefono: p.telefono ?? null,
          estado: p.estado ?? 'lead', valor_estimado: p.valorEstimado ?? null, origen: p.origen ?? null,
          notas: p.notas ?? null, asignado_a: uid,
        }).select('id').single()
        if (error) throw error
        return json({ ok: true, id: data.id })
      }

      case 'crm.leads.update': {
        if (!p.leadId) return json({ error: 'Falta leadId' }, 400)
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        for (const k of ['nombre', 'empresa', 'email', 'telefono', 'estado', 'origen', 'notas'] as const) {
          if (p[k] !== undefined) patch[k] = p[k]
        }
        if (p.valorEstimado !== undefined) patch.valor_estimado = p.valorEstimado
        const { error } = await svc.from('leads').update(patch).eq('id', p.leadId)
        if (error) throw error
        return json({ ok: true })
      }

      case 'customers.list': {
        // mig 410 — la búsqueda ya no es solo por nombre del negocio: también por el mail (o el
        // nombre) del dueño, por el mail de cualquier usuario y por el id del tenant. El que
        // escribe a soporte lo hace desde su mail, que era justo con lo que no se podía buscar.
        // Los mails viven en `auth.users`, fuera del alcance de PostgREST → RPC SECURITY DEFINER.
        const { data, error } = await svc.rpc('fn_admin_tenants_overview', {
          p_q: p.q?.trim() || null,
          p_limit: 200,
        })
        if (error) throw error
        await audit({ q: p.q ?? null, count: data?.length ?? 0 })
        return json({ customers: data ?? [] })
      }

      case 'customers.get': {
        if (!p.tenantId) return json({ error: 'Falta tenantId' }, 400)
        const { data: tenant, error } = await svc.from('tenants')
          .select('id, nombre, plan_id, plan_tier, billing_mode, modo_operacion, created_at, trial_ends_at, '
            + 'inicio_actividades, subscription_status, subscription_period_end, delete_scheduled_at, '
            + 'pais, tipo_comercio, moneda, mp_subscription_id, '
            // Estado fiscal: es lo primero que pregunta un cliente que no puede facturar.
            + 'cuit, condicion_iva_emisor, razon_social_fiscal, facturacion_habilitada, afip_produccion, afip_provider')
          .eq('id', p.tenantId).maybeSingle()
        if (error) throw error
        if (!tenant) return json({ error: 'Tenant no encontrado' }, 404)
        const ago30 = new Date(Date.now() - 30 * DAY).toISOString()
        const [usuarios, sucursales, ventasTotal, ventas30, ticketsAbiertos] = await Promise.all([
          svc.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId),
          svc.from('sucursales').select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId),
          svc.from('ventas').select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId),
          svc.from('ventas').select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId).gte('created_at', ago30),
          svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId).neq('estado', 'cerrado'),
        ])
        const { data: recientes } = await svc.from('ventas')
          .select('numero, total, estado, created_at').eq('tenant_id', p.tenantId)
          .order('created_at', { ascending: false }).limit(5)
        // Quién puede entrar a este negocio, con qué mail y cuándo entró por última vez (mig 410).
        // Antes solo se veía el CONTADOR de usuarios, que no sirve para identificar a nadie.
        const { data: cuentas } = await svc.rpc('fn_admin_tenant_cuentas', { p_tenant_id: p.tenantId })
        // Cuánto emitió: distingue "no factura porque no configuró" de "no factura porque falla".
        const { count: comprobantes } = await svc.from('ventas')
          .select('id', { count: 'exact', head: true }).eq('tenant_id', p.tenantId).not('cae', 'is', null)
        await audit({ tenantId: p.tenantId })
        return json({
          tenant,
          stats: {
            usuarios: usuarios.count ?? 0, sucursales: sucursales.count ?? 0,
            ventas_total: ventasTotal.count ?? 0, ventas_30d: ventas30.count ?? 0,
            tickets_abiertos: ticketsAbiertos.count ?? 0,
            ultima_venta_at: recientes?.[0]?.created_at ?? null,
            comprobantes_con_cae: comprobantes ?? 0,
          },
          cuentas: cuentas ?? [],
          recent_sales: recientes ?? [],
        })
      }

      // ── Baja de un tenant (soporte) ───────────────────────────────────────────────────────
      // Complementa el camino self-service del cliente (MiCuentaPage → `delete_scheduled_at`).
      // Dos diferencias con aquel: acá puede purgarse SIN esperar los 30 días, y queda auditado
      // con nombre y apellido del agente que lo pidió.
      //
      // 🛑 Guard de rol: el módulo es `customers`, que `support` también tiene. Borrar un negocio
      // entero no es una tarea de soporte — se exige `admin` explícitamente.
      case 'customers.delete_preview':
      case 'customers.schedule_delete':
      case 'customers.cancel_delete':
      case 'customers.purge_now': {
        if (agent.rol !== 'admin') {
          return json({ error: `Solo un agente con rol "admin" puede dar de baja un negocio (tu rol: ${agent.rol}).` }, 403)
        }
        if (!p.tenantId) return json({ error: 'Falta tenantId' }, 400)

        const { data: tenant } = await svc.from('tenants')
          .select('id, nombre, subscription_status, delete_scheduled_at, mp_subscription_id')
          .eq('id', p.tenantId).maybeSingle()
        if (!tenant) return json({ error: 'Tenant no encontrado' }, 404)

        if (action === 'customers.delete_preview') {
          const inv = await inventarioTenant(svc, p.tenantId)
          const cuentas = await cuentasAuthDelTenant(svc, p.tenantId)
          await audit({ preview: true })
          return json({ tenant, inventario: inv, cuentas, cobro_vivo: cobroVivo(tenant) })
        }

        if (action === 'customers.cancel_delete') {
          const { error } = await svc.from('tenants')
            .update({ delete_scheduled_at: null }).eq('id', p.tenantId)
          if (error) throw error
          await audit({ cancelada: true, tenant_nombre: tenant.nombre })
          return json({ ok: true, tenant: tenant.nombre })
        }

        // Para programar o purgar: el agente tiene que escribir el nombre exacto. Es la misma
        // barrera que la app le pone al dueño — un `tenantId` mal copiado borra el negocio
        // equivocado y no hay vuelta atrás.
        if (String(p.confirmNombre ?? '').trim() !== String(tenant.nombre ?? '').trim()) {
          return json({ error: `Para confirmar, escribí el nombre exacto del negocio: "${tenant.nombre}"` }, 400)
        }

        const inv = await inventarioTenant(svc, p.tenantId)

        // 🛑 REGLA #0 — comprobantes ya informados a AFIP. No se bloquea (puede haber un motivo
        // legítimo: un tenant de prueba que emitió en homologación), pero exige un segundo sí
        // explícito para que nadie los borre sin enterarse de que existían.
        if (inv.comprobantes_fiscales_con_cae > 0 && p.confirmFiscal !== true) {
          return json({
            error: `Este negocio tiene ${inv.comprobantes_fiscales_con_cae} comprobante(s) con CAE ya informados a AFIP. `
              + 'Borrarlos elimina documentación fiscal con obligación de conservación. '
              + 'Si aun así corresponde, reenviá la baja confirmando explícitamente.',
            requiere_confirmacion_fiscal: true,
            comprobantes_fiscales_con_cae: inv.comprobantes_fiscales_con_cae,
          }, 409)
        }

        // 🛑 REGLA #0 - PLATA: si el tenant tiene un preapproval vivo en Mercado Pago, borrarlo
        // NO frena el cobro: el preapproval vive en MP, no acá. Se le seguiría debitando a un
        // cliente cuyo negocio ya no existe, y tras el CASCADE no queda ni el `mp_subscription_id`
        // para rastrearlo. Se cancela ANTES y fail-closed: si MP no confirma, no se borra nada.
        // Es lo mismo que hace el camino self-service del dueño (MiCuentaPage -> cancel-suscripcion).
        // Se llama SIEMPRE, sin preguntar antes si "parece" que hay cobro. Un tenant cuyo checkout
        // nunca se linkeó no tiene `mp_subscription_id` ni estado 'active' y aun así puede estar
        // siendo cobrado: `cancelarSubMP` lo busca por el mail del dueño (H8/MP-C7). Preguntar
        // primero era justamente saltear ese caso. Si no hay nada que cancelar, no cancela nada.
        const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
        if (!mpToken) return json({ error: 'MP no configurado: no se puede frenar el cobro antes de dar de baja.' }, 500)
        const rMp = await cancelarSubMP(svc, p.tenantId, mpToken)
        if (rMp.errores.length) {
          await audit({ abortada: true, motivo: 'mp_no_confirmo', errores: rMp.errores })
          return json({
            error: 'No se pudo cancelar la suscripción en Mercado Pago, así que NO se dio de baja nada: '
              + 'el cliente seguiría siendo cobrado por un negocio borrado. Reintentá o cancelala desde el panel de MP.',
            detalle: rMp.errores,
          }, 502)
        }
        const mpCancelled = rMp.mp_cancelled
        // Solo se toca el estado de la cuenta si de verdad se canceló algo: si no había nada vivo,
        // marcar 'cancelled' mentiría sobre un tenant que quizá estaba en trial.
        if (mpCancelled > 0) {
          // MP-C9: el período ya pagado se respeta. En `schedule_delete` esto además le deja el
          // acceso vigente durante la ventana, por si quiere cancelar la baja.
          await svc.from('tenants').update({
            subscription_status: 'cancelled',
            subscription_period_end: rMp.periodEnd ?? new Date(Date.now() + 30 * DAY).toISOString(),
          }).eq('id', p.tenantId)
        }

        if (action === 'customers.schedule_delete') {
          const dias = Number.isFinite(Number(p.dias)) ? Math.max(0, Number(p.dias)) : 30
          const fecha = new Date(Date.now() + dias * DAY)
          const { error } = await svc.from('tenants')
            .update({ delete_scheduled_at: fecha.toISOString() }).eq('id', p.tenantId)
          if (error) throw error
          await audit({ programada_para: fecha.toISOString(), dias, tenant_nombre: tenant.nombre, inventario: inv, mp_cancelled: mpCancelled })
          return json({
            ok: true, delete_scheduled_at: fecha.toISOString(), inventario: inv, mp_cancelled: mpCancelled,
            // La cancelación en MP no se deshace sola: `cancel_delete` revive el negocio, no el cobro.
            aviso_mp: mpCancelled > 0
              ? 'Se canceló la suscripción en Mercado Pago. Si después se cancela la baja, el cliente tiene que volver a suscribirse.'
              : null,
          })
        }

        // purge_now - irreversible. El CASCADE de las ~140 FK a tenant_id hace el resto (mig 358).
        // Las cuentas de acceso se resuelven ANTES del DELETE: el CASCADE borra `users` y después
        // ya no hay de dónde sacarlas. Se resuelven acá y NO se aceptan del cliente: una lista de
        // uuids mandada por el panel podría borrar cuentas de cualquier otro tenant.
        const cuentas = await cuentasAuthDelTenant(svc, p.tenantId)
        await audit({ purge_now: true, tenant_nombre: tenant.nombre, inventario: inv, cuentas, mp_cancelled: mpCancelled })
        const { error: delErr } = await svc.from('tenants').delete().eq('id', p.tenantId)
        if (delErr) throw delErr

        // El sweep programado NO toca `auth.users` (borra el tenant y deja la cuenta huérfana:
        // el mail queda sin negocio pero existiendo). Acá se ofrece cerrar el círculo, porque
        // "dar de baja" desde soporte se espera que deje el mail realmente libre.
        const authBorrados: Array<{ id: string; email: string | null }> = []
        const authOmitidos: Array<{ id: string; email: string | null; motivo: string }> = []
        if (p.borrarUsuariosAuth === true) {
          for (const c of cuentas) {
            if (c.es_agente) { authOmitidos.push({ id: c.id, email: c.email, motivo: 'es agente del panel de soporte' }); continue }
            // Defensa extra: si tras el CASCADE todavía tiene fila en `users`, pertenece a otro
            // negocio y su mail no es nuestro para borrar.
            const { data: sigue } = await svc.from('users').select('id').eq('id', c.id).maybeSingle()
            if (sigue) { authOmitidos.push({ id: c.id, email: c.email, motivo: 'pertenece a otro negocio' }); continue }
            const { error } = await svc.auth.admin.deleteUser(c.id)
            if (error) authOmitidos.push({ id: c.id, email: c.email, motivo: error.message })
            else authBorrados.push({ id: c.id, email: c.email })
          }
          await audit({ purge_now: true, auth_users_borrados: authBorrados, auth_users_omitidos: authOmitidos })
        }

        return json({
          ok: true, purgado: tenant.nombre, inventario: inv, mp_cancelled: mpCancelled,
          auth_users_borrados: authBorrados, auth_users_omitidos: authOmitidos,
        })
      }

      // Extender la prueba gratuita. Es la herramienta que más se pide en soporte ("se me venció
      // mientras lo estaba probando") y hasta hoy había que hacerlo con SQL a mano contra PROD.
      case 'customers.extend_trial': {
        if (agent.rol !== 'admin') {
          return json({ error: `Solo un agente con rol "admin" puede extender una prueba (tu rol: ${agent.rol}).` }, 403)
        }
        const dias = Number(p.dias)
        if (!Number.isFinite(dias) || dias < 1 || dias > 365) {
          return json({ error: 'Indicá entre 1 y 365 días.' }, 400)
        }
        const { data: t } = await svc.from('tenants')
          .select('id, nombre, subscription_status, trial_ends_at').eq('id', p.tenantId).maybeSingle()
        if (!t) return json({ error: 'Tenant no encontrado' }, 404)
        // 🛑 No tocar una suscripción PAGA: extenderle el trial a alguien que está pagando no
        // tiene sentido y puede confundir el estado de su cuenta.
        if (t.subscription_status === 'active') {
          return json({ error: 'Esta cuenta tiene una suscripción activa; no corresponde extender la prueba.' }, 409)
        }
        // Desde HOY si ya venció, o desde la fecha original si todavía corre: así "7 días" siempre
        // significa 7 días de uso real y no se pierden extendiendo una prueba ya vencida.
        const base = t.trial_ends_at && new Date(t.trial_ends_at) > new Date()
          ? new Date(t.trial_ends_at) : new Date()
        const nueva = new Date(base.getTime() + dias * DAY)
        const { error } = await svc.from('tenants')
          .update({ subscription_status: 'trial', trial_ends_at: nueva.toISOString() }).eq('id', p.tenantId)
        if (error) throw error
        await audit({ tenantId: p.tenantId, tenant_nombre: t.nombre, dias, trial_ends_at: nueva.toISOString(), anterior: t.trial_ends_at })
        return json({ ok: true, trial_ends_at: nueva.toISOString() })
      }

      // Mandarle al usuario un mail de recuperación. NO setea una contraseña desde el panel: un
      // agente no debería poder elegir la clave con la que después entra alguien.
      case 'customers.reset_password': {
        if (agent.rol !== 'admin') {
          return json({ error: `Solo un agente con rol "admin" puede disparar un reseteo (tu rol: ${agent.rol}).` }, 403)
        }
        const email = String(p.email ?? '').trim().toLowerCase()
        if (!email) return json({ error: 'Falta el email' }, 400)
        // Que el mail sea REALMENTE de ese tenant: si no, el panel serviría para mandar mails de
        // recuperación a cualquier dirección.
        const { data: cuentas } = await svc.rpc('fn_admin_tenant_cuentas', { p_tenant_id: p.tenantId })
        const pertenece = (cuentas ?? []).some((c: any) => String(c.email ?? '').toLowerCase() === email)
        if (!pertenece) return json({ error: 'Ese mail no pertenece a este negocio.' }, 403)
        // ⚠️ `generateLink` NO manda el mail: solo devuelve el link. En este proyecto el envío va
        // por la EF `send-email` (Resend) — mismo patrón que `invitar-proveedor`. Sin este segundo
        // paso el panel diría "mail enviado" y no llegaría nada.
        const { data: link, error } = await svc.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'}/login` },
        })
        if (error) return json({ error: error.message }, 400)
        const actionLink = link?.properties?.action_link
        if (!actionLink) return json({ error: 'No se pudo generar el link de recuperación.' }, 500)

        const mailRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'notificacion',
            to: email,
            data: {
              titulo: 'Restablecé tu contraseña de Genesis360',
              mensaje: 'Pediste (o soporte pidió por vos) restablecer tu contraseña. Entrá al enlace para elegir una nueva. Si no fuiste vos, ignorá este mail: tu contraseña actual sigue funcionando.',
              action_url: actionLink,
            },
          }),
        })
        // Fail-closed en el AVISO: si el mail no salió, el agente tiene que enterarse — si no, se
        // queda esperando a un cliente que nunca recibió nada.
        if (!mailRes.ok) {
          await audit({ tenantId: p.tenantId, reset_password_para: email, envio_fallo: mailRes.status })
          return json({ error: `Se generó el link pero el mail no se pudo enviar (${mailRes.status}). Reintentá.` }, 502)
        }
        await audit({ tenantId: p.tenantId, reset_password_para: email })
        return json({ ok: true, email })
      }

      // El registro de lo que hizo el equipo de soporte. La tabla existía desde la mig 221 y se
      // escribía en cada acción, pero no había forma de LEERLA: una auditoría que nadie puede
      // mirar no audita nada.
      case 'audit.list': {
        let q = svc.from('admin_audit_log')
          .select('id, agent_email, action, target_tenant_id, metadata, created_at')
          .order('created_at', { ascending: false }).limit(Math.min(Number(p.limit) || 100, 500))
        if (p.tenantId) q = q.eq('target_tenant_id', p.tenantId)
        if (p.agentEmail) q = q.eq('agent_email', p.agentEmail)
        if (p.action) q = q.eq('action', p.action)
        const { data, error } = await q
        if (error) throw error

        // 🛑 El nombre del negocio se resuelve APARTE, no con un embed de PostgREST. No hay —ni
        // debe haber— FK de `admin_audit_log.target_tenant_id` a `tenants`: con CASCADE, purgar un
        // negocio borraría el registro de su propia baja, y con SET NULL se perdería a quién se le
        // hizo. La auditoría tiene que SOBREVIVIR al borrado de lo auditado.
        const ids = [...new Set((data ?? []).map((e: any) => e.target_tenant_id).filter(Boolean))]
        const nombres = new Map<string, string | null>()
        if (ids.length) {
          const { data: ts } = await svc.from('tenants').select('id, nombre').in('id', ids)
          for (const t of ts ?? []) nombres.set(t.id, t.nombre)
        }
        const entries = (data ?? []).map((e: any) => ({
          ...e,
          // `null` cuando el negocio ya no existe: es justamente el caso de una purga.
          tenants: e.target_tenant_id ? { nombre: nombres.get(e.target_tenant_id) ?? null } : null,
        }))
        return json({ entries })
      }

      case 'impersonation.start':
        // "Ver como cliente" read-only se resuelve hoy con el snapshot de customers.get.
        // La sesión real read-only en la app principal queda como mejora futura (requiere
        // soporte de read-only + token efímero en Genesis360).
        return json({ error: 'Login-as en la app real pendiente. Usá la Vista por Cliente (read-only).', _todo: true }, 501)

      // ── Tickets ──────────────────────────────────────────────────────────
      case 'support.tickets.list': {
        let q = svc.from('support_tickets')
          .select('id, asunto, estado, prioridad, asignado_a, tenant_id, created_at, updated_at, tenants(nombre)')
          .order('updated_at', { ascending: false }).limit(200)
        if (p.estado) q = q.eq('estado', p.estado)
        if (p.tenantId) q = q.eq('tenant_id', p.tenantId)
        if (p.asignadoA === 'me') q = q.eq('asignado_a', uid)
        const { data, error } = await q
        if (error) throw error
        return json({ tickets: data ?? [] })
      }

      case 'support.tickets.get': {
        if (!p.ticketId) return json({ error: 'Falta ticketId' }, 400)
        const { data: ticket, error } = await svc.from('support_tickets')
          .select('*, tenants(nombre)').eq('id', p.ticketId).maybeSingle()
        if (error) throw error
        if (!ticket) return json({ error: 'Ticket no encontrado' }, 404)
        const { data: mensajes } = await svc.from('support_messages')
          .select('id, autor_tipo, autor_id, cuerpo, created_at').eq('ticket_id', p.ticketId).order('created_at')
        await audit({ ticketId: p.ticketId })
        return json({ ticket, mensajes: mensajes ?? [] })
      }

      case 'support.tickets.create': {
        if (!p.tenantId || !p.asunto) return json({ error: 'Faltan tenantId y asunto' }, 400)
        const { data: ticket, error } = await svc.from('support_tickets').insert({
          tenant_id: p.tenantId, asunto: p.asunto,
          prioridad: p.prioridad ?? 'media', creado_por: uid, asignado_a: uid,
        }).select('id').single()
        if (error) throw error
        if (p.cuerpo?.trim()) {
          await svc.from('support_messages').insert({
            ticket_id: ticket.id, autor_tipo: 'agente', autor_id: uid, cuerpo: p.cuerpo.trim(),
          })
        }
        await audit({ ticketId: ticket.id, asunto: p.asunto })
        return json({ ok: true, id: ticket.id })
      }

      case 'support.tickets.reply': {
        if (!p.ticketId || !p.cuerpo?.trim()) return json({ error: 'Faltan ticketId y cuerpo' }, 400)
        const { error } = await svc.from('support_messages').insert({
          ticket_id: p.ticketId, autor_tipo: 'agente', autor_id: uid, cuerpo: p.cuerpo.trim(),
        })
        if (error) throw error
        await svc.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', p.ticketId)
        await audit({ ticketId: p.ticketId })
        return json({ ok: true })
      }

      case 'support.tickets.update': {
        if (!p.ticketId) return json({ error: 'Falta ticketId' }, 400)
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (p.estado) patch.estado = p.estado
        if (p.prioridad) patch.prioridad = p.prioridad
        if (p.asignadoA !== undefined) patch.asignado_a = p.asignadoA
        if (p.estado === 'cerrado') patch.closed_at = new Date().toISOString()
        const { error } = await svc.from('support_tickets').update(patch).eq('id', p.ticketId)
        if (error) throw error
        await audit({ ticketId: p.ticketId, ...patch })
        return json({ ok: true })
      }

      // ── Gestión de agentes (admin) ───────────────────────────────────────
      case 'agents.list': {
        const { data, error } = await svc.from('support_agents')
          .select('id, email, nombre, rol, activo, created_at').order('created_at')
        if (error) throw error
        return json({ agents: data ?? [] })
      }

      case 'agents.create': {
        const { email, nombre, rol, password } = p
        if (!email || !password) return json({ error: 'Email y contraseña son obligatorios' }, 400)
        if (!ROLES.includes(rol)) return json({ error: `Rol inválido (${ROLES.join(', ')})` }, 400)
        const { data: created, error: cErr } = await svc.auth.admin.createUser({
          email, password, email_confirm: true, app_metadata: { staff: true }, user_metadata: { nombre: nombre ?? null },
        })
        if (cErr || !created?.user) return json({ error: cErr?.message ?? 'No se pudo crear el usuario' }, 400)
        const { error: insErr } = await svc.from('support_agents')
          .insert({ id: created.user.id, email, nombre: nombre ?? null, rol, activo: true })
        if (insErr) { await svc.auth.admin.deleteUser(created.user.id).catch(() => {}); throw insErr }
        await audit({ created_agent: email, rol })
        return json({ ok: true, id: created.user.id })
      }

      case 'agents.update': {
        const { agentId, rol, activo } = p
        if (!agentId) return json({ error: 'Falta agentId' }, 400)
        if (rol !== undefined && !ROLES.includes(rol)) return json({ error: 'Rol inválido' }, 400)
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (rol !== undefined) patch.rol = rol
        if (activo !== undefined) patch.activo = activo
        const { error } = await svc.from('support_agents').update(patch).eq('id', agentId)
        if (error) throw error
        if (activo !== undefined) await svc.auth.admin.updateUserById(agentId, { app_metadata: { staff: !!activo } }).catch(() => {})
        await audit({ agentId, rol, activo })
        return json({ ok: true })
      }

      default:
        return json({ error: `Acción desconocida: ${action}` }, 400)
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
