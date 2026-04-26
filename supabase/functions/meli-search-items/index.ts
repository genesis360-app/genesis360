import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Busca items en MercadoLibre por SKU (seller_sku) o nombre.
// Devuelve: [{ item_id, variation_id, title, sku, price }]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MELI_API = 'https://api.mercadolibre.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: { user } } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  ).auth.getUser(req.headers.get('Authorization')?.replace('Bearer ', '') ?? '')
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: userData } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  if (!userData) return new Response('Tenant no encontrado', { status: 404, headers: corsHeaders })

  const url = new URL(req.url)
  const query = url.searchParams.get('q') ?? ''

  if (!query.trim()) {
    return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Obtener credenciales ML del tenant
  const { data: cred } = await supabase
    .from('meli_credentials').select('access_token, refresh_token, expires_at, seller_id')
    .eq('tenant_id', userData.tenant_id).eq('conectado', true).maybeSingle()

  if (!cred) {
    return new Response(JSON.stringify({ error: 'MercadoLibre no conectado' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Refrescar token si está por vencer
  let token = cred.access_token
  if (new Date(cred.expires_at).getTime() - Date.now() < 10 * 60 * 1000) {
    const res = await fetch(`${MELI_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: Deno.env.get('MELI_CLIENT_ID') ?? '',
        client_secret: Deno.env.get('MELI_CLIENT_SECRET') ?? '',
        refresh_token: cred.refresh_token,
      }),
    })
    if (res.ok) {
      const t = await res.json() as any
      token = t.access_token
      await supabase.from('meli_credentials').update({
        access_token: t.access_token, refresh_token: t.refresh_token,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      }).eq('seller_id', cred.seller_id)
    }
  }

  // Búsqueda 1: por seller_sku exacto
  const searchUrl1 = `${MELI_API}/users/${cred.seller_id}/items/search?seller_sku=${encodeURIComponent(query)}&limit=20`
  const r1 = await fetch(searchUrl1, { headers: { Authorization: `Bearer ${token}` } })
  let itemIds: string[] = []

  if (r1.ok) {
    const d1 = await r1.json() as any
    itemIds = d1.results ?? []
  }

  // Búsqueda 2: por nombre si no encontró por SKU
  if (itemIds.length === 0) {
    const searchUrl2 = `${MELI_API}/users/${cred.seller_id}/items/search?q=${encodeURIComponent(query)}&limit=20`
    const r2 = await fetch(searchUrl2, { headers: { Authorization: `Bearer ${token}` } })
    if (r2.ok) {
      const d2 = await r2.json() as any
      itemIds = d2.results ?? []
    }
  }

  if (itemIds.length === 0) {
    return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Obtener detalles de cada item (máximo 10)
  const results: any[] = []
  for (const itemId of itemIds.slice(0, 10)) {
    const rItem = await fetch(`${MELI_API}/items/${itemId}?attributes=id,title,price,variations,seller_sku`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!rItem.ok) continue
    const item = await rItem.json() as any

    if (!item.variations || item.variations.length === 0) {
      // Sin variaciones
      results.push({
        item_id: item.id,
        variation_id: null,
        title: item.title,
        sku: item.seller_sku ?? null,
        price: item.price ?? null,
      })
    } else {
      // Con variaciones — agregar una entrada por variación
      for (const v of item.variations) {
        const skuAttr = (v.attributes ?? []).find((a: any) => a.id === 'SELLER_SKU')
        const skuVal = skuAttr?.value_name ?? null
        const attrLabel = (v.attribute_combinations ?? []).map((a: any) => `${a.name}: ${a.value_name}`).join(', ')
        results.push({
          item_id: item.id,
          variation_id: v.id,
          title: `${item.title}${attrLabel ? ` (${attrLabel})` : ''}`,
          sku: skuVal,
          price: v.price ?? item.price ?? null,
        })
      }
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
