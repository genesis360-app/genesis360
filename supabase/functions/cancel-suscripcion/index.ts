import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─── Cancelación de suscripción (REGLA #0 — billing) ──────────────────────────
// Cancela el/los preapproval(s) del tenant en Mercado Pago y recién ahí marca la
// cuenta como 'cancelled'. Reemplaza el flujo roto anterior (llamaba a un EF que no
// existía cuando había mp_subscription_id, y hacía un UPDATE local a ciegas cuando no).
//
// 🛑 Robusto al DRIFT DB↔MP (bug real Fede Messina): si tenants.mp_subscription_id es
// NULL o quedó desincronizado, BUSCA el preapproval en MP por external_reference = tenant
// (/preapproval/search) y cancela el/los que estén vivos → así el usuario SIEMPRE puede
// frenar el cobro real, aunque la DB haya perdido el link.
//
// Verifica pertenencia (external_reference === tenant del caller) antes de cancelar nada.

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

    // 1) Juntar candidatos: el id guardado + los que MP tenga por external_reference.
    const candidatos = new Set<string>()
    if (tenantRow?.mp_subscription_id) candidatos.add(String(tenantRow.mp_subscription_id))
    try {
      const searchRes = await fetch(`${MP}/preapproval/search?external_reference=${encodeURIComponent(tenantId)}`, { headers: mpHeaders })
      if (searchRes.ok) {
        const s = await searchRes.json()
        for (const r of (s?.results ?? s?.elements ?? [])) {
          if (r?.id) candidatos.add(String(r.id))
        }
      } else {
        console.warn('cancel-suscripcion: search MP', searchRes.status)
      }
    } catch (e) {
      console.error('cancel-suscripcion: error en search MP', e)
    }

    // 2) Cancelar en MP los que pertenezcan al tenant y estén vivos.
    let mpCancelled = 0
    const errores: string[] = []
    for (const id of candidatos) {
      const getRes = await fetch(`${MP}/preapproval/${id}`, { headers: mpHeaders })
      if (!getRes.ok) continue   // id inexistente/inválido (ej. valores de test) → ignorar
      const pre = await getRes.json()
      if (pre?.external_reference !== tenantId) continue          // no es de este tenant → NO tocar
      if (pre?.status === 'cancelled') { mpCancelled++; continue } // ya cancelado
      if (!VIVOS.includes(pre?.status)) continue
      const putRes = await fetch(`${MP}/preapproval/${id}`, {
        method: 'PUT', headers: { ...mpHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (putRes.ok) { mpCancelled++; console.log(`cancel-suscripcion: preapproval ${id} → cancelled`) }
      else { errores.push(`${id}:${putRes.status}`); console.error('cancel-suscripcion: PUT', id, putRes.status, await putRes.text()) }
    }

    // 🛑 Si algún preapproval vivo NO se pudo cancelar, NO marcamos la cuenta como
    // cancelada (seguiría cobrando y la UI diría "cancelado" = mentira). Fail-closed.
    if (errores.length) {
      return json({ error: 'No se pudo cancelar en Mercado Pago. Reintentá o contactá soporte.', detalle: errores }, 502)
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
