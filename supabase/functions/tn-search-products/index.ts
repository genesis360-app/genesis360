import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Busca productos en TiendaNube por SKU o nombre.
// Devuelve: [{ product_id, variant_id, title, sku, price }]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Autenticar usuario
  const { data: { user } } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  ).auth.getUser(req.headers.get('Authorization')?.replace('Bearer ', '') ?? '')
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: userData } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  if (!userData) return new Response('Tenant no encontrado', { status: 404, headers: corsHeaders })

  const url = new URL(req.url)
  const query = url.searchParams.get('q') ?? ''
  const sucursalId = url.searchParams.get('sucursal_id') ?? null

  if (!query.trim()) {
    return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Obtener credenciales TN del tenant
  let credQ = supabase.from('tiendanube_credentials').select('access_token, store_id')
    .eq('tenant_id', userData.tenant_id)
  if (sucursalId) credQ = credQ.eq('sucursal_id', sucursalId)
  const { data: cred } = await credQ.maybeSingle()

  if (!cred) {
    return new Response(JSON.stringify({ error: 'TiendaNube no conectado' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Buscar en TN por nombre/SKU
  const res = await fetch(
    `https://api.tiendanube.com/v1/${cred.store_id}/products?q=${encodeURIComponent(query)}&fields=id,name,variants&per_page=20`,
    { headers: { Authentication: `bearer ${cred.access_token}`, 'User-Agent': 'Genesis360/1.0' } },
  )

  if (!res.ok) {
    return new Response(JSON.stringify({ error: `TN API: ${res.status}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const products = await res.json() as any[]

  const results: any[] = []
  for (const p of products ?? []) {
    for (const v of p.variants ?? []) {
      // Buscar por SKU exacto primero, luego incluir todos los variants
      const matchesSku = v.sku && v.sku.toLowerCase().includes(query.toLowerCase())
      const matchesName = p.name?.toLowerCase().includes(query.toLowerCase())
      if (matchesSku || matchesName || (p.variants?.length === 1)) {
        results.push({
          product_id: p.id,
          variant_id: p.variants?.length > 1 ? v.id : null,
          title: p.name + (p.variants?.length > 1 ? ` — ${v.values?.map((val: any) => val.es).join(' / ')}` : ''),
          sku: v.sku ?? null,
          price: v.price ?? null,
        })
      }
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
