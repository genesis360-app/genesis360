import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Webhook de MercadoLibre.
// Recibe notificaciones de orders_v2 → crea/actualiza venta en Genesis360.

const MELI_API = 'https://api.mercadolibre.com'

// Crea el envío + domicilio automáticamente a partir de una orden pagada — best-effort,
// nunca lanza (el llamador decide si loguear). MELI no trae la dirección en la orden: hay
// que pedir el shipment aparte. Campos de receiver_address (street_name, street_number,
// zip_code, city.name, state.name, address_line, receiver_name, comment) confirmados
// contra un pedido de test real de la cuenta MELI conectada en DEV (orden 2000016142224986,
// shipment 46929555313, modo "me2" — Mercado Envíos).
async function crearEnvioAutomaticoMELI(
  supabase: ReturnType<typeof createClient>,
  token: string,
  order: any,
  ctx: { tenant_id: string; venta_id: string; cliente_id: string },
): Promise<void> {
  const shipmentId = order.shipping?.id
  if (!shipmentId) {
    console.warn(`Orden ML ${order.id} sin shipping.id — no se creó envío automático`)
    return
  }

  const shipRes = await fetch(`${MELI_API}/shipments/${shipmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!shipRes.ok) {
    console.warn(`No se pudo obtener shipment ${shipmentId} de ML (status ${shipRes.status}) — no se creó envío automático`)
    return
  }
  const shipment = await shipRes.json()
  const ra = shipment.receiver_address
  const calle = ra?.street_name ?? ra?.address_line ?? null
  if (!calle) {
    console.warn(`Shipment ${shipmentId} de ML sin dirección utilizable — no se creó envío automático`)
    return
  }

  const { data: domicilio, error: domErr } = await supabase
    .from('cliente_domicilios')
    .insert({
      tenant_id:     ctx.tenant_id,
      cliente_id:    ctx.cliente_id,
      nombre:        ra?.receiver_name ?? null,
      calle,
      numero:        ra.street_number ?? null,
      ciudad:        ra.city?.name ?? null,
      provincia:     ra.state?.name ?? null,
      codigo_postal: ra.zip_code ?? null,
      referencias:   ra.comment ?? null,
      es_principal:  false,
    })
    .select('id')
    .single()

  if (domErr) throw domErr

  const destinoDescripcion = [calle, ra.street_number].filter(Boolean).join(' ')
    + ([ra.city?.name, ra.state?.name, ra.zip_code].some(Boolean) ? `, ${[ra.city?.name, ra.state?.name, ra.zip_code].filter(Boolean).join(' ')}` : '')

  const { error: envioErr } = await supabase.from('envios').insert({
    tenant_id:            ctx.tenant_id,
    sucursal_id:          null,
    venta_id:             ctx.venta_id,
    canal:                'MELI',
    destino_id:           (domicilio as any).id,
    destino_descripcion:  destinoDescripcion.trim(),
    estado:               'pendiente',
  })
  if (envioErr) throw envioErr

  console.log(`Envío creado automáticamente para venta ${ctx.venta_id} (orden ML #${order.id})`)
}

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

    // Puede haber múltiples tenants con el mismo seller en testing — procesar todos
    const { data: creds } = await supabase
      .from('meli_credentials')
      .select('tenant_id, access_token, refresh_token, expires_at, seller_id')
      .eq('seller_id', sellerId)
      .eq('conectado', true)

    if (!creds || creds.length === 0) {
      console.warn('Sin credenciales para seller:', sellerId)
      return new Response(JSON.stringify({ ok: true, skipped: 'no_cred' }), { status: 200 })
    }

    // Procesar para cada tenant conectado con este seller
    for (const cred of creds) {
    const token = await getValidToken(supabase, cred)

    const orderRes = await fetch(`${MELI_API}${resource}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!orderRes.ok) throw new Error(`ML order fetch failed: ${orderRes.status}`)
    const order = await orderRes.json()

    const orderId = String(order.id)
    const logKey  = `meli-order-${orderId}`
    console.log(`Orden ML ${orderId} status:${order.status} logKey:${logKey}`)
    const estadoML    = order.status
    const nuevoEstado = estadoML === 'paid' ? 'reservada' : 'pendiente'

    // Insertar log PRIMERO — si ya existe (race condition) el UNIQUE constraint lo rechaza
    const { error: logInsertErr } = await supabase.from('ventas_externas_logs').insert({
      tenant_id:           cred.tenant_id,
      integracion:         'MercadoLibre',
      webhook_external_id: logKey,
      payload_raw:         { order_id: orderId, status: estadoML },
    })

    if (logInsertErr) {
      // Otra notificación concurrente ya lo procesó — solo actualizar estado si ahora está pagado
      // Bug histórico: acá se seleccionaba la columna 'payload', que no existe (la real es
      // 'payload_raw') — esta rama nunca encontraba ventaId y la transición pendiente→reservada
      // por pago tardío jamás corría. Corregido junto con el envío automático (Fase B ML/TN).
      const { data: existing } = await supabase
        .from('ventas_externas_logs').select('payload_raw')
        .eq('tenant_id', cred.tenant_id).eq('integracion', 'MercadoLibre')
        .eq('webhook_external_id', logKey).maybeSingle()
      const ventaId = (existing?.payload_raw as any)?.venta_id
      if (ventaId && estadoML === 'paid') {
        const { data: v } = await supabase.from('ventas').select('estado, cliente_id').eq('id', ventaId).maybeSingle()
        if (v?.estado === 'pendiente') {
          await supabase.from('ventas').update({
            estado: 'reservada',
            monto_pagado: Number(order.total_amount ?? 0),
          }).eq('id', ventaId)
          console.log(`Venta ${ventaId} → reservada (pago tardío)`)

          // Envío automático — best-effort, nunca bloquea la actualización de la venta.
          // `token` ya está resuelto arriba en este loop (getValidToken).
          if (v.cliente_id) {
            try {
              await crearEnvioAutomaticoMELI(supabase, token, order, { tenant_id: cred.tenant_id, venta_id: ventaId, cliente_id: v.cliente_id })
            } catch (envioCatchErr: any) {
              console.error('Error creando envío automático (no bloqueante):', envioCatchErr?.message ?? envioCatchErr)
            }
          }
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

    // D1 — Rentabilidad neta real: shipping_cost y taxes_amount viven en payments[], no en la
    // orden ni en order_items (confirmado contra un pedido real de MELI, orden 2000016142224986).
    // Se suman solo los pagos aprobados para no arrastrar montos de pagos rechazados/reintentados.
    const pagosAprobados = (order.payments ?? []).filter((p: any) => p.status === 'approved')
    const shippingCostMeli = pagosAprobados.reduce((acc: number, p: any) => acc + Number(p.shipping_cost ?? 0), 0) || null
    const impuestosMeli    = pagosAprobados.reduce((acc: number, p: any) => acc + Number(p.taxes_amount ?? 0), 0) || null

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
      notas:          `Orden ML #${orderId} | ${(order.order_items ?? []).map((i: any) => `${i.item?.title ?? i.item?.id} x${i.quantity}`).join(', ')}`,
      usuario_id:     null,
      costo_envio_logistica: shippingCostMeli,
      impuestos_marketplace: impuestosMeli,
    }).select('id').single()

    if (ventaErr) throw ventaErr

    for (const item of order.order_items ?? []) {
      const mlItemId = item.item?.id
      const cantidad = item.quantity ?? 1
      const precio   = item.unit_price ?? 0
      const saleFee  = item.sale_fee ?? null
      console.log(`Item ML: id=${mlItemId} qty=${cantidad} precio=${precio} sale_fee=${saleFee} tenant=${cred.tenant_id}`)
      const { data: mapped } = await supabase
        .from('inventario_meli_map').select('producto_id')
        .eq('tenant_id', cred.tenant_id).eq('meli_item_id', mlItemId).maybeSingle()
      console.log(`Mapeo: ${mapped ? 'ENCONTRADO producto_id=' + mapped.producto_id : 'NO ENCONTRADO'}`)
      if (mapped) {
        // D1 — sin esto, precio_costo_historico quedaba siempre NULL en ventas MELI (bug
        // preexistente) y la ganancia neta no se podía calcular.
        const { data: producto } = await supabase
          .from('productos').select('precio_costo').eq('id', mapped.producto_id).maybeSingle()
        const { error: viErr } = await supabase.from('venta_items').insert({
          tenant_id:       cred.tenant_id,
          venta_id:        venta.id,
          producto_id:     mapped.producto_id,
          cantidad,
          precio_unitario: precio,
          subtotal:        cantidad * precio,
          alicuota_iva:    21,
          iva_monto:       0,
          comision_marketplace:  saleFee,
          precio_costo_historico: producto?.precio_costo ?? 0,
        })
        if (viErr) console.error('Error insertando venta_item:', viErr.message)
        else console.log(`venta_item creado: producto ${mapped.producto_id} x${cantidad}`)
      } else {
        console.log(`Sin mapeo para item ${mlItemId} en tenant ${cred.tenant_id}`)
      }
    }

    // Reservar stock en inventario_lineas para ventas reservadas (FIFO)
    // Permite que el sync worker envíe stock correcto (cantidad - cantidad_reservada)
    if (nuevoEstado === 'reservada' || nuevoEstado === 'pendiente') {
      for (const item of order.order_items ?? []) {
        const mlItemId = item.item?.id
        const cantidad = item.quantity ?? 1
        const { data: mapped } = await supabase
          .from('inventario_meli_map').select('producto_id')
          .eq('tenant_id', cred.tenant_id).eq('meli_item_id', mlItemId).maybeSingle()
        if (!mapped) continue

        const { data: lineas } = await supabase
          .from('inventario_lineas')
          .select('id, cantidad, cantidad_reservada')
          .eq('tenant_id', cred.tenant_id).eq('producto_id', mapped.producto_id).eq('activo', true)
          .gt('cantidad', 0)
          .order('created_at', { ascending: true })
          .limit(5)

        let remaining = cantidad
        let primaryLineaId: string | null = null

        for (const linea of lineas ?? []) {
          const disponible = (linea.cantidad ?? 0) - (linea.cantidad_reservada ?? 0)
          if (disponible <= 0) continue
          const toReserve = Math.min(disponible, remaining)
          await supabase.from('inventario_lineas')
            .update({ cantidad_reservada: (linea.cantidad_reservada ?? 0) + toReserve })
            .eq('id', linea.id)
          if (!primaryLineaId) primaryLineaId = linea.id
          remaining -= toReserve
          if (remaining <= 0) break
        }

        if (primaryLineaId) {
          await supabase.from('venta_items')
            .update({ linea_id: primaryLineaId })
            .eq('venta_id', venta.id).eq('producto_id', mapped.producto_id)
        }
      }
    }

    // Envío automático — best-effort, nunca bloquea la venta si falla. Solo cuando está pagada.
    if (nuevoEstado === 'reservada' && clienteId) {
      try {
        await crearEnvioAutomaticoMELI(supabase, token, order, { tenant_id: cred.tenant_id, venta_id: venta.id, cliente_id: clienteId })
      } catch (envioCatchErr: any) {
        console.error('Error creando envío automático (no bloqueante):', envioCatchErr?.message ?? envioCatchErr)
      }
    }

    // Actualizar log con venta_id
    await supabase.from('ventas_externas_logs')
      .update({ venta_id: venta.id, payload_raw: { order_id: orderId, status: estadoML, venta_id: venta.id } })
      .eq('tenant_id', cred.tenant_id).eq('webhook_external_id', logKey)

    console.log(`Orden ML ${orderId} → venta ${venta.id} (${nuevoEstado}) tenant:${cred.tenant_id}`)
    } // end for cred

    return new Response(JSON.stringify({ ok: true }), { status: 200 })

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
