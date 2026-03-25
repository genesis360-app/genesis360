import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Notifica al marketplace externo cuando cambia el stock de un producto publicado.
 *
 * Body: { producto_id: string }
 *
 * Llamar desde el frontend (fire-and-forget) después de despachar una venta
 * o registrar un movimiento de stock.
 *
 * También puede configurarse como Supabase Database Webhook en la tabla
 * movimientos_stock (INSERT) → esta misma URL.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Aceptar tanto llamadas autenticadas (frontend) como del DB webhook (sin auth)
    const authHeader = req.headers.get('Authorization')
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let callerTenantId: string | null = null

    // Si viene con JWT, validar y extraer tenant
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      )
      const { data: { user } } = await userClient.auth.getUser()
      if (user) {
        const { data: userRow } = await supabaseServiceRole
          .from('users')
          .select('tenant_id')
          .eq('id', user.id)
          .single()
        callerTenantId = userRow?.tenant_id ?? null
      }
    }

    const body = await req.json()
    const productoId: string | undefined = body?.producto_id ?? body?.record?.producto_id

    if (!productoId) {
      return new Response(JSON.stringify({ error: 'producto_id requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Obtener datos del producto
    const { data: producto, error: prodErr } = await supabaseServiceRole
      .from('productos')
      .select(`
        id, nombre, sku, tenant_id,
        stock_actual, stock_reservado_marketplace,
        publicado_marketplace
      `)
      .eq('id', productoId)
      .single()

    if (prodErr || !producto) {
      return new Response(JSON.stringify({ error: 'Producto no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validar que el caller pertenece al mismo tenant (si viene autenticado)
    if (callerTenantId && callerTenantId !== producto.tenant_id) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Si el producto no está publicado, no hay nada que notificar
    if (!producto.publicado_marketplace) {
      return new Response(JSON.stringify({ skipped: true, reason: 'Producto no publicado en marketplace' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Obtener webhook_url del tenant
    const { data: tenant } = await supabaseServiceRole
      .from('tenants')
      .select('marketplace_webhook_url, marketplace_activo')
      .eq('id', producto.tenant_id)
      .single()

    if (!tenant?.marketplace_activo || !tenant?.marketplace_webhook_url) {
      return new Response(JSON.stringify({ skipped: true, reason: 'Marketplace no activo o sin webhook URL configurada' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Calcular stock disponible (reservas activas en inventario_lineas)
    const { data: lineas } = await supabaseServiceRole
      .from('inventario_lineas')
      .select('cantidad_reservada')
      .eq('producto_id', productoId)
      .eq('activo', true)

    const totalReservado = (lineas ?? []).reduce((sum: number, l: any) => sum + (l.cantidad_reservada ?? 0), 0)
    const stockDisponible = Math.max(
      0,
      (producto.stock_actual ?? 0) - (producto.stock_reservado_marketplace ?? 0) - totalReservado,
    )

    const payload = {
      tenant_id: producto.tenant_id,
      producto_id: producto.id,
      sku: producto.sku,
      nombre: producto.nombre,
      stock_disponible: stockDisponible,
      timestamp: new Date().toISOString(),
    }

    // Enviar POST al webhook externo (timeout 10s)
    const webhookRes = await fetch(tenant.marketplace_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })

    return new Response(JSON.stringify({
      ok: true,
      webhook_status: webhookRes.status,
      payload,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
