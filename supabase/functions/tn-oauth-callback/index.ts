import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Secrets requeridos:
//   TN_CLIENT_SECRET  — client secret de la app Genesis360 en TN Partners
// Env vars (auto-inyectadas por Supabase):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

const TN_APP_ID      = '30376'
const TN_TOKEN_URL   = 'https://www.tiendanube.com/apps/authorize/token'
const TN_API_BASE    = 'https://api.tiendanube.com/v1'
const TN_USER_AGENT  = 'Genesis360 (gaston.otranto@gmail.com)'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://app.genesis360.pro'
// URL de la EF que recibe los webhooks de TN (se construye desde SUPABASE_URL auto-inyectada)
const WEBHOOK_URL    = `${Deno.env.get('SUPABASE_URL') ?? 'https://jjffnbrdjchquexdfgwq.supabase.co'}/functions/v1/tn-webhook`

serve(async (req) => {
  const url = new URL(req.url)

  // TN redirige aquí con ?code=XXX&state=base64(tenantId:sucursalId)
  // user_id viene en la respuesta del token, no en la URL
  const code     = url.searchParams.get('code')
  const stateB64 = url.searchParams.get('state')

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

  const clientSecret = Deno.env.get('TN_CLIENT_SECRET')
  if (!clientSecret) {
    console.error('TN_CLIENT_SECRET no configurado')
    return new Response('Configuración incompleta', { status: 500 })
  }

  // Intercambiar code por access_token
  const tokenRes = await fetch(TN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     TN_APP_ID,
      client_secret: clientSecret,
      grant_type:    'authorization_code',
      code,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('Error intercambiando token TN:', err)
    return redirectError('Error al conectar con TiendaNube')
  }

  const tokenData = await tokenRes.json()
  // TN devuelve: { access_token, token_type, scope, user_id }
  const accessToken = tokenData.access_token as string
  const storeId     = tokenData.user_id as number

  if (!accessToken) {
    return redirectError('TiendaNube no devolvió access_token')
  }

  // Obtener info de la tienda para guardar nombre y URL
  let storeName: string | null = null
  let storeUrl:  string | null = null
  try {
    const storeRes = await fetch(`https://api.tiendanube.com/v1/${storeId}/store`, {
      headers: {
        'Authentication': `bearer ${accessToken}`,
        'User-Agent':     'Genesis360 (gaston.otranto@gmail.com)',
      },
    })
    if (storeRes.ok) {
      const storeData = await storeRes.json()
      storeName = storeData.name?.es ?? storeData.name?.en ?? null
      storeUrl  = storeData.original_domain ?? null
    }
  } catch (e) {
    console.warn('No se pudo obtener info de la tienda TN:', e)
  }

  // Guardar credenciales (upsert por tenant_id + sucursal_id)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase
    .from('tiendanube_credentials')
    .upsert(
      {
        tenant_id:    tenantId,
        sucursal_id:  sucursalId,
        store_id:     storeId,
        store_name:   storeName,
        store_url:    storeUrl,
        access_token: accessToken,
        conectado:    true,
        conectado_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,sucursal_id' },
    )

  if (error) {
    console.error('Error guardando credenciales TN:', error)
    return redirectError('Error guardando la conexión')
  }

  // Registrar webhooks en TiendaNube para este store
  // TN ignora duplicados — si el webhook ya existe, responde 422 (lo ignoramos)
  await registerTnWebhooks(storeId, accessToken)

  // Redirigir al usuario de vuelta a la tab Integraciones
  return Response.redirect(`${APP_URL}/configuracion?tab=integraciones&tn=ok`, 302)
})

function redirectError(msg: string): Response {
  const encoded = encodeURIComponent(msg)
  return Response.redirect(`${APP_URL}/configuracion?tab=integraciones&error=${encoded}`, 302)
}

async function registerTnWebhooks(storeId: number, accessToken: string): Promise<void> {
  const events = ['order/created', 'order/paid']
  for (const event of events) {
    try {
      const res = await fetch(`${TN_API_BASE}/${storeId}/webhooks`, {
        method: 'POST',
        headers: {
          'Authentication': `bearer ${accessToken}`,
          'User-Agent':     TN_USER_AGENT,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ event, url: WEBHOOK_URL }),
      })
      if (!res.ok && res.status !== 422) {
        // 422 = ya existe, lo ignoramos
        console.warn(`No se pudo registrar webhook TN [${event}]:`, await res.text())
      } else {
        console.log(`Webhook TN registrado: ${event}`)
      }
    } catch (e) {
      console.warn(`Error registrando webhook TN [${event}]:`, e)
    }
  }
}
