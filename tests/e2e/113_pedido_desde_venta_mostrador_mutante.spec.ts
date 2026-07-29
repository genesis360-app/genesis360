/**
 * 113_pedido_desde_venta_mostrador_mutante.spec.ts
 * E2E MUTANTE — Pedido nacido de una VENTA (migs 315-319) y su entrega en el mostrador.
 *
 * Regla del diagrama de flujo de GO: **todas las ventas generan Pedido de preparación MENOS la
 * entrega directa** (mostrador + cobrada + sin envío, el cliente se lleva la mercadería ahí mismo).
 *
 * 🛑 Lo que este spec protege es REGLA #0, no la UI. Un pedido nacido de una venta ya tiene su
 * plata y su stock resueltos, así que las formas de romperlo son silenciosas:
 *   · reservar el stock por SEGUNDA vez al lanzarlo,
 *   · generar una SEGUNDA venta al entregarlo (doble facturación + doble rebaje + doble caja),
 *   · dejar salir mercadería SIN COBRAR el saldo de una reserva.
 * Los tres se asertan contra la DB, no contra la pantalla.
 *
 * Todo por REST a propósito: los guards tienen que vivir en el SERVIDOR — la UI se cachea, y el
 * importador y las Edge Functions escriben con service_role sin pasarle por al lado.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type Ctx = { headers: Record<string, string>; J: Record<string, string>; tenantId: string; sucId: string }

async function ctx(page: any, request: any): Promise<Ctx> {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const J = { ...headers, Prefer: 'return=representation' }
  const [suc] = (await (await request.get(
    `${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })).json()) as any[]
  return { headers, J, tenantId: suc.tenant_id, sucId: suc.id }
}

/** Nombre de un canal activo de la clasificación pedida (la regla depende de esto). */
async function canal(c: Ctx, request: any, clasif: 'online' | 'presencial'): Promise<string> {
  const r = await request.get(
    `${SUPABASE_URL}/rest/v1/canales_venta?select=nombre&tenant_id=eq.${c.tenantId}&activo=eq.true&clasificacion=eq.${clasif}&limit=1`,
    { headers: c.headers })
  const [row] = (await r.json()) as any[]
  expect(row, `[113] el tenant necesita un canal ${clasif} activo`).toBeTruthy()
  return row.nombre
}

