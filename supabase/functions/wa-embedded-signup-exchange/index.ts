import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// wa-embedded-signup-exchange — completa el "WhatsApp Embedded Signup" de Meta (Tech Provider) para
// que un dueño de negocio conecte SU propio WhatsApp Business desde dentro de Genesis360 (popup
// embebido), sin repetir el trámite manual que hizo GO para el tenant de prueba (ver
// supabase/functions/wa-webhook). El frontend (src/lib/metaEmbeddedSignup.ts) dispara el popup con
// el JS SDK de Facebook y manda acá el `code` + `waba_id` + `phone_number_id` que devuelve.
//
// Flujo server-side (verificado contra la documentación oficial vigente de Meta, no de memoria):
// 1. Intercambiar el `code` por un "Business Integration System User access token" — token propio
//    de ESTE cliente (no un token de plataforma compartido), con vida NO expirante si la
//    Configuration de Facebook Login for Business quedó armada con "Token Expiration: Never expire".
// 2. Registrar el número para la Cloud API (fija el PIN de verificación en 2 pasos).
// 3. Suscribir esta app a los webhooks del WABA del cliente (para que wa-webhook reciba sus mensajes).
// 4. Guardar todo en whatsapp_credentials (mig 382) — mismo schema que ya usa el tenant de prueba,
//    sin migración nueva.
//
// A diferencia de wa-webhook (que recibe requests de Meta, sin JWT), esta función la invoca un
// usuario logueado de Genesis360 desde el frontend — va con verify_jwt en el deploy, y además valida
// acá adentro que el usuario pertenezca al tenant_id recibido (mismo guard que generar-csr).
//
// Secrets requeridos: META_APP_ID (App ID de la Meta App, dato público pero configurable sin
// redeploy), META_APP_SECRET (ya existe, lo usa wa-webhook para la firma HMAC — mismo App).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GRAPH_API_VERSION = 'v23.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

function generarPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tenant_id, code, waba_id, phone_number_id } = await req.json()
    if (!tenant_id || !code || !waba_id || !phone_number_id) {
      return json({ error: 'Faltan datos del popup de Meta (tenant_id, code, waba_id, phone_number_id).' }, 400)
    }

    const appId = Deno.env.get('META_APP_ID')
    const appSecret = Deno.env.get('META_APP_SECRET')
    if (!appId || !appSecret) {
      console.error('META_APP_ID / META_APP_SECRET no configurados')
      return json({ error: 'Configuración de Meta incompleta del lado del servidor.' }, 500)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Guard de identidad: solo un usuario real del tenant puede conectar su propio WhatsApp.
    const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return json({ error: 'No autorizado: se requiere un usuario autenticado.' }, 401)
    const { data: membership } = await supabase.from('users')
      .select('id').eq('id', userData.user.id).eq('tenant_id', tenant_id).maybeSingle()
    if (!membership) return json({ error: 'No autorizado: el usuario no pertenece al tenant indicado.' }, 403)

    // 1. Intercambiar el code por el business token de este cliente. Vive 30s desde que Meta lo
    //    emitió — por eso el frontend lo manda acá apenas lo recibe del popup.
    const tokenRes = await fetch(
      `${GRAPH_BASE}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`,
    )
    const tokenData = await tokenRes.json()
    const accessToken = tokenData?.access_token as string | undefined
    if (!tokenRes.ok || !accessToken) {
      console.error('Error intercambiando code de Meta:', tokenData)
      return json({ error: tokenData?.error?.message ?? 'Meta no devolvió un token válido.' }, 502)
    }

    // 2. Registrar el número en la Cloud API (fija el PIN de verificación en 2 pasos).
    const registerRes = await fetch(`${GRAPH_BASE}/${phone_number_id}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin: generarPin() }),
    })
    if (!registerRes.ok) {
      const err = await registerRes.json().catch(() => ({}))
      const msg = String(err?.error?.message ?? '').toLowerCase()
      // Reconexión: si ya estaba registrado, no es un error real.
      if (!msg.includes('already') && !msg.includes('registered')) {
        console.error('Error registrando número WhatsApp:', err)
        return json({ error: err?.error?.message ?? 'No se pudo registrar el número en WhatsApp.' }, 502)
      }
    }

    // 3. Suscribir esta app a los webhooks del WABA del cliente (idempotente del lado de Meta).
    const subRes = await fetch(`${GRAPH_BASE}/${waba_id}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!subRes.ok) {
      const err = await subRes.json().catch(() => ({}))
      console.error('Error suscribiendo app al WABA:', err)
      return json({ error: err?.error?.message ?? 'No se pudo suscribir al WhatsApp Business Account.' }, 502)
    }

    // 4. Mejor esfuerzo: número en formato legible para mostrar en la UI.
    let numeroWhatsapp: string | null = null
    try {
      const infoRes = await fetch(
        `${GRAPH_BASE}/${phone_number_id}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (infoRes.ok) numeroWhatsapp = (await infoRes.json())?.display_phone_number ?? null
    } catch (e) {
      console.warn('No se pudo obtener el número de WhatsApp para mostrar en la UI:', e)
    }

    const { error: upsertErr } = await supabase.from('whatsapp_credentials').upsert(
      {
        tenant_id,
        phone_number_id,
        waba_id,
        numero_whatsapp: numeroWhatsapp,
        access_token: accessToken,
        conectado: true,
        conectado_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    )
    if (upsertErr) {
      console.error('Error guardando whatsapp_credentials:', upsertErr)
      return json({ error: 'Se conectó con Meta pero no se pudo guardar en Genesis360. Reintentá.' }, 500)
    }

    return json({ ok: true, numero_whatsapp: numeroWhatsapp })
  } catch (e) {
    console.error('wa-embedded-signup-exchange error', e)
    return json({ error: (e as Error).message ?? 'Error conectando WhatsApp' }, 500)
  }
})
