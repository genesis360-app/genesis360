import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// OAuth callback de MercadoLibre.
// state = btoa(tenantId:sucursalId)

const MELI_API = 'https://api.mercadolibre.com'

serve(async (req) => {
  const url        = new URL(req.url)
  const code       = url.searchParams.get('code')
  const state      = url.searchParams.get('state')
  const appUrl     = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
  // Construir redirect URI desde SUPABASE_URL (más confiable que req.url detrás de proxy)
  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const REDIRECT_URI = `${supabaseUrl}/functions/v1/meli-oauth-callback`
  console.log('REDIRECT_URI usado:', REDIRECT_URI)

  if (!code || !state) {
    return Response.redirect(`${appUrl}/configuracion?tab=integraciones&error=meli_missing_params`)
  }

  let tenantId: string, sucursalId: string | null
  try {
    const decoded = atob(state)
    const parts   = decoded.split(':')
    tenantId   = parts[0]
    sucursalId = parts[1] && parts[1] !== 'null' ? parts[1] : null
  } catch {
    return Response.redirect(`${appUrl}/configuracion?tab=integraciones&error=meli_invalid_state`)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Intercambiar code por tokens
  const tokenRes = await fetch(`${MELI_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     Deno.env.get('MELI_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('MELI_CLIENT_SECRET') ?? '',
      code,
      redirect_uri:  REDIRECT_URI,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('MELI token error:', tokenRes.status, err, '| redirect_uri usado:', REDIRECT_URI)
    return Response.redirect(`${appUrl}/configuracion?tab=integraciones&error=meli_token_failed`)
  }

  const tokens = await tokenRes.json() as {
    access_token: string; refresh_token: string; token_type: string
    expires_in: number; user_id: number; scope: string
  }

  // Obtener info del seller
  const meRes = await fetch(`${MELI_API}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const me = meRes.ok ? await meRes.json() : {}

  const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()

  // Eliminar registros anteriores del mismo seller para evitar duplicados
  await supabase.from('meli_credentials')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('seller_id', tokens.user_id)

  // Insertar credenciales limpias
  const { error: upsertErr } = await supabase.from('meli_credentials').upsert({
    tenant_id:       tenantId,
    sucursal_id:     sucursalId,
    seller_id:       tokens.user_id,
    seller_nickname: me.nickname ?? null,
    seller_email:    me.email ?? null,
    access_token:    tokens.access_token,
    refresh_token:   tokens.refresh_token,
    expires_at:      expiresAt,
    conectado:       true,
  }, { onConflict: 'tenant_id,sucursal_id' })

  if (upsertErr) {
    console.error('Upsert error:', upsertErr.message)
    return Response.redirect(`${appUrl}/configuracion?tab=integraciones&error=meli_db_error`)
  }

  // Registrar webhook de órdenes para este seller
  const webhookUrl = 'https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/meli-webhook'
  const clientId   = Deno.env.get('MELI_CLIENT_ID') ?? ''

  // Intento 1: suscripción via aplicación del seller
  const subRes = await fetch(`${MELI_API}/applications/${clientId}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: 'orders_v2', callback_url: webhookUrl }),
  })
  if (subRes.ok) {
    console.log('Webhook orders_v2 registrado OK')
  } else {
    // Intento 2: PUT en el recurso del usuario/aplicación (API alternativa)
    const sub2Res = await fetch(
      `${MELI_API}/users/${tokens.user_id}/applications/${clientId}`,
      {
        method: 'PUT',
        headers: {
          Authorization:  `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ callback_url: webhookUrl, topics: ['orders_v2'] }),
      },
    )
    console.log('Webhook fallback status:', sub2Res.status)
  }

  console.log(`MELI conectado: tenant ${tenantId}, seller ${tokens.user_id} (${me.nickname})`)
  return Response.redirect(`${appUrl}/configuracion?tab=integraciones&meli=ok`)
})
