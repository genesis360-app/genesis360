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
 * 🔌 APAGADA (2026-09-14, decisión de GO): ningún código de la app la invoca y ningún negocio tiene
 * el marketplace activo. La URL de webhook se sacó de Configuración. Se deja desplegada solo para
 * llamadas AUTENTICADAS de un usuario del mismo negocio: el camino "sin Authorization" (pensado para un
 * Database Webhook que nunca se configuró) dejaba que cualquiera con un `producto_id` disparara un POST
 * hacia la URL configurada del negocio. Si algún día se reconecta, hacerlo server-side (trigger + cola
 * con reintentos y firma HMAC), no desde el navegador.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autenticado' }, 401)

    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'No autenticado' }, 401)

    const { data: userRow } = await supabaseServiceRole
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()
    const callerTenantId: string | null = userRow?.tenant_id ?? null
    if (!callerTenantId) return json({ error: 'No autorizado' }, 403)

    const body = await req.json()
    const productoId: string | undefined = body?.producto_id

    if (!productoId) return json({ error: 'producto_id requerido' }, 400)

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

    if (prodErr || !producto) return json({ error: 'Producto no encontrado' }, 404)

    // El producto tiene que ser del negocio de quien llama.
    if (callerTenantId !== producto.tenant_id) return json({ error: 'No autorizado' }, 403)

    // Si el producto no está publicado, no hay nada que notificar
    if (!producto.publicado_marketplace) {
      return json({ skipped: true, reason: 'Producto no publicado en marketplace' })
    }

    // Obtener webhook_url del tenant
    const { data: tenant } = await supabaseServiceRole
      .from('tenants')
      .select('marketplace_webhook_url, marketplace_activo')
      .eq('id', producto.tenant_id)
      .single()

    if (!tenant?.marketplace_activo || !tenant?.marketplace_webhook_url) {
      return json({ skipped: true, reason: 'Marketplace no activo o sin webhook URL configurada' })
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

    return json({ ok: true, webhook_status: webhookRes.status, payload })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
