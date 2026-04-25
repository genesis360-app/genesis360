import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Webhook de MercadoLibre.
// Recibe notificaciones de orders_v2 → crea/actualiza venta en Genesis360.

const MELI_API = 'https://api.mercadolibre.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body  = await req.text()
    const event = JSON.parse(body)
    console.log('MELI webhook:', event.topic, event.resource, 'user:', event.user_id)

    if (event.topic !== 'orders_v2') {
      return new Response(JSON.stringify({ ok: true, skipped: event.topic }), { status: 200 })
    }

    const sellerId = event.user_id
    const resource = event.resource

    const { data: cred } = await supabase
      .from('meli_credentials')
      .select('tenant_id, access_token, refresh_token, expires_at, seller_id')
      .eq('seller_id', sellerId)
      .eq('conectado', true)
      .maybeSingle()

    if (!cred) {
      console.warn('Sin credenciales para seller:', sellerId)
      return new Response(JSON.stringify({ ok: true, skipped: 'no_cred' }), { status: 200 })
    }

    const token = await getValidToken(supabase, cred)

    const orderRes = await fetch(`${MELI_API}${resource}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!orderRes.ok) throw new Error(`ML order fetch failed: ${orderRes.status}`)
    const order = await orderRes.json()

    const orderId     = String(order.id)
    const logKey      = `meli-order-${orderId}`
    const estadoML    = order.status
    const nuevoEstado = estadoML === 'paid' ? 'reservada' : 'pendiente'

    // Insertar log PRIMERO — si ya existe (race condition) el UNIQUE constraint lo rechaza
    const { error: logInsertErr } = await supabase.from('ventas_externas_logs').insert({
      tenant_id:           cred.tenant_id,
      integracion:         'MercadoLibre',
      webhook_external_id: logKey,
      payload:             { order_id: orderId, status: estadoML },
    })

    if (logInsertErr) {
      // Otra notificación concurrente ya lo procesó — solo actualizar estado si ahora está pagado
      const { data: existing } = await supabase
        .from('ventas_externas_logs').select('payload')
        .eq('tenant_id', cred.tenant_id).eq('integracion', 'MercadoLibre')
        .eq('webhook_external_id', logKey).maybeSingle()
      const ventaId = (existing?.payload as any)?.venta_id
      if (ventaId && estadoML === 'paid') {
        const { data: v } = await supabase.from('ventas').select('estado').eq('id', ventaId).maybeSingle()
        if (v?.estado === 'pendiente') {
          await supabase.from('ventas').update({
            estado: 'reservada',
            monto_pagado: Number(order.total_amount ?? 0),
          }).eq('id', ventaId)
          console.log(`Venta ${ventaId} → reservada (pago tardío)`)
        }
      }
      return new Response(JSON.stringify({ ok: true, idempotent: true }), { status: 200 })
    }

    // Dedup cliente: buscar por nickname de ML (más estable que nombre)
    const buyer     = order.buyer ?? {}
    const buyerName = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ') || 'Comprador ML'
    const buyerNick = buyer.nickname ?? null
    const searchKey = buyerNick ?? buyerName
    let clienteId: string | null = null

    const { data: cliExist } = await supabase
      .from('clientes').select('id')
      .eq('tenant_id', cred.tenant_id)
      .ilike('nombre', searchKey)
      .maybeSingle()

    if (cliExist) {
      clienteId = cliExist.id
    } else {
      const { data: newCli } = await supabase.from('clientes').insert({
        tenant_id: cred.tenant_id,
        nombre:    buyerNick ?? buyerName,
        telefono:  buyer.phone?.number ?? null,
      }).select('id').maybeSingle()
      clienteId = newCli?.id ?? null
    }

    const total = Number(order.total_amount ?? 0)

    const { data: venta, error: ventaErr } = await supabase.from('ventas').insert({
      tenant_id:      cred.tenant_id,
      cliente_id:     clienteId,
      cliente_nombre: buyerNick ?? buyerName,
      estado:         nuevoEstado,
      subtotal:       total,
      total,
      monto_pagado:   estadoML === 'paid' ? total : 0,
      origen:         'MELI',
      tracking_id:    orderId,
      medio_pago:     JSON.stringify([{ tipo: 'MercadoPago', monto: total }]),
      notas:          `Orden ML #${orderId}`,
      usuario_id:     null,
    }).select('id').single()

    if (ventaErr) throw ventaErr

    for (const item of order.order_items ?? []) {
      const mlItemId = item.item?.id
      const cantidad = item.quantity ?? 1
      const precio   = item.unit_price ?? 0
      const { data: mapped } = await supabase
        .from('inventario_meli_map').select('producto_id')
        .eq('tenant_id', cred.tenant_id).eq('meli_item_id', mlItemId).maybeSingle()
      if (mapped) {
        await supabase.from('venta_items').insert({
          venta_id:        venta.id,
          producto_id:     mapped.producto_id,
          cantidad,
          precio_unitario: precio,
          subtotal:        cantidad * precio,
          alicuota_iva:    21,
          iva_monto:       0,
        })
      }
    }

    // Actualizar log con venta_id
    await supabase.from('ventas_externas_logs')
      .update({ venta_id: venta.id, payload: { order_id: orderId, status: estadoML, venta_id: venta.id } })
      .eq('tenant_id', cred.tenant_id).eq('webhook_external_id', logKey)

    console.log(`Orden ML ${orderId} → venta ${venta.id} (${nuevoEstado})`)
    return new Response(JSON.stringify({ ok: true, venta_id: venta.id }), { status: 200 })

  } catch (err: any) {
    console.error('MELI webhook error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})

async function getValidToken(supabase: ReturnType<typeof createClient>, cred: any): Promise<string> {
  if (new Date(cred.expires_at).getTime() - Date.now() > 10 * 60 * 1000) return cred.access_token
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     Deno.env.get('MELI_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('MELI_CLIENT_SECRET') ?? '',
      refresh_token: cred.refresh_token,
    }),
  })
  if (!res.ok) return cred.access_token
  const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  await supabase.from('meli_credentials').update({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('seller_id', cred.seller_id)
  return tokens.access_token
}
