import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─── Cancelación de suscripción (REGLA #0 — billing) ──────────────────────────
// Cancela el/los preapproval(s) del tenant en Mercado Pago y recién ahí marca la
// cuenta como 'cancelled'. Reemplaza el flujo roto anterior (llamaba a un EF que no
// existía cuando había mp_subscription_id, y hacía un UPDATE local a ciegas cuando no).
//
// 🛑 Robusto al DRIFT DB↔MP (bug real Fede Messina): cancela el preapproval GUARDADO
// (mp_subscription_id, verificado al activar) y, por compatibilidad, los que MP tenga
// con external_reference = tenant. ⚠️ En checkouts por plan MP NO guarda el
// external_reference, así que el camino principal es el id guardado. Pertenencia: por
// id guardado del tenant O por external_reference === tenant. Fail-closed: solo marca
// 'cancelled' si confirmó en MP que el preapproval linkeado quedó fuera de cobro.
// MP-C7: si el tenant nunca se linkeó (mp_subscription_id NULL — tenants viejos pre-fix) y
// es el propio caller, busca su suscripción viva por payer_email para frenar el cobro igual.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const MP = 'https://api.mercadopago.com'
const VIVOS = ['authorized', 'pending', 'paused']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'No autorizado' }, 401)

    const { data: userRow } = await userClient.from('users').select('tenant_id, rol').eq('id', user.id).single()
    const callerTenantId = userRow?.tenant_id
    if (!callerTenantId) return json({ error: 'Tenant no encontrado' }, 400)

    // Target: por defecto el propio tenant del caller. Un STAFF ADMIN (is_admin: rol='ADMIN')
    // puede cancelar la suscripción de OTRO tenant (AdminPage) pasando { tenant_id }.
    const body = await req.json().catch(() => ({}))
    const requested = body?.tenant_id ? String(body.tenant_id) : null
    let tenantId = callerTenantId
    if (requested && requested !== callerTenantId) {
      if (userRow?.rol !== 'ADMIN') return json({ error: 'No autorizado para cancelar otra cuenta' }, 403)
      tenantId = requested
    }

    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'MP no configurado' }, 500)
    const mpHeaders = { Authorization: `Bearer ${mpToken}` }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: tenantRow } = await admin
      .from('tenants').select('mp_subscription_id').eq('id', tenantId).single()
    const storedId = tenantRow?.mp_subscription_id ? String(tenantRow.mp_subscription_id) : null

    // 1) Juntar candidatos: el id GUARDADO (mp_subscription_id, ya verificado al activar
    //    — camino principal) + los que MP tenga con este external_reference (histórico;
    //    en checkouts por plan viene vacío, así que normalmente no aporta).
    //    ⚠️ El filtro ?external_reference= de /preapproval/search NO filtra (devuelve
    //    todos) → filtramos client-side por el que SÍ viene en cada resultado. Se re-verifica por-id.
    const candidatos = new Set<string>()
    if (storedId) candidatos.add(storedId)
    try {
      const LIMIT = 100
      for (let offset = 0; offset < 1000; offset += LIMIT) {
        const searchRes = await fetch(`${MP}/preapproval/search?external_reference=${encodeURIComponent(tenantId)}&limit=${LIMIT}&offset=${offset}`, { headers: mpHeaders })
        if (!searchRes.ok) { console.warn('cancel-suscripcion: search MP', searchRes.status); break }
        const s = await searchRes.json()
        const results = s?.results ?? s?.elements ?? []
        for (const r of results) {
          if (r?.id && r?.external_reference === tenantId) candidatos.add(String(r.id))
        }
        if (results.length < LIMIT) break
      }
    } catch (e) {
      console.error('cancel-suscripcion: error en search MP', e)
    }

    // MP-C7: fail-open residual. Si el tenant NO tiene id guardado (nunca se linkeó por el
    // bug histórico) y es el PROPIO caller, buscamos su suscripción viva en MP por
    // payer_email (igual que mp-verificar-suscripcion) para poder frenar el cobro real. Los
    // ids hallados así cuentan como "del tenant" (pertenencia por email verificada acá).
    const ownedByEmail = new Set<string>()
    if (!storedId && tenantId === callerTenantId && user.email) {
      const email = user.email.toLowerCase().trim()
      try {
        const LIMIT = 100
        for (let offset = 0; offset < 1000; offset += LIMIT) {
          const r = await fetch(`${MP}/preapproval/search?limit=${LIMIT}&offset=${offset}`, { headers: mpHeaders })
          if (!r.ok) { console.warn('cancel-suscripcion: search por email', r.status); break }
          const s = await r.json()
          const results = s?.results ?? s?.elements ?? []
          for (const p of results) {
            const pe = (p?.payer_email ?? '').toLowerCase().trim()
            if (p?.id && pe && pe === email && VIVOS.includes(p?.status)) {
              candidatos.add(String(p.id)); ownedByEmail.add(String(p.id))
            }
          }
          if (results.length < LIMIT) break
        }
      } catch (e) {
        console.error('cancel-suscripcion: error en search por email', e)
      }
    }

    // 2) Cancelar en MP los que pertenezcan al tenant y estén vivos.
    let mpCancelled = 0
    const errores: string[] = []
    // Si hay un preapproval GUARDADO, exigimos CONFIRMAR que quedó fuera de cobro antes
    // de decir "cancelado" (fail-closed). Sin id guardado (tenant legacy sin link) →
    // best-effort: reflejamos la baja aunque no encontremos nada que cancelar.
    let storedConfirmado = storedId ? false : true
    for (const id of candidatos) {
      const getRes = await fetch(`${MP}/preapproval/${id}`, { headers: mpHeaders })
      if (!getRes.ok) {                          // no se pudo leer el estado en MP
        if (id === storedId) errores.push(`${id}:get_${getRes.status}`)
        continue
      }
      const pre = await getRes.json()
      // Pertenencia: por external_reference (histórico) O por ser el id guardado del
      // tenant (verificado al activar; en checkouts por plan external_reference viene vacío).
      const esDelTenant = pre?.external_reference === tenantId || id === storedId || ownedByEmail.has(id)
      if (!esDelTenant) continue                                   // no es de este tenant → NO tocar
      if (pre?.status === 'cancelled') { mpCancelled++; if (id === storedId) storedConfirmado = true; continue }
      if (!VIVOS.includes(pre?.status)) { if (id === storedId) storedConfirmado = true; continue } // no está cobrando
      const putRes = await fetch(`${MP}/preapproval/${id}`, {
        method: 'PUT', headers: { ...mpHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (putRes.ok) { mpCancelled++; if (id === storedId) storedConfirmado = true; console.log(`cancel-suscripcion: preapproval ${id} → cancelled`) }
      else { errores.push(`${id}:${putRes.status}`); console.error('cancel-suscripcion: PUT', id, putRes.status, await putRes.text()) }
    }

    // 🛑 Fail-closed: si un preapproval vivo NO se pudo cancelar, o si el tenant tenía un
    // preapproval LINKEADO cuyo estado no pudimos confirmar fuera de cobro, NO marcamos
    // "cancelado" (seguiría cobrando y la UI mentiría).
    if (errores.length || !storedConfirmado) {
      return json({
        error: 'No se pudo cancelar en Mercado Pago. Reintentá o contactá soporte.',
        detalle: errores.length ? errores : ['no_confirmado'],
      }, 502)
    }

    // 3) Marcar la cuenta como cancelada (service_role). La intención del usuario es
    //    cancelar; si no había preapproval vivo (ya cancelado o nunca existió), igual
    //    reflejamos la baja. El acceso se mantiene hasta fin de período (no se toca plan_tier).
    const { error: updErr } = await admin.from('tenants')
      .update({ subscription_status: 'cancelled' }).eq('id', tenantId)
    if (updErr) {
      console.error('cancel-suscripcion: update tenant', updErr)
      return json({ error: 'Se canceló en MP pero no se pudo actualizar la cuenta. Contactá soporte.' }, 500)
    }

    return json({ cancelled: true, mp_cancelled: mpCancelled })
  } catch (e) {
    console.error('cancel-suscripcion error', e)
    return json({ error: (e as Error).message ?? 'Error' }, 500)
  }
})
