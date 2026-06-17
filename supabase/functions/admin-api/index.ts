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
}
const ROLES = ['admin', 'support', 'marketing', 'billing']
const DAY = 86400000

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
        return json({ metrics: {
          total: t.count ?? 0, altas30: a30.count ?? 0, enTrial: trial.count ?? 0,
          ticketsAbiertos: tickets.count ?? 0, basico, avanzado: (modos?.length ?? 0) - basico,
        } })
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
          .select('id, nombre, plan_id, modo_operacion, created_at, trial_ends_at, inicio_actividades')
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
