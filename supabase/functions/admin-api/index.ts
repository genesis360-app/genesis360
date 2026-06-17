import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ───────────────────────────────────────────────────────────────────────────
// admin-api — capa de datos del PANEL INTERNO (admin.genesis360.pro).
//
// 1) identifica al caller por su JWT, 2) valida que es agente activo (support_agents),
// 3) AUTORIZA por rol (cada acción pertenece a un módulo; el rol debe tener ese módulo),
// 4) AUDITA, 5) devuelve data con service_role (la RLS por-tenant queda intacta).
// El service_role NUNCA sale de acá.
// ───────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Matriz rol → módulos (espejo de config/permissions.ts del frontend).
const ROLE_MODULES: Record<string, string[]> = {
  admin:     ['dashboard', 'customers', 'crm', 'support', 'analytics', 'billing', 'users'],
  support:   ['dashboard', 'customers', 'support'],
  marketing: ['dashboard', 'crm', 'analytics'],
  billing:   ['dashboard', 'billing'],
}

// Cada acción pertenece a un módulo (el gate exige que el rol del agente lo incluya).
const ACTION_MODULE: Record<string, string> = {
  'auth.whoami': 'dashboard',          // todos los roles tienen dashboard → siempre pueden saber quiénes son
  'metrics.overview': 'dashboard',
  'customers.list': 'customers',
  'customers.get': 'customers',
  'impersonation.start': 'customers',
  'support.tickets.list': 'support',
  'crm.leads.list': 'crm',
  'analytics.overview': 'analytics',
  'billing.overview': 'billing',
  'agents.list': 'users',
  'agents.create': 'users',
  'agents.update': 'users',
}

const ROLES = ['admin', 'support', 'marketing', 'billing']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    // 1) Identificar al caller
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'No autenticado' }, 401)
    const { data: userData, error: userErr } = await svc.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)
    const uid = userData.user.id

    // 2) ¿Agente activo?
    const { data: agent } = await svc
      .from('support_agents').select('id, email, nombre, rol, activo')
      .eq('id', uid).eq('activo', true).maybeSingle()
    if (!agent) return json({ error: 'Acceso denegado: no sos un agente activo.' }, 403)

    const { action, ...payload } = await req.json().catch(() => ({ action: '' }))
    if (!action) return json({ error: 'Falta "action"' }, 400)

    // 3) Autorización por rol/módulo (seguridad real — el front solo oculta)
    const mod = ACTION_MODULE[action]
    if (!mod) return json({ error: `Acción desconocida: ${action}` }, 400)
    if (!(ROLE_MODULES[agent.rol] ?? []).includes(mod)) {
      return json({ error: `Tu rol (${agent.rol}) no tiene acceso a "${mod}".` }, 403)
    }

    const audit = async (extra: Record<string, unknown> = {}) => {
      await svc.from('admin_audit_log').insert({
        agent_id: uid, agent_email: agent.email, action,
        target_tenant_id: (payload as any).tenantId ?? null,
        metadata: Object.keys(extra).length ? extra : null,
        user_agent: req.headers.get('user-agent'),
      }).then(() => {}, () => {})
    }

    // 4) Dispatch
    switch (action) {
      case 'auth.whoami':
        return json({ agent })

      case 'customers.list': {
        const q = (payload as any).q as string | undefined
        let query = svc.from('tenants').select('id, nombre, created_at').order('created_at', { ascending: false }).limit(100)
        if (q && q.trim()) query = query.ilike('nombre', `%${q.trim()}%`)
        const { data, error } = await query
        if (error) throw error
        await audit({ q: q ?? null, count: data?.length ?? 0 })
        return json({ customers: data ?? [] })
      }

      case 'customers.get': {
        const tenantId = (payload as any).tenantId as string
        if (!tenantId) return json({ error: 'Falta tenantId' }, 400)
        const { data: tenant, error } = await svc.from('tenants').select('*').eq('id', tenantId).maybeSingle()
        if (error) throw error
        if (!tenant) return json({ error: 'Tenant no encontrado' }, 404)
        const { count: usuarios } = await svc.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
        await audit({ tenantId })
        return json({ tenant, stats: { usuarios: usuarios ?? 0 } })
      }

      case 'support.tickets.list':
        return json({ tickets: [], _note: 'support_tickets pendiente (Fase 1/2)' })

      case 'impersonation.start':
        return json({ error: 'Impersonación pendiente (Fase 1).', _todo: true }, 501)

      // ── Gestión de agentes (solo rol admin, gateado por módulo 'users') ──
      case 'agents.list': {
        const { data, error } = await svc.from('support_agents')
          .select('id, email, nombre, rol, activo, created_at').order('created_at', { ascending: true })
        if (error) throw error
        return json({ agents: data ?? [] })
      }

      case 'agents.create': {
        const { email, nombre, rol, password } = payload as any
        if (!email || !password) return json({ error: 'Email y contraseña son obligatorios' }, 400)
        if (!ROLES.includes(rol)) return json({ error: `Rol inválido. Usá uno de: ${ROLES.join(', ')}` }, 400)
        const { data: created, error: cErr } = await svc.auth.admin.createUser({
          email, password, email_confirm: true,
          app_metadata: { staff: true }, user_metadata: { nombre: nombre ?? null },
        })
        if (cErr || !created?.user) return json({ error: cErr?.message ?? 'No se pudo crear el usuario' }, 400)
        const { error: insErr } = await svc.from('support_agents')
          .insert({ id: created.user.id, email, nombre: nombre ?? null, rol, activo: true })
        if (insErr) {
          // rollback del auth user si falla el alta del agente
          await svc.auth.admin.deleteUser(created.user.id).catch(() => {})
          throw insErr
        }
        await audit({ created_agent: email, rol })
        return json({ ok: true, id: created.user.id })
      }

      case 'agents.update': {
        const { agentId, rol, activo } = payload as any
        if (!agentId) return json({ error: 'Falta agentId' }, 400)
        if (rol !== undefined && !ROLES.includes(rol)) return json({ error: 'Rol inválido' }, 400)
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (rol !== undefined) patch.rol = rol
        if (activo !== undefined) patch.activo = activo
        const { error } = await svc.from('support_agents').update(patch).eq('id', agentId)
        if (error) throw error
        // El claim staff sigue a `activo` (defensa en profundidad; la autoridad de runtime es support_agents.activo)
        if (activo !== undefined) {
          await svc.auth.admin.updateUserById(agentId, { app_metadata: { staff: !!activo } }).catch(() => {})
        }
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
