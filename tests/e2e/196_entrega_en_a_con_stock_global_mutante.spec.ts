/**
 * 196_entrega_en_a_con_stock_global_mutante.spec.ts
 * 🛑 REGLA #0 (inventario) — UAT §111 (F3): la sucursal que VENDIÓ (Sur) entrega y finaliza una venta cuyo stock era de
 * NORTE en una ubicación Global. Por PANTALLA, como el cajero de Sur: Ventas → Retiro → "Entregado" → "Finalizar (rebaja
 * stock)".
 *
 * Verifica en la base: se rebaja exactamente el LPN de Norte que se reservó (y su reserva se cierra), el movimiento de stock
 * queda con la sucursal DUEÑA (Norte), la venta queda despachada en Sur.
 *
 * Preparación por API (igual que el 194): OWNER arma la venta de Sur y reserva el LPN de Norte; `supervisor@test.com`
 * (restringido a Norte) completa el picking. Limpieza: se devuelve la cantidad al LPN y se borran pedido y venta (las filas
 * de `movimientos_stock` no se pueden borrar desde la app — ledger inmutable — y quedan con venta_id NULL).
 * Corre con OWNER (chromium) contra DEV (Almacén Jorgito). Necesita la caja de Sur abierta ("Caja S2").
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { loginToken, restHeaders, tokenDesdeBrowser, SUPABASE_URL } from './helpers/fixtures'

const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'
const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

test('Sur entrega y finaliza por pantalla una venta con stock de Norte en Global: rebaja el LPN de Norte', async ({ page, request }) => {
  test.setTimeout(150000)
  test.skip(!process.env.E2E_SUPERVISOR_EMAIL || !process.env.E2E_SUPERVISOR_PASSWORD, 'Faltan credenciales del supervisor de Norte')
  await goto(page, '/dashboard')
  await waitForApp(page)
  await page.evaluate((id) => {
    localStorage.setItem('sucursal-id', id)
    for (const k of Object.keys(localStorage)) if (/cart|carrito/i.test(k)) localStorage.removeItem(k)
  }, SUR)
  const hOwner = { ...restHeaders(await tokenDesdeBrowser(page)), Prefer: 'return=representation' }
  const hNorte = restHeaders(await loginToken(request, process.env.E2E_SUPERVISOR_EMAIL, process.env.E2E_SUPERVISOR_PASSWORD))
  const url = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`
  const get = async (h: any, p: string) => (await request.get(url(p), { headers: h })).json()
  const rpc = async (h: any, fn: string, body: any) => request.post(url(`rpc/${fn}`), { headers: h, data: body })

  const cajaSur = await get(hOwner, `caja_sesiones?sucursal_id=eq.${SUR}&estado=eq.abierta&select=id,cajas!inner(es_caja_fuerte)&cajas.es_caja_fuerte=eq.false`) as any[]
  test.skip(cajaSur.length !== 1, `[196] hace falta exactamente una caja abierta en Sur (hay ${cajaSur.length})`)

  const globales = await get(hOwner,
    `inventario_lineas?tenant_id=eq.${TENANT}&sucursal_id=eq.${NORTE}&activo=eq.true` +
    `&select=id,lpn,producto_id,cantidad,cantidad_reservada,ubicaciones!inner(sucursal_id),productos!inner(tiene_series)` +
    `&ubicaciones.sucursal_id=is.null&productos.tiene_series=eq.false&order=cantidad.desc&limit=30`) as any[]
  const linea = globales.find(l => Number(l.cantidad) - Number(l.cantidad_reservada ?? 0) >= 2)
  test.skip(!linea, '[196] no hay un LPN de Norte en una ubicación Global con 2 libres')
  const antes = (await get(hOwner, `inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`))[0]
  const cliente = `E2E Global ${Date.now()}`

  let ventaId: string | null = null
  let pedidoId: string | null = null
  try {
    // ── Preparación por API: venta de Sur (total 0, ya saldada) que reserva 2 del LPN de Norte → pedido → Norte pickea.
    const rv = await request.post(url('ventas'), { headers: hOwner, data: {
      tenant_id: TENANT, sucursal_id: SUR, estado: 'pendiente', subtotal: 0, total: 0, monto_pagado: 0,
      consumidor_final: true, cliente_nombre: cliente, notas: 'e2e 196 — entrega en A con stock Global' } })
    expect(rv.ok(), await rv.text()).toBeTruthy()
    ventaId = (await rv.json())[0].id
    const ri = await request.post(url('venta_items'), { headers: hOwner, data: {
      tenant_id: TENANT, venta_id: ventaId, producto_id: linea.producto_id, cantidad: 2, precio_unitario: 0, subtotal: 0 } })
    expect(ri.ok(), await ri.text()).toBeTruthy()
    const itemId = (await ri.json())[0].id
    const rr = await rpc(hOwner, 'fn_venta_reservar_linea', { p_venta_item_id: itemId, p_linea_id: linea.id, p_cantidad: 2 })
    expect(await rr.json(), '[196] reserva de las 2 del LPN de Norte').toBe(2)
    expect((await request.patch(url(`ventas?id=eq.${ventaId}`), { headers: hOwner, data: { estado: 'reservada', reservado_at: new Date().toISOString() } })).ok()).toBeTruthy()
    pedidoId = (await get(hOwner, `pedidos?venta_origen_id=eq.${ventaId}&select=id`))[0]?.id
    expect(pedidoId, '[196] la reserva genera el pedido').toBeTruthy()
    expect((await rpc(hOwner, 'fn_generar_tareas_picking_pedido', { p_pedido_id: pedidoId })).ok()).toBeTruthy()
    const [tarea] = await get(hOwner, `wms_tareas?pedido_id=eq.${pedidoId}&select=id,sucursal_id`) as any[]
    expect(tarea.sucursal_id, '[196] la tarea es de Norte').toBe(NORTE)
    const rc = await rpc(hNorte, 'fn_completar_tarea_picking', { p_tarea_id: tarea.id })
    expect(rc.ok(), await rc.text()).toBeTruthy()
    expect((await get(hOwner, `pedidos?id=eq.${pedidoId}&select=estado`))[0].estado).toBe('listo_para_entrega')

    // ── Por pantalla, en SUR: Ventas → Retiro → "Entregado" → "Finalizar (rebaja stock)".
    await goto(page, '/ventas?tab=pedidos')
    await waitForApp(page)
    const fila = page.locator('div').filter({ has: page.getByText(cliente, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /^Entregado$/ }) }).last()
    await expect(fila, '[196] el pedido listo tiene que aparecer en Retiro de Sur').toBeVisible({ timeout: 20000 })
    await fila.getByRole('button', { name: /^Entregado$/ }).click()
    await expect(page.getByText(/Pedido #\d+ entregado/).first()).toBeVisible({ timeout: 15000 })
    const finalizar = page.getByRole('button', { name: /Finalizar \(rebaja stock\)/ }).first()
    await expect(finalizar, '[196] el detalle de la venta tiene que ofrecer Finalizar').toBeVisible({ timeout: 15000 })
    await finalizar.click()

    // ── Verificación en la base.
    await expect.poll(async () => (await get(hOwner, `ventas?id=eq.${ventaId}&select=estado`))[0]?.estado,
      { timeout: 20000, message: '[196] la venta tiene que quedar despachada' }).toBe('despachada')
    const venta = (await get(hOwner, `ventas?id=eq.${ventaId}&select=sucursal_id`))[0]
    expect(venta.sucursal_id, '[196] la venta sigue siendo de Sur').toBe(SUR)
    const despues = (await get(hOwner, `inventario_lineas?id=eq.${linea.id}&select=cantidad,cantidad_reservada`))[0]
    expect(despues.cantidad, '🛑 [196] se rebajan exactamente las 2 del LPN de Norte').toBe(antes.cantidad - 2)
    expect(despues.cantidad_reservada, '🛑 [196] la reserva de la venta se cierra (no queda reservado de más ni de menos)').toBe(antes.cantidad_reservada)
    expect(await get(hOwner, `venta_item_reservas?venta_id=eq.${ventaId}&select=id`), '[196] sin anotaciones vivas').toHaveLength(0)
    const movs = await get(hOwner, `movimientos_stock?venta_id=eq.${ventaId}&select=sucursal_id,cantidad,tipo`) as any[]
    expect(movs.map(m => [m.sucursal_id, Number(m.cantidad), m.tipo]), '🛑 [196] el movimiento de stock sale de NORTE (dueña del LPN)')
      .toEqual([[NORTE, 2, 'rebaje']])
  } finally {
    // Devolver el stock "vendido" al LPN y borrar lo de prueba (borrar la venta libera lo que quede reservado).
    const ahora = (await get(hOwner, `inventario_lineas?id=eq.${linea.id}&select=cantidad`))[0]
    if (ahora && ahora.cantidad !== antes.cantidad)
      await request.patch(url(`inventario_lineas?id=eq.${linea.id}`), { headers: hOwner, data: { cantidad: antes.cantidad, activo: true } })
    if (pedidoId) {
      await request.delete(url(`envios?pedido_id=eq.${pedidoId}`), { headers: hOwner })
      await request.delete(url(`wms_tareas?pedido_id=eq.${pedidoId}`), { headers: hOwner })
      await request.delete(url(`pedido_items?pedido_id=eq.${pedidoId}`), { headers: hOwner })
      await request.delete(url(`pedidos?id=eq.${pedidoId}`), { headers: hOwner })
    }
    if (ventaId) {
      await request.delete(url(`venta_item_despachos?venta_id=eq.${ventaId}`), { headers: hOwner })
      await request.delete(url(`ventas?id=eq.${ventaId}`), { headers: hOwner })
    }
  }
})
