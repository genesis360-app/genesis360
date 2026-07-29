/**
 * 113_pedido_desde_venta_mostrador_mutante.spec.ts
 * E2E MUTANTE — Pedido nacido de una VENTA (migs 315/316) y su entrega en el mostrador.
 *
 * Hasta la mig 314 el único puente entre los módulos era Pedido → venta. La 315 abre el sentido
 * inverso: una venta de ciertos canales genera sola un Pedido de preparación.
 *
 * 🛑 Lo que este spec protege es REGLA #0, no la UI. Un pedido nacido de una venta ya tiene su
 * plata y su stock resueltos, así que las dos formas de romperlo son silenciosas:
 *   · reservar el stock por SEGUNDA vez al lanzarlo (la venta ya lo comprometió), y
 *   · generar una SEGUNDA venta al entregarlo (doble facturación + doble rebaje + doble caja).
 * Los dos se asertan explícitamente acá, contra la DB, no contra la pantalla.
 *
 * Genera su propia precondición (canal, venta, líneas, despacho) y deja la config del tenant como
 * estaba. Todo por REST a propósito: los guards tienen que vivir en el SERVIDOR — la UI se cachea
 * y el importador y las Edge Functions escriben con service_role sin pasar por ella.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Pedido desde venta + entrega en mostrador (mutante)', () => {
  test('canal configurado genera pedido · no re-reserva · no duplica la venta · entrega deja rastro en Envíos', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const J = { ...headers, Prefer: 'return=representation' }

    // ── Precondición ────────────────────────────────────────────────────────────────────
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    const tenantId = suc.tenant_id

    // Canal propio del test, para no depender de cuáles tenga configurados el tenant.
    const canalRes = await request.post(`${SUPABASE_URL}/rest/v1/canales_venta`, {
      headers: J, data: { tenant_id: tenantId, nombre: `E2E Canal ${ts}`, clasificacion: 'online', activo: true },
    })
    expect(canalRes.ok(), `[113] no se pudo crear el canal: ${await canalRes.text()}`).toBe(true)
    const [canal] = (await canalRes.json()) as Array<{ id: string; nombre: string }>

    // Se guarda la config previa para restaurarla al final.
    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=pedido_canales_auto`, { headers })
    const [tPrev] = (await tRes.json()) as Array<{ pedido_canales_auto: string[] }>
    const configPrevia = tPrev?.pedido_canales_auto ?? []

    // Una línea de inventario REAL con stock, para poder mirar su cantidad_reservada.
    const lineaRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?select=id,producto_id,lpn,cantidad,cantidad_reservada,ubicacion_id,sucursal_id&activo=eq.true&cantidad=gte.5&ubicacion_id=not.is.null&limit=1`,
      { headers })
    const lineas = (await lineaRes.json()) as Array<any>
    expect(lineas.length, '[113] hace falta una línea de inventario con stock ≥ 5').toBeGreaterThan(0)
    const linea = lineas[0]
    const reservadaAntes = Number(linea.cantidad_reservada ?? 0)
    const cantidadAntes = Number(linea.cantidad)

    try {
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
        headers, data: { pedido_canales_auto: [canal.id] },
      })

      // ── 1) Reserva con seña PARCIAL → todavía NO hay pedido ──────────────────────────
      const ventaRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
        headers: J,
        data: {
          tenant_id: tenantId, sucursal_id: linea.sucursal_id, estado: 'reservada',
          subtotal: 5000, total: 5000, monto_pagado: 1000, origen: canal.nombre,
          consumidor_final: true, cliente_nombre: `E2E Retiro ${ts}`,
        },
      })
      expect(ventaRes.ok(), `[113] no se pudo crear la venta: ${await ventaRes.text()}`).toBe(true)
      const [venta] = (await ventaRes.json()) as Array<{ id: string; numero: number }>

      const sinPedido = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?venta_origen_id=eq.${venta.id}&select=id`, { headers })).json()
      expect(sinPedido, '[113] una reserva con seña parcial NO debe generar pedido').toHaveLength(0)

      // Líneas de la venta (llegan en una llamada aparte, igual que en registrarVenta)
      const viRes = await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
        headers: J,
        data: { tenant_id: tenantId, venta_id: venta.id, producto_id: linea.producto_id, cantidad: 4, precio_unitario: 1250, subtotal: 5000 },
      })
      expect(viRes.ok(), `[113] no se pudieron crear las líneas: ${await viRes.text()}`).toBe(true)
      const [vi] = (await viRes.json()) as Array<{ id: string }>

      // La venta ya decidió de qué LPN sale (ISS-075)
      await request.post(`${SUPABASE_URL}/rest/v1/venta_item_despachos`, {
        headers: J,
        data: {
          tenant_id: tenantId, venta_id: venta.id, venta_item_id: vi.id, producto_id: linea.producto_id,
          linea_id: linea.id, lpn: linea.lpn, ubicacion_id: linea.ubicacion_id, cantidad: 4, origen: 'auto',
        },
      })

      // ── 2) Se termina de pagar → recién ahí nace el pedido ───────────────────────────
      await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, {
        headers, data: { monto_pagado: 5000 },
      })
      const pedidos = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?venta_origen_id=eq.${venta.id}&select=id,numero,estado,requiere_envio`, { headers })).json() as Array<any>
      expect(pedidos, '[113] la reserva 100% pagada debe generar exactamente un pedido').toHaveLength(1)
      const pedido = pedidos[0]
      expect(pedido.estado, '[113] el pedido nace confirmado').toBe('confirmado')
      expect(pedido.requiere_envio, '[113] sin envío = retiro en local').toBe(false)

      const items = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedido_items?pedido_id=eq.${pedido.id}&select=producto_id,cantidad`, { headers })).json() as Array<any>
      expect(items, '[113] las líneas de la venta deben haberse copiado al pedido').toHaveLength(1)
      expect(Number(items[0].cantidad)).toBe(4)

      // ── 3) 🛑 Lanzar NO puede volver a reservar stock ────────────────────────────────
      const lanzarRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, {
        headers, data: { p_pedido_id: pedido.id },
      })
      expect(lanzarRes.ok(), `[113] no se pudo lanzar: ${await lanzarRes.text()}`).toBe(true)

      const [lineaPost] = await (await request.get(
        `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`, { headers })).json() as Array<any>
      expect(Number(lineaPost.cantidad_reservada ?? 0),
        '🛑 [113] DOBLE RESERVA: la venta ya comprometió este stock, lanzar el pedido no puede reservarlo otra vez')
        .toBe(reservadaAntes)
      expect(Number(lineaPost.cantidad), '🛑 [113] lanzar un pedido no mueve la cantidad').toBe(cantidadAntes)

      const tareas = await (await request.get(
        `${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedido.id}&select=id,tipo,lpn_origen,cantidad,estado`, { headers })).json() as Array<any>
      expect(tareas.length, '[113] tiene que haber generado el picking').toBeGreaterThan(0)
      expect(tareas[0].lpn_origen, '[113] el picking apunta al LPN que ya eligió la venta').toBe(linea.lpn)

      // ── 4) Completar el picking promueve a listo_para_entrega (antes era inalcanzable) ─
      for (const t of tareas.filter(t => t.tipo === 'picking')) {
        const okT = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_completar_tarea_picking`, {
          headers, data: { p_tarea_id: t.id },
        })
        expect(okT.ok(), `[113] no se pudo completar la tarea: ${await okT.text()}`).toBe(true)
      }
      const [pedListo] = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado`, { headers })).json() as Array<any>
      expect(pedListo.estado, '[113] con el picking terminado el pedido queda listo para entregar').toBe('listo_para_entrega')

      // ── 5) 🛑 Nadie puede generar una segunda venta sobre este pedido ────────────────
      const dupRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
        headers: J,
        data: {
          tenant_id: tenantId, sucursal_id: linea.sucursal_id, estado: 'despachada',
          subtotal: 1, total: 1, origen: 'Pedidos', consumidor_final: true, pedido_id: pedido.id,
        },
      })
      expect(dupRes.ok(),
        '🛑 [113] DOBLE FACTURACIÓN: no puede crearse una segunda venta sobre un pedido que ya nació de una venta')
        .toBe(false)

      // ── 6) Entrega en mostrador ──────────────────────────────────────────────────────
      const entRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_entregar_retiro`, {
        headers, data: { p_pedido_id: pedido.id, p_receptor: 'E2E Receptor' },
      })
      expect(entRes.ok(), `[113] no se pudo entregar: ${await entRes.text()}`).toBe(true)
      expect(await entRes.json(), '[113] la entrega devuelve la venta para poder facturarla').toBe(venta.id)

      const [pedEntregado] = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado,entregado_at`, { headers })).json() as Array<any>
      expect(pedEntregado.estado).toBe('entregado')
      expect(pedEntregado.entregado_at, '[113] queda fechada la entrega').not.toBeNull()

      // Envíos = trazabilidad única de entregas (decisión de GO)
      const envios = await (await request.get(
        `${SUPABASE_URL}/rest/v1/envios?pedido_id=eq.${pedido.id}&select=tipo,estado,venta_id,pod_receptor`, { headers })).json() as Array<any>
      expect(envios, '[113] el retiro debe quedar registrado en Envíos').toHaveLength(1)
      expect(envios[0].tipo).toBe('retiro_local')
      expect(envios[0].estado).toBe('entregado')
      expect(envios[0].venta_id).toBe(venta.id)

      // ── 7) 🛑 La entrega no movió ni plata ni stock ──────────────────────────────────
      const [lineaFinal] = await (await request.get(
        `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`, { headers })).json() as Array<any>
      expect(Number(lineaFinal.cantidad), '🛑 [113] la venta ya había rebajado: entregar no rebaja de nuevo').toBe(cantidadAntes)
      expect(Number(lineaFinal.cantidad_reservada ?? 0)).toBe(reservadaAntes)

      const ventasDelPedido = await (await request.get(
        `${SUPABASE_URL}/rest/v1/ventas?pedido_id=eq.${pedido.id}&select=id`, { headers })).json() as Array<any>
      expect(ventasDelPedido, '🛑 [113] entregar NO puede haber creado una venta nueva').toHaveLength(0)

      // ── 8) Ya entregado, sale de la lista del mostrador ──────────────────────────────
      const enLista = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&estado=eq.listo_para_entrega&select=id`, { headers })).json() as Array<any>
      expect(enLista, '[113] el pedido entregado desaparece de la pestaña del mostrador').toHaveLength(0)

    } finally {
      // Dejar la config del tenant como estaba — otros specs comparten este tenant.
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
        headers, data: { pedido_canales_auto: configPrevia },
      })
      await request.patch(`${SUPABASE_URL}/rest/v1/canales_venta?id=eq.${canal.id}`, {
        headers, data: { activo: false },
      })
    }
  })

  test('un canal NO configurado no genera ningún pedido', async ({ page, request }) => {
    test.setTimeout(60000)
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const J = { ...headers, Prefer: 'return=representation' }

    const [suc] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })).json()) as Array<any>

    // Canal nuevo que a propósito NO se agrega a pedido_canales_auto.
    const [canal] = (await (await request.post(`${SUPABASE_URL}/rest/v1/canales_venta`, {
      headers: J, data: { tenant_id: suc.tenant_id, nombre: `E2E CanalOff ${ts}`, clasificacion: 'online', activo: true },
    })).json()) as Array<{ id: string; nombre: string }>

    try {
      const [venta] = (await (await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
        headers: J,
        data: {
          tenant_id: suc.tenant_id, sucursal_id: suc.id, estado: 'despachada',
          subtotal: 100, total: 100, monto_pagado: 100, origen: canal.nombre, consumidor_final: true,
        },
      })).json()) as Array<{ id: string }>

      const pedidos = await (await request.get(
        `${SUPABASE_URL}/rest/v1/pedidos?venta_origen_id=eq.${venta.id}&select=id`, { headers })).json() as Array<any>
      expect(pedidos, '[113] un canal que no está en la config NO debe generar pedidos').toHaveLength(0)
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/canales_venta?id=eq.${canal.id}`, {
        headers, data: { activo: false },
      })
    }
  })
})