async function crearVenta(c: Ctx, request: any, data: Record<string, unknown>) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
    headers: c.J,
    data: { tenant_id: c.tenantId, sucursal_id: c.sucId, consumidor_final: true, ...data },
  })
  expect(res.ok(), `[113] no se pudo crear la venta: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function pedidoDe(c: Ctx, request: any, ventaId: string) {
  const r = await request.get(
    `${SUPABASE_URL}/rest/v1/pedidos?venta_origen_id=eq.${ventaId}&select=id,numero,estado,requiere_envio`,
    { headers: c.headers })
  return (await r.json()) as any[]
}

test.describe('Pedido desde venta + entrega en mostrador (mutante)', () => {

  // ── Las 8 ramas del diagrama de flujo de GO ─────────────────────────────────────────
  test('todas las ventas generan pedido MENOS la entrega directa (8 ramas)', async ({ page, request }) => {
    test.setTimeout(120000)
    const c = await ctx(page, request)
    const online = await canal(c, request, 'online')
    const pres = await canal(c, request, 'presencial')

    const conEnvio = async (ventaId: string, courier: string | null) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/envios`, {
        headers: c.J,
        data: { tenant_id: c.tenantId, sucursal_id: c.sucId, venta_id: ventaId, estado: 'pendiente',
                canal: courier ?? 'Propio', courier },
      })
      expect(res.ok(), `[113] no se pudo crear el envío: ${await res.text()}`).toBe(true)
    }
    const base = { subtotal: 1000, total: 1000 }

    // ── VENTA ONLINE — las 4 ramas preparan pedido ──
    const v1 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 400, origen: online })
    const p1 = await pedidoDe(c, request, v1.id)
    expect(p1, '[113] online · retiro local con pago PARCIAL debe generar pedido igual').toHaveLength(1)
    expect(p1[0].requiere_envio, '[113] sin envío = retiro en local').toBe(false)

    const v2 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: online })
    expect(await pedidoDe(c, request, v2.id), '[113] online · retiro local pago completo').toHaveLength(1)

    const v3 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: online })
    await conEnvio(v3.id, null)
    const p3 = await pedidoDe(c, request, v3.id)
    expect(p3, '[113] online · envío PROPIO').toHaveLength(1)
    expect(p3[0].requiere_envio, '[113] con envío el pedido NO es retiro en local').toBe(true)

    const v4 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: online })
    await conEnvio(v4.id, 'Andreani')
    const p4 = await pedidoDe(c, request, v4.id)
    expect(p4, '[113] online · envío de TERCERO').toHaveLength(1)
    expect(p4[0].requiere_envio).toBe(true)

    // El envío tiene que quedar RELACIONADO con el pedido (pedido de GO: "todo relacionado")
    const env4 = await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?venta_id=eq.${v4.id}&select=pedido_id`, { headers: c.headers })).json() as any[]
    expect(env4[0].pedido_id, '[113] el envío debe quedar vinculado al pedido').toBe(p4[0].id)

    // ── COMPRAS LOCAL — solo la entrega directa queda afuera ──
    const v5 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: pres })
    expect(await pedidoDe(c, request, v5.id),
      '🛑 [113] ENTREGA DIRECTA: el cliente se llevó la mercadería, no hay nada que preparar').toHaveLength(0)

    const v6 = await crearVenta(c, request, { subtotal: 2000, total: 2000, estado: 'reservada', monto_pagado: 500, origen: pres })
    expect(await pedidoDe(c, request, v6.id),
      '[113] la reserva con seña parcial se prepara igual — el pago se valida al entregar').toHaveLength(1)

    const v7 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: pres })
    await conEnvio(v7.id, null)
    expect(await pedidoDe(c, request, v7.id),
      '[113] mostrador + envío propio: el envío tiene que CREAR el pedido').toHaveLength(1)

    const v8 = await crearVenta(c, request, { ...base, estado: 'despachada', monto_pagado: 1000, origen: pres })
    await conEnvio(v8.id, 'OCA')
    expect(await pedidoDe(c, request, v8.id),
      '[113] mostrador + envío de tercero: el envío tiene que CREAR el pedido').toHaveLength(1)
  })

  // ── Ciclo completo + los guards de Regla #0 ─────────────────────────────────────────
  test('ciclo completo: no re-reserva · gate de pago · no duplica la venta · rastro en Envíos', async ({ page, request }) => {
    test.setTimeout(120000)
    const c = await ctx(page, request)
    const pres = await canal(c, request, 'presencial')

    const lineas = await (await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?select=id,producto_id,lpn,cantidad,cantidad_reservada,ubicacion_id,sucursal_id&activo=eq.true&cantidad=gte.5&ubicacion_id=not.is.null&limit=1`,
      { headers: c.headers })).json() as any[]
    expect(lineas.length, '[113] hace falta una línea de inventario con stock ≥ 5').toBeGreaterThan(0)
    const linea = lineas[0]
    const reservadaAntes = Number(linea.cantidad_reservada ?? 0)
    const cantidadAntes = Number(linea.cantidad)

    // Reserva de mostrador con seña PARCIAL (rama 6 del diagrama)
    const venta = await crearVenta(c, request, {
      sucursal_id: linea.sucursal_id, estado: 'reservada',
      subtotal: 5000, total: 5000, monto_pagado: 1500, origen: pres, cliente_nombre: `E2E Retiro ${Date.now()}`,
    })
    const [vi] = (await (await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
      headers: c.J,
      data: { tenant_id: c.tenantId, venta_id: venta.id, producto_id: linea.producto_id, cantidad: 4, precio_unitario: 1250, subtotal: 5000 },
    })).json()) as any[]
    // La venta ya decidió de qué LPN sale (ISS-075)
    await request.post(`${SUPABASE_URL}/rest/v1/venta_item_despachos`, {
      headers: c.J,
      data: { tenant_id: c.tenantId, venta_id: venta.id, venta_item_id: vi.id, producto_id: linea.producto_id,
              linea_id: linea.id, lpn: linea.lpn, ubicacion_id: linea.ubicacion_id, cantidad: 4, origen: 'auto' },
    })

    const [pedido] = await pedidoDe(c, request, venta.id)
    expect(pedido, '[113] la reserva debe generar el pedido').toBeTruthy()
    expect(pedido.estado).toBe('confirmado')

    const items = await (await request.get(
      `${SUPABASE_URL}/rest/v1/pedido_items?pedido_id=eq.${pedido.id}&select=cantidad`, { headers: c.headers })).json() as any[]
    expect(items, '[113] las líneas de la venta se copian al pedido aunque lleguen después').toHaveLength(1)
    expect(Number(items[0].cantidad)).toBe(4)

    // 🛑 Lanzar NO puede volver a reservar: la venta ya comprometió ese stock
    const lanzar = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, {
      headers: c.headers, data: { p_pedido_id: pedido.id },
    })
    expect(lanzar.ok(), `[113] no se pudo lanzar: ${await lanzar.text()}`).toBe(true)

    const [lineaPost] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`, { headers: c.headers })).json() as any[]
    expect(Number(lineaPost.cantidad_reservada ?? 0),
      '🛑 [113] DOBLE RESERVA: la venta ya comprometió este stock').toBe(reservadaAntes)
    expect(Number(lineaPost.cantidad), '🛑 [113] lanzar no mueve la cantidad').toBe(cantidadAntes)

    const tareas = await (await request.get(
      `${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedido.id}&select=id,tipo,lpn_origen`, { headers: c.headers })).json() as any[]
    expect(tareas.length).toBeGreaterThan(0)
    expect(tareas[0].lpn_origen, '[113] el picking apunta al LPN que ya eligió la venta').toBe(linea.lpn)

    // Completar el picking promueve a listo_para_entrega (estado que antes era inalcanzable)
    for (const t of tareas.filter(t => t.tipo === 'picking')) {
      const ok = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_completar_tarea_picking`, {
        headers: c.headers, data: { p_tarea_id: t.id },
      })
      expect(ok.ok(), `[113] no se pudo completar la tarea: ${await ok.text()}`).toBe(true)
    }
    const [pedListo] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado`, { headers: c.headers })).json() as any[]
    expect(pedListo.estado, '[113] con el picking terminado queda listo para entregar').toBe('listo_para_entrega')

    // 💵 Gate de pago: no puede salir mercadería con la reserva a medio cobrar
    const sinPagar = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_entregar_retiro`, {
      headers: c.headers, data: { p_pedido_id: pedido.id, p_receptor: null },
    })
    expect(sinPagar.ok(),
      '💵🛑 [113] la mercadería NO puede salir con $3500 sin cobrar').toBe(false)

    // 🛑 Y nadie puede generar una segunda venta sobre este pedido
    const dup = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers: c.J,
      data: { tenant_id: c.tenantId, sucursal_id: linea.sucursal_id, estado: 'despachada',
              subtotal: 1, total: 1, origen: 'Pedidos', consumidor_final: true, pedido_id: pedido.id },
    })
    expect(dup.ok(), '🛑 [113] DOBLE FACTURACIÓN sobre un pedido que ya nació de una venta').toBe(false)

    // Se cobra el saldo → recién ahí entrega
    await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, {
      headers: c.headers, data: { monto_pagado: 5000 },
    })
    const ent = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_entregar_retiro`, {
      headers: c.headers, data: { p_pedido_id: pedido.id, p_receptor: 'E2E Receptor' },
    })
    expect(ent.ok(), `[113] con la venta saldada debe entregar: ${await ent.text()}`).toBe(true)
    expect(await ent.json(), '[113] devuelve la venta para poder facturarla').toBe(venta.id)

    const [pedEnt] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado,entregado_at`, { headers: c.headers })).json() as any[]
    expect(pedEnt.estado).toBe('entregado')
    expect(pedEnt.entregado_at).not.toBeNull()

    // Envíos = trazabilidad única de entregas (decisión de GO)
    const envios = await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?pedido_id=eq.${pedido.id}&select=tipo,estado,venta_id`, { headers: c.headers })).json() as any[]
    expect(envios, '[113] el retiro queda registrado en Envíos').toHaveLength(1)
    expect(envios[0].tipo).toBe('retiro_local')
    expect(envios[0].estado).toBe('entregado')
    expect(envios[0].venta_id).toBe(venta.id)

    // 🛑 La entrega no movió ni plata ni stock
    const [lineaFin] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`, { headers: c.headers })).json() as any[]
    expect(Number(lineaFin.cantidad), '🛑 [113] la venta ya rebajó: entregar no rebaja de nuevo').toBe(cantidadAntes)
    expect(Number(lineaFin.cantidad_reservada ?? 0)).toBe(reservadaAntes)
    expect(await (await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?pedido_id=eq.${pedido.id}&select=id`, { headers: c.headers })).json() as any[],
      '🛑 [113] entregar NO creó una venta nueva').toHaveLength(0)

    // Ya entregado, sale de la lista del mostrador
    expect(await (await request.get(
      `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&estado=eq.listo_para_entrega&select=id`, { headers: c.headers })).json() as any[],
      '[113] el pedido entregado desaparece de la pestaña').toHaveLength(0)
  })

  // ── La excepción por canal ──────────────────────────────────────────────────────────
  test('un canal excluido en Config no genera pedido aunque le correspondiera', async ({ page, request }) => {
    test.setTimeout(60000)
    const c = await ctx(page, request)
    const ts = Date.now()

    const [canalOff] = (await (await request.post(`${SUPABASE_URL}/rest/v1/canales_venta`, {
      headers: c.J,
      data: { tenant_id: c.tenantId, nombre: `E2E CanalOff ${ts}`, clasificacion: 'online', activo: true },
    })).json()) as any[]

    const [tPrev] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${c.tenantId}&select=pedido_canales_excluidos`, { headers: c.headers })).json()) as any[]
    const previa = tPrev?.pedido_canales_excluidos ?? []

    try {
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${c.tenantId}`, {
        headers: c.headers, data: { pedido_canales_excluidos: [canalOff.id] },
      })
      // Una reserva online: sin la excepción generaría pedido seguro.
      const venta = await crearVenta(c, request, {
        subtotal: 100, total: 100, monto_pagado: 100, estado: 'reservada', origen: canalOff.nombre,
      })
      expect(await pedidoDe(c, request, venta.id),
        '[113] el canal excluido no debe generar pedido').toHaveLength(0)
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${c.tenantId}`, {
        headers: c.headers, data: { pedido_canales_excluidos: previa },
      })
      await request.patch(`${SUPABASE_URL}/rest/v1/canales_venta?id=eq.${canalOff.id}`, {
        headers: c.headers, data: { activo: false },
      })
    }
  })
})
