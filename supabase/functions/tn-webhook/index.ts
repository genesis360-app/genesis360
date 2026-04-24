import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Secrets requeridos: ninguno propio (usa service role de Supabase)
// Env vars auto-inyectadas: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Ciclo de vida de un pedido TN:
//   order/created (sin pago) → crea venta 'pendiente'
//   order/paid               → si ya existe venta para ese pedido → UPDATE a 'reservada'
//                              si no existe → crea venta 'reservada' directamente
//
// Idempotencia: clave por evento (order/created y order/paid son eventos distintos).
// El duplicate check es por clave exacta. Si order/paid llega después de
// order/created, no es duplicado — es una transición de estado.

const TN_API_BASE = 'https://api.tiendanube.com/v1'
const TN_USER_AGENT = 'Genesis360 (gaston.otranto@gmail.com)'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Payload de TN: { store_id: number, event: string, id: number }
  let payload: { store_id: number; event: string; id: number }
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { store_id, event, id: orderId } = payload

  if (!store_id || !event || !orderId) {
    return new Response('Missing fields', { status: 400 })
  }

  // Solo procesamos pedidos pagados o creados
  if (!['order/paid', 'order/created'].includes(event)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Buscar credencial por store_id
  const { data: cred, error: credErr } = await supabase
    .from('tiendanube_credentials')
    .select('tenant_id, sucursal_id, access_token')
    .eq('store_id', store_id)
    .eq('conectado', true)
    .maybeSingle()

  if (credErr || !cred) {
    console.error('Store not connected:', store_id, credErr?.message)
    return new Response('Store not found', { status: 404 })
  }

  const { tenant_id, sucursal_id, access_token } = cred

  // 2. Idempotencia — clave por evento (order/created y order/paid son distintos)
  const webhookKey = `${store_id}-${event}-${orderId}`
  const { data: existingLog } = await supabase
    .from('ventas_externas_logs')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('integracion', 'TiendaNube')
    .eq('webhook_external_id', webhookKey)
    .maybeSingle()

  if (existingLog) {
    console.log('Duplicate webhook ignored:', webhookKey)
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 3. Fetch del pedido completo desde la API de TN
  const orderRes = await fetch(`${TN_API_BASE}/${store_id}/orders/${orderId}`, {
    headers: {
      'Authentication': `bearer ${access_token}`,
      'User-Agent': TN_USER_AGENT,
    },
  })

  if (!orderRes.ok) {
    const err = await orderRes.text()
    console.error('Error fetching TN order:', err)
    return new Response('Error fetching order from TiendaNube', { status: 502 })
  }

  const order = await orderRes.json()

  // Buscar si ya existe una venta para este pedido TN (creada por order/created previo)
  const trackingId = String(order.number)
  const { data: ventaExistente } = await supabase
    .from('ventas')
    .select('id, estado')
    .eq('tenant_id', tenant_id)
    .eq('origen', 'TiendaNube')
    .eq('tracking_id', trackingId)
    .maybeSingle()

  // Si es order/paid y ya existe la venta pendiente → solo actualizar estado
  if (event === 'order/paid' && ventaExistente) {
    if (ventaExistente.estado === 'pendiente') {
      const total = parseFloat(order.total ?? '0')
      await supabase.from('ventas').update({
        estado: 'reservada',
        monto_pagado: total,
        medio_pago: JSON.stringify([{ tipo: 'TiendaNube', monto: total }]),
      }).eq('id', ventaExistente.id)
      console.log(`Venta ${ventaExistente.id} actualizada pendiente → reservada (pedido TN #${order.number})`)
    }
    // Registrar log de idempotencia y terminar
    await supabase.from('ventas_externas_logs').insert({
      tenant_id, integracion: 'TiendaNube', webhook_external_id: webhookKey,
      venta_id: ventaExistente.id, payload_raw: order,
    })
    return new Response(JSON.stringify({ ok: true, updated: ventaExistente.id }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Determinar estado para venta nueva
  const isPaid = order.payment_status === 'paid' || event === 'order/paid'
  const estadoVenta: string = isPaid ? 'reservada' : 'pendiente'

  // 4. Encontrar o crear cliente
  let clienteId: string | null = null
  const customer = order.customer

  if (customer) {
    // Buscar por email primero, luego por nombre
    const orFilter = customer.email
      ? `email.eq.${customer.email}`
      : `nombre.ilike.${customer.name}`

    const { data: existingCliente } = await supabase
      .from('clientes')
      .select('id')
      .eq('tenant_id', tenant_id)
      .or(orFilter)
      .maybeSingle()

    if (existingCliente) {
      clienteId = existingCliente.id
    } else {
      // Crear cliente con la info disponible del pedido TN
      const { data: newCliente } = await supabase
        .from('clientes')
        .insert({
          tenant_id,
          sucursal_id,
          nombre:   customer.name ?? 'Cliente TiendaNube',
          email:    customer.email ?? null,
          telefono: customer.phone ?? null,
        })
        .select('id')
        .single()
      clienteId = newCliente?.id ?? null
    }
  }

  // Para 'reservada' necesitamos cliente (v0.52.0). Si no hay, bajamos a 'pendiente'.
  const estadoFinal = (estadoVenta === 'reservada' && !clienteId) ? 'pendiente' : estadoVenta

  // 5. Mapear productos TN → Genesis360
  const ventaItems: Record<string, unknown>[] = []
  const stockJobs: Record<string, unknown>[] = []

  for (const item of order.products ?? []) {
    let productoId: string | null = null

    // Intento 1: inventario_tn_map por product_id + variant_id
    const { data: mapped } = await supabase
      .from('inventario_tn_map')
      .select('producto_id')
      .eq('tenant_id', tenant_id)
      .eq('tn_product_id', item.product_id)
      .eq('tn_variant_id', item.variant_id ?? 0)
      .maybeSingle()

    productoId = mapped?.producto_id ?? null

    // Intento 2: fallback por SKU (case-insensitive)
    if (!productoId && item.sku) {
      const { data: bySku } = await supabase
        .from('productos')
        .select('id')
        .eq('tenant_id', tenant_id)
        .ilike('sku', item.sku)
        .maybeSingle()
      productoId = bySku?.id ?? null
    }

    if (!productoId) {
      console.warn('Product not mapped:', item.product_id, item.sku)
      continue
    }

    // Obtener datos del producto para costo e IVA
    const { data: producto } = await supabase
      .from('productos')
      .select('nombre, precio_venta, precio_costo, alicuota_iva')
      .eq('id', productoId)
      .single()

    const cantidad = item.quantity ?? 1
    const precioUnitario = parseFloat(item.unit_price ?? '0') || parseFloat(item.price ?? '0') / cantidad
    const alicuotaIva  = producto?.alicuota_iva ?? 21
    const ivaFactor    = 1 + alicuotaIva / 100
    const subtotal     = precioUnitario * cantidad
    const ivaMonto     = subtotal - subtotal / ivaFactor

    ventaItems.push({
      tenant_id:              tenant_id,
      producto_id:            productoId,
      cantidad,
      precio_unitario:        precioUnitario,
      precio_costo_historico: producto?.precio_costo ?? 0,
      alicuota_iva:           alicuotaIva,
      iva_monto:              parseFloat(ivaMonto.toFixed(2)),
      subtotal:               parseFloat((precioUnitario * cantidad).toFixed(2)),
    })

    // Job de rebaje de stock (solo para pedidos que se van a reservar)
    if (estadoFinal === 'reservada') {
      stockJobs.push({
        tenant_id,
        sucursal_id,
        integracion: 'TiendaNube',
        tipo:        'rebaje_stock',
        payload: {
          producto_id: productoId,
          cantidad,
          origen:      'order/paid',
          tn_order_id: orderId,
        },
        status: 'pending',
      })
    }
  }

  // 6. Insertar venta
  const total            = parseFloat(order.total ?? '0')
  const shippingCost     = parseFloat(order.shipping_cost_owner ?? order.shipping?.cost ?? '0') || null
  const montoPagado      = estadoFinal === 'reservada' ? total : 0
  const medioPago        = JSON.stringify([{ tipo: 'TiendaNube', monto: total }])

  const { data: venta, error: ventaErr } = await supabase
    .from('ventas')
    .insert({
      tenant_id,
      sucursal_id,
      cliente_id:             clienteId,
      estado:                 estadoFinal,
      origen:                 'TiendaNube',
      tracking_id:            String(order.number),
      costo_envio_logistica:  shippingCost,
      total,
      monto_pagado:           montoPagado,
      medio_pago:             medioPago,
      notas:                  `Pedido TiendaNube #${order.number}`,
    })
    .select('id')
    .single()

  if (ventaErr || !venta) {
    console.error('Error creating venta:', ventaErr?.message)
    return new Response('Error creating venta', { status: 500 })
  }

  // Insertar items (rollback si falla)
  if (ventaItems.length > 0) {
    const { error: itemsErr } = await supabase
      .from('venta_items')
      .insert(ventaItems.map(item => ({ ...item, venta_id: venta.id })))

    if (itemsErr) {
      console.error('Error inserting venta_items:', itemsErr.message)
      await supabase.from('ventas').delete().eq('id', venta.id)
      return new Response('Error creating venta items', { status: 500 })
    }
  }

  // 7. Log de idempotencia
  await supabase.from('ventas_externas_logs').insert({
    tenant_id,
    integracion:          'TiendaNube',
    webhook_external_id:  webhookKey,
    venta_id:             venta.id,
    payload_raw:          order,
  })

  // 8. Encolar jobs de rebaje
  if (stockJobs.length > 0) {
    const { error: jobErr } = await supabase
      .from('integration_job_queue')
      .insert(stockJobs)
    if (jobErr) console.warn('Error enqueuing stock jobs:', jobErr.message)
  }

  console.log(`Venta creada: ${venta.id} (${estadoFinal}) para pedido TN #${order.number}`)

  return new Response(JSON.stringify({ ok: true, venta_id: venta.id, estado: estadoFinal }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
