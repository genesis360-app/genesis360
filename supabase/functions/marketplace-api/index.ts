import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { consumirRateLimit, ipDelCliente, respuesta429 } from '../_shared/rateLimit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// Rate limiting: 60 req/min por IP. El contador vive en la base (mig 432) — ver _shared/rateLimit.ts.
const RATE_LIMIT = 60

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Antes de mirar el tenant, a propósito: así enumerar tenants tampoco es gratis.
  const limite = await consumirRateLimit(supabase, 'marketplace-api', ipDelCliente(req), RATE_LIMIT)
  if (!limite.permitido) {
    return respuesta429(limite, `Rate limit exceeded. Max ${RATE_LIMIT} requests/minute.`, corsHeaders)
  }

  try {
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenant_id')

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'tenant_id requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verificar que el tenant existe y tiene marketplace activo
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, marketplace_activo')
      .eq('id', tenantId)
      .single()

    if (tenantErr || !tenant) {
      return new Response(JSON.stringify({ error: 'Tenant no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!tenant.marketplace_activo) {
      return new Response(JSON.stringify({ error: 'Marketplace no habilitado para este tenant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Obtener productos publicados con stock disponible calculado
    const { data: productos, error: prodErr } = await supabase
      .from('productos')
      .select(`
        id,
        nombre,
        sku,
        descripcion_marketplace,
        precio_marketplace,
        stock_actual,
        stock_reservado_marketplace,
        imagen_url,
        categorias ( nombre )
      `)
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .eq('publicado_marketplace', true)
      .order('nombre')

    if (prodErr) throw prodErr

    // Obtener cantidad_reservada por producto (suma de reservas activas en inventario_lineas)
    const productoIds = (productos ?? []).map((p: any) => p.id)
    let reservaMap: Record<string, number> = {}

    if (productoIds.length > 0) {
      const { data: lineas } = await supabase
        .from('inventario_lineas')
        .select('producto_id, cantidad_reservada')
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .in('producto_id', productoIds)

      for (const l of lineas ?? []) {
        reservaMap[l.producto_id] = (reservaMap[l.producto_id] ?? 0) + (l.cantidad_reservada ?? 0)
      }
    }

    const result = (productos ?? []).map((p: any) => ({
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      descripcion: p.descripcion_marketplace ?? null,
      precio: p.precio_marketplace ?? null,
      stock_disponible: Math.max(
        0,
        (p.stock_actual ?? 0) - (p.stock_reservado_marketplace ?? 0) - (reservaMap[p.id] ?? 0),
      ),
      imagen_url: p.imagen_url ?? null,
      categoria: p.categorias?.nombre ?? null,
    }))

    return new Response(JSON.stringify({ productos: result, total: result.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
