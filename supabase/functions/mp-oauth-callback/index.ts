import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Secrets requeridos:
//   MP_CLIENT_SECRET  — client secret de la app Genesis360 en MP Developers
// Constantes (públicas, misma app para todos los tenants):
const MP_CLIENT_ID  = '7675256842462289'
const MP_TOKEN_URL  = 'https://api.mercadopago.com/oauth/token'
const APP_URL       = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'

serve(async (req) => {
  const url = new URL(req.url)

  // MP redirige aquí con ?code=XXX&state=base64(tenantId:sucursalId)
  const code     = url.searchParams.get('code')
  const stateB64 = url.searchParams.get('state')
  const mpError  = url.searchParams.get('error')

  if (mpError) {
    console.error('MP OAuth error:', mpError, url.searchParams.get('error_description'))
    return redirectError('El usuario canceló la autorización de MercadoPago')
  }

  if (!code || !stateB64) {
    return new Response('Parámetros faltantes', { status: 400 })
  }

  // Decodificar state → tenantId:sucursalId
  let tenantId: string, sucursalId: string
  try {
    const decoded = atob(stateB64)
    ;[tenantId, sucursalId] = decoded.split(':')
    if (!tenantId || !sucursalId) throw new Error('state inválido')
  } catch {
    return new Response('State inválido', { status: 400 })
  }

  const clientSecret = Deno.env.get('MP_CLIENT_SECRET')
  if (!clientSecret) {
    console.error('MP_CLIENT_SECRET no configurado')
    return new Response('Configuración incompleta', { status: 500 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const redirectUri = `${supabaseUrl}/functions/v1/mp-oauth-callback`

  // Intercambiar code por access_token
  const tokenRes = await fetch(MP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     MP_CLIENT_ID,
      client_secret: clientSecret,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('Error intercambiando token MP:', err)
    return redirectError('Error al conectar con MercadoPago')
  }

  const tokenData = await tokenRes.json()
  // MP devuelve: { access_token, token_type, expires_in, scope, user_id,
  //               refresh_token, public_key, live_mode }
  const accessToken  = tokenData.access_token  as string
  const refreshToken = tokenData.refresh_token as string | null
  const publicKey    = tokenData.public_key    as string | null
  const sellerId     = tokenData.user_id       as number
  const expiresIn    = tokenData.expires_in    as number  // segundos

  if (!accessToken || !sellerId) {
    return redirectError('MercadoPago no devolvió los datos esperados')
  }

  // Calcular fecha de expiración
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  // Obtener email del vendedor desde la API de MP
  let sellerEmail: string | null = null
  try {
    const userRes = await fetch(`https://api.mercadopago.com/v1/account/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    if (userRes.ok) {
      const userData = await userRes.json()
      sellerEmail = userData.email ?? null
    }
  } catch (e) {
    console.warn('No se pudo obtener email del vendedor MP:', e)
  }

  // Guardar credenciales (upsert por tenant_id + sucursal_id)
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase
    .from('mercadopago_credentials')
    .upsert(
      {
        tenant_id:     tenantId,
        sucursal_id:   sucursalId,
        seller_id:     sellerId,
        seller_email:  sellerEmail,
        access_token:  accessToken,
        refresh_token: refreshToken,
        public_key:    publicKey,
        expires_at:    expiresAt,
        conectado:     true,
        conectado_at:  new Date().toISOString(),
      },
      { onConflict: 'tenant_id,sucursal_id' },
    )

  if (error) {
    console.error('Error guardando credenciales MP:', error)
    return redirectError('Error guardando la conexión')
  }

  return Response.redirect(`${APP_URL}/configuracion?tab=integraciones&mp=ok`, 302)
})

function redirectError(msg: string): Response {
  const encoded = encodeURIComponent(msg)
  return Response.redirect(`${APP_URL}/configuracion?tab=integraciones&error=${encoded}`, 302)
}
