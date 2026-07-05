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
        const nowIso = new Date().toISOString()
        const [t, a30, trial, tickets] = await Promise.all([
          svc.from('tenants').select('id', { count: 'exact', head: true }),
          svc.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', ago30),
          svc.from('tenants').select('id', { count: 'exact', head: true }).gt('trial_ends_at', nowIso),
          svc.from('support_tickets').select('id', { count: 'exact', head: true }).neq('estado', 'cerrado'),
        ])
        const { data: modos } = await svc.from('tenants').select('modo_operacion')
        const basico = (modos ?? []).filter((m: any) => m.modo_operacion === 'basico').length
        const { mrr } = await computeBilling(svc)
        return json({ metrics: {
          total: t.count ?? 0, altas30: a30.count ?? 0, enTrial: trial.count ?? 0,
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

        const { data: tRow } = await svc.from('tenants').select('id, mp_subscription_id').eq('id', tenantId).maybeSingle()
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
        const { error: updErr } = await svc.from('tenants').update({
          subscription_status: 'active',
          mp_subscription_id: preId,
          plan_tier: tier,
          max_users: TIER_BASE[tier].max_users,
          max_productos: TIER_BASE[tier].max_productos,
          subscription_period_end: null, // limpiar el grace de una cancelación anterior (higiene MP-C9)
        }).eq('id', tenantId)
        if (updErr) return json({ error: 'Se verificó en MP pero no se pudo activar la cuenta.' }, 500)

        await audit({ tenantId, preapproval_id: preId, tier, prev_cancel_error })
        return json({ ok: true, tier, prev_cancel_error })
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
        let query = svc.from('tenants').select('id, nombre, created_at').order('created_at', { ascending: false }).limit(100)
        if (p.q?.trim()) query = query.ilike('nombre', `%${p.q.trim()}%`)
        const { data, error } = await query
        if (error) throw error
        await audit({ q: p.q ?? null, count: data?.length ?? 0 })
        return json({ customers: data ?? [] })
      }

      case 'customers.get': {
        if (!p.tenantId) return json({ error: 'Falta tenantId' }, 400)
        const { data: tenant, error } = await svc.from('tenants')
          .select('id, nombre, plan_id, modo_operacion, created_at, trial_ends_at, inicio_actividades, subscription_status')
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
        await audit({ tenantId: p.tenantId })
        return json({
          tenant,
          stats: {
            usuarios: usuarios.count ?? 0, sucursales: sucursales.count ?? 0,
            ventas_total: ventasTotal.count ?? 0, ventas_30d: ventas30.count ?? 0,
            tickets_abiertos: ticketsAbiertos.count ?? 0,
            ultima_venta_at: recientes?.[0]?.created_at ?? null,
          },
          recent_sales: recientes ?? [],
        })
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
