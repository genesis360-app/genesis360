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

// Crea el envío + domicilio automáticamente a partir de una orden pagada — best-effort,
// nunca lanza (el llamador decide si loguear). Campos de order.shipping_address
// confirmados contra la doc oficial de TiendaNube (tiendanube.github.io/api-documentation/
// resources/order): address, number, floor, locality, city, province, zipcode, country, phone.
async function crearEnvioAutomaticoTN(
  supabase: ReturnType<typeof createClient>,
  order: any,
  ctx: { tenant_id: string; sucursal_id: string | null; venta_id: string; cliente_id: string },
): Promise<void> {
  const sa = order.shipping_address
  if (!sa?.address) {
    console.warn(`Pedido TN #${order.number} sin shipping_address.address — no se creó envío automático`)
    return
  }

  const { data: domicilio, error: domErr } = await supabase
    .from('cliente_domicilios')
    .insert({
      tenant_id:     ctx.tenant_id,
      cliente_id:    ctx.cliente_id,
      nombre:        order.contact_name ?? order.customer?.name ?? null,
      calle:         sa.address,
      numero:        sa.number ?? null,
      piso_depto:    sa.floor ?? null,
      ciudad:        sa.city ?? null,
      provincia:     sa.province ?? null,
      codigo_postal: sa.zipcode ?? null,
      referencias:   sa.locality && sa.locality !== sa.city ? `Localidad: ${sa.locality}` : null,
      es_principal:  false,
    })
    .select('id')
    .single()

  if (domErr) throw domErr

  const destinoDescripcion = [sa.address, sa.number, sa.floor].filter(Boolean).join(' ')
    + ([sa.city, sa.province, sa.zipcode].some(Boolean) ? `, ${[sa.city, sa.province, sa.zipcode].filter(Boolean).join(' ')}` : '')

  const { error: envioErr } = await supabase.from('envios').insert({
    tenant_id:            ctx.tenant_id,
    sucursal_id:          ctx.sucursal_id,
    venta_id:             ctx.venta_id,
    canal:                'TiendaNube',
    destino_id:           (domicilio as any).id,
    destino_descripcion:  destinoDescripcion.trim(),
    estado:               'pendiente',
  })
  if (envioErr) throw envioErr

  console.log(`Envío creado automáticamente para venta ${ctx.venta_id} (pedido TN #${order.number})`)
}

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

  // Solo procesamos pedidos pagados, creados o cancelados
  if (!['order/paid', 'order/created', 'order/cancelled'].includes(event)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Cancelación: liberar cantidad_reservada ───────────────────────────────
  if (event === 'order/cancelled') {
    const supabaseCxl = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const trackingId = String(orderId)
    const { data: cred } = await supabaseCxl.from('tiendanube_credentials')
      .select('tenant_id').eq('store_id', store_id).maybeSingle()
    if (cred) {
      const { data: ventaCxl } = await supabaseCxl.from('ventas')
        .select('id, venta_items(producto_id, cantidad, linea_id)')
        .eq('tenant_id', cred.tenant_id).eq('tracking_id', trackingId).eq('origen', 'TiendaNube')
        .in('estado', ['pendiente', 'reservada']).maybeSingle()
      if (ventaCxl) {
        await supabaseCxl.from('ventas').update({ estado: 'cancelada' }).eq('id', ventaCxl.id)
        for (const item of (ventaCxl as any).venta_items ?? []) {
          if (item.linea_id) {
            // Atómico server-side (mig 362) — mismo criterio que las reservas de arriba,
            // evita pisar una liberación/reserva concurrente sobre la misma línea.
            const { error: liberarErr } = await supabaseCxl.rpc('fn_liberar_stock_linea', { p_linea_id: item.linea_id, p_cantidad: item.cantidad })
            if (liberarErr) console.error('[fn_liberar_stock_linea]', liberarErr.message)
          }
        }
        console.log(`Venta ${ventaCxl.id} cancelada, reservas liberadas`)
      }
    }
    return new Response(JSON.stringify({ ok: true, cancelled: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
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
    .select('id, estado, cliente_id')
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

      // Envío automático — best-effort, nunca bloquea la actualización de la venta.
      if ((ventaExistente as any).cliente_id) {
        try {
          await crearEnvioAutomaticoTN(supabase, order, {
            tenant_id, sucursal_id, venta_id: ventaExistente.id, cliente_id: (ventaExistente as any).cliente_id,
          })
        } catch (envioCatchErr: any) {
          console.error('Error creando envío automático (no bloqueante):', envioCatchErr?.message ?? envioCatchErr)
        }
      }
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

  // Si order/created llega después de order/paid (race condition) → ya existe la venta → no crear duplicado
  if (event === 'order/created' && ventaExistente) {
    console.log(`order/created llegó después de order/paid para pedido TN #${order.number} — venta ${ventaExistente.id} ya existe`)
    await supabase.from('ventas_externas_logs').insert({
      tenant_id, integracion: 'TiendaNube', webhook_external_id: webhookKey,
      venta_id: ventaExistente.id, payload_raw: order,
    })
    return new Response(JSON.stringify({ ok: true, skipped: 'already_exists', venta_id: ventaExistente.id }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Determinar estado para venta nueva
  const isPaid = order.payment_status === 'paid' || event === 'order/paid'
  const estadoVenta: string = isPaid ? 'reservada' : 'pendiente'

  // 4. Encontrar o crear cliente
  let clienteId: string | null = null
  let clienteNombre: string | null = null
  const customer = order.customer

  if (customer) {
    // Buscar por email primero, luego por nombre
    const orFilter = customer.email
      ? `email.eq.${customer.email}`
      : `nombre.ilike.${customer.name}`

    const { data: existingCliente } = await supabase
      .from('clientes')
      .select('id, nombre')
      .eq('tenant_id', tenant_id)
      .or(orFilter)
      .maybeSingle()

    if (existingCliente) {
      clienteId = existingCliente.id
      clienteNombre = existingCliente.nombre
    } else {
      // INSERT — si hay race condition y ya fue creado, el error 23505 lo capturamos
      const nombreNuevo = customer.name ?? 'Cliente TiendaNube'
      const { data: newCliente, error: insertErr } = await supabase
        .from('clientes')
        .insert({
          tenant_id,
          sucursal_id,
          nombre:   nombreNuevo,
          email:    customer.email ?? null,
          telefono: customer.phone ?? null,
        })
        .select('id')
        .maybeSingle()
      if (newCliente?.id) {
        clienteId = newCliente.id
        clienteNombre = nombreNuevo
      } else if (insertErr?.code === '23505' && customer.email) {
        // Duplicado por race condition — buscar el existente
        const { data: fallback } = await supabase.from('clientes')
          .select('id, nombre').eq('tenant_id', tenant_id).eq('email', customer.email).maybeSingle()
        clienteId = fallback?.id ?? null
        clienteNombre = fallback?.nombre ?? null
      } else {
        console.error('Error creando cliente desde pedido TN:', insertErr?.message ?? 'sin newCliente.id')
        clienteId = null
      }
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
      cliente_nombre:         clienteNombre,
      estado:                 estadoFinal,
      origen:                 'TiendaNube',
      tracking_id:            String(order.number),
      tn_order_id:            order.id ?? null,
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

  // 7. Si la venta es reservada → reservar stock en inventario_lineas (FIFO)
  //    Esto permite que el sync worker envíe stock correcto (cantidad - cantidad_reservada)
  if (estadoFinal === 'reservada') {
    for (const item of ventaItems) {
      const productoId = (item as any).producto_id
      const cantidad = Number((item as any).cantidad ?? 1)
      if (!productoId || cantidad <= 0) continue

      // Buscar líneas disponibles FIFO
      const { data: lineas } = await supabase
        .from('inventario_lineas')
        .select('id, cantidad, cantidad_reservada')
        .eq('tenant_id', tenant_id).eq('producto_id', productoId).eq('activo', true)
        .gt('cantidad', 0)
        .order('created_at', { ascending: true })
        .limit(5)

      let remaining = cantidad
      let primaryLineaId: string | null = null

      for (const linea of lineas ?? []) {
        // Atómico server-side (mig 362) — evita pisar una reserva concurrente (ej. una venta
        // de mostrador tocando la misma línea a la vez que este webhook).
        const { data: toReserveData, error: toReserveErr } = await supabase.rpc('fn_reservar_stock_linea', { p_linea_id: linea.id, p_cantidad: remaining })
        if (toReserveErr) console.error('[fn_reservar_stock_linea]', toReserveErr.message)
        const toReserve = Number(toReserveData ?? 0)
        if (toReserve <= 0) continue
        if (!primaryLineaId) primaryLineaId = linea.id
        remaining -= toReserve
        if (remaining <= 0) break
      }

      // D2 — si sigue faltando stock y el producto es un KIT/combo, intentar generar
      // automáticamente una tarea de armado con los componentes. Best-effort: si no alcanza
      // el stock de componentes en ubicaciones habilitadas para TN, la RPC no hace nada y la
      // venta queda con el mismo faltante que tendría cualquier producto sin armar — nunca
      // arma en silencio (relevamiento D2, A2).
      if (remaining > 0) {
        const { data: prodKit } = await supabase.from('productos').select('es_kit').eq('id', productoId).single()
        if (prodKit?.es_kit) {
          const { data: tareaArmadoId, error: armadoErr } = await supabase.rpc('fn_iniciar_armado_kit_auto', {
            p_tenant_id: tenant_id,
            p_kit_producto_id: productoId,
            p_cantidad: remaining,
            p_canal: 'TiendaNube',
            p_sucursal_id: sucursal_id,
            p_origen_ref: String(order.number),
          })
          if (armadoErr) {
            console.error('Error generando armado automático de kit (no bloqueante):', armadoErr.message)
          } else if (tareaArmadoId) {
            console.log(`Armado automático generado para kit ${productoId} (orden TN #${order.number}): tarea ${tareaArmadoId}`)
          }
        }
      }

      // Guardar linea_id en el venta_item para trazabilidad al despachar
      if (primaryLineaId) {
        await supabase.from('venta_items')
          .update({ linea_id: primaryLineaId })
          .eq('venta_id', venta.id).eq('producto_id', productoId)
      }
    }
  }

  // 7bis. Crear envío automático — best-effort, nunca bloquea la venta si falla.
  if (estadoFinal === 'reservada' && clienteId) {
    try {
      await crearEnvioAutomaticoTN(supabase, order, { tenant_id, sucursal_id, venta_id: venta.id, cliente_id: clienteId })
    } catch (envioCatchErr: any) {
      console.error('Error creando envío automático (no bloqueante):', envioCatchErr?.message ?? envioCatchErr)
    }
  }

  // 8. Log de idempotencia
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
