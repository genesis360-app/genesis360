import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ───────────────────────────────────────────────────────────────────────────
// admin-api — capa de datos del PANEL INTERNO DE SOPORTE (admin.genesis360.pro).
//
// Toda lectura cross-tenant del panel pasa por acá. La EF:
//   1) identifica al caller por su JWT,
//   2) valida que es un AGENTE de soporte activo (tabla support_agents) — autoridad de runtime,
//   3) AUDITA el acceso en admin_audit_log,
//   4) devuelve la data usando service_role (bypassa la RLS por-tenant, que queda intacta).
//
// El service_role NUNCA sale de acá. El panel solo llama esta EF con el JWT del agente.
// ───────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // 1) Identificar al caller por su JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'No autenticado' }, 401)

    const { data: userData, error: userErr } = await svc.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)
    const uid = userData.user.id

    // 2) ¿Es un agente de soporte ACTIVO? (autoridad de runtime — revocar = activo=false)
    const { data: agent } = await svc
      .from('support_agents')
      .select('id, email, nombre, rol, activo')
      .eq('id', uid)
      .eq('activo', true)
      .maybeSingle()
    if (!agent) return json({ error: 'Acceso denegado: no sos un agente de soporte activo.' }, 403)

    const { action, ...payload } = await req.json().catch(() => ({ action: '' }))
    if (!action) return json({ error: 'Falta "action"' }, 400)

    // Helper de auditoría (append-only). Best-effort: no bloquea la respuesta si falla el log.
    const audit = async (extra: Record<string, unknown> = {}) => {
      await svc.from('admin_audit_log').insert({
        agent_id: uid,
        agent_email: agent.email,
        action,
        target_tenant_id: (payload as any).tenantId ?? null,
        metadata: Object.keys(extra).length ? extra : null,
        user_agent: req.headers.get('user-agent'),
      }).then(() => {}, () => {})
    }

    // 3) Dispatch
    switch (action) {
      case 'auth.whoami': {
        // No audita (no accede a datos de clientes) — solo confirma identidad de agente.
        return json({ agent })
      }

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
        // Algunos agregados livianos para la "Vista por Cliente"
        const { count: usuarios } = await svc.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
        await audit({ tenantId })
        return json({ tenant, stats: { usuarios: usuarios ?? 0 } })
      }

      case 'support.tickets.list': {
        // Stub (Fase 1/2): la tabla support_tickets se crea más adelante.
        return json({ tickets: [], _note: 'support_tickets pendiente (Fase 1/2)' })
      }

      case 'impersonation.start': {
        // Stub (Fase 1): "Ver como cliente" = sesión real read-only + token efímero + auditada.
        return json({ error: 'Impersonación pendiente (Fase 1).', _todo: true }, 501)
      }

      default:
        return json({ error: `Acción desconocida: ${action}` }, 400)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: msg }, 500)
  }
})
