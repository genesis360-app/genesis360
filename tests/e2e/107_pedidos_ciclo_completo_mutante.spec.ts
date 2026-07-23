/**
 * 107_pedidos_ciclo_completo_mutante.spec.ts
 * E2E MUTANTE — Módulo nuevo "Pedidos" (migs 292, 294-297): ciclo de vida completo.
 *
 * Pedidos es un documento separado de Ventas — nunca pasa por registrarVenta()/el POS.
 * "Lanzar" (fn_generar_tareas_picking_pedido, mig 294) reserva stock real y genera wms_tareas
 * (picking directo, o replenishment+picking encadenado si el stock está en bulk). "Entregar"
 * (fn_pedido_generar_venta, mig 295) genera la venta real (rebaja stock + asienta caja), fuera
 * del POS. La mig 297 arregló un bug real encontrado por el migration-reviewer en una función
 * YA EXISTENTE y compartida (fn_completar_tarea_reabastecimiento, mig 290): al mover stock
 * bulk→picking no transfería `cantidad_reservada` al LPN nuevo — dejaba "stock fantasma" sin
 * reservar en picking. Test A ejercita justo ese camino (stock arranca en bulk) y verifica
 * explícitamente que la reserva viaja con el stock. Test B cubre deslanzar (F5) antes de pickear.
 *
 * Genera su propia precondición 100% vía REST (token real del usuario, respeta RLS) — mismo
 * patrón que el spec 106. Limpia todo lo que crea al final.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, garantizarCajaAbierta, SUPABASE_URL } from './helpers/fixtures'

test.describe('Pedidos — ciclo de vida completo (mutante)', () => {
  test('Lanzar con reabastecimiento (bulk→picking) → completar → entregar genera la venta real, con la reserva transferida (fix mig 297)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[107] no se encontró sucursal para inferir tenant_id').toBeTruthy()
    const tenantId = suc.tenant_id

    // tipos_pedido ya viene sembrado por tenant (mig 292) — usamos el primero.
    const tipoRes = await request.get(`${SUPABASE_URL}/rest/v1/tipos_pedido?tenant_id=eq.${tenantId}&select=id&limit=1`, { headers })
    const [tipo] = (await tipoRes.json()) as Array<{ id: string }>
    expect(tipo, '[107] no hay ningún tipo_pedido sembrado para el tenant').toBeTruthy()

    const precioVenta = 500
    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E Pedido Reab ${ts}`, sku: `E2E-PED-REAB-${ts}`,
        precio_costo: 250, precio_venta: precioVenta, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[107] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers, data: [
        { tenant_id: tenantId, nombre: `E2E Picking Ped ${ts}`, tipo_ubicacion: 'picking', activo: true },
        { tenant_id: tenantId, nombre: `E2E Bulk Ped ${ts}`, tipo_ubicacion: 'bulk', activo: true },
      ],
    })
    expect(ubicRes.ok(), `[107] no se pudieron crear las ubicaciones: ${await ubicRes.text()}`).toBe(true)
    const ubics = (await ubicRes.json()) as Array<{ id: string; nombre: string }>
    const ubicPicking = ubics.find(u => u.nombre.startsWith('E2E Picking'))!
    const ubicBulk = ubics.find(u => u.nombre.startsWith('E2E Bulk'))!

    // TODO el stock arranca en BULK (no picking) — obliga a reabastecer al lanzar.
    const lpnBulk = `LPN-E2E-PED-${ts}`
    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn: lpnBulk, cantidad: 20, ubicacion_id: ubicBulk.id, sucursal_id: suc.id, activo: true },
    })
    expect(lineaRes.ok(), `[107] no se pudo crear el LPN en bulk: ${await lineaRes.text()}`).toBe(true)

    // ── Pedido en borrador → confirmado (vía REST, más rápido y no es lo que está bajo prueba) ──
    const pedidoRes = await request.post(`${SUPABASE_URL}/rest/v1/pedidos`, {
      // sucursal_id NULL a propósito (global) — evita depender de cuál sucursal esté activa en
      // la sesión del browser al mirar /picking (wms_tareas hereda pedidos.sucursal_id, y
      // PickingPage filtra por la sucursal activa O null; mismo criterio que el spec 106).
      headers, data: { tenant_id: tenantId, tipo_pedido_id: tipo.id, cliente_nombre: `E2E Cliente ${ts}`, estado: 'confirmado' },
    })
    expect(pedidoRes.ok(), `[107] no se pudo crear el pedido: ${await pedidoRes.text()}`).toBe(true)
    const [pedido] = (await pedidoRes.json()) as Array<{ id: string; numero: number }>

    const cantidadPedida = 6
    const itemRes = await request.post(`${SUPABASE_URL}/rest/v1/pedido_items`, {
      headers, data: { tenant_id: tenantId, pedido_id: pedido.id, producto_id: producto.id, cantidad: cantidadPedida },
    })
    expect(itemRes.ok(), `[107] no se pudo crear el pedido_item: ${await itemRes.text()}`).toBe(true)
    const [pedidoItem] = (await itemRes.json()) as Array<{ id: string }>

    // ── Lanzar (fn_generar_tareas_picking_pedido) ────────────────────────────────────────
    const lanzarRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, {
      headers, data: { p_pedido_id: pedido.id },
    })
    expect(lanzarRes.ok(), `[107] fn_generar_tareas_picking_pedido falló: ${await lanzarRes.text()}`).toBe(true)
    const tareasGeneradas = (await lanzarRes.json()) as Array<{ tarea_id: string; tipo: string }>
    expect(tareasGeneradas.map(t => t.tipo).sort(), '[107] con stock en bulk debe encadenar reabastecimiento+picking').toEqual(['picking', 'replenishment'])
    const tareaReabId = tareasGeneradas.find(t => t.tipo === 'replenishment')!.tarea_id
    const tareaPickId = tareasGeneradas.find(t => t.tipo === 'picking')!.tarea_id

    // Reserva real hecha al lanzar (H4)
    const lineaPostLanzarRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?lpn=eq.${lpnBulk}&select=id,cantidad,cantidad_reservada`, { headers },
    )
    const [lineaPostLanzar] = (await lineaPostLanzarRes.json()) as Array<{ id: string; cantidad: number; cantidad_reservada: number }>
    expect(Number(lineaPostLanzar.cantidad_reservada), '[107] lanzar debe reservar la cantidad pedida en la línea de bulk').toBe(cantidadPedida)
    expect(Number(lineaPostLanzar.cantidad), '[107] lanzar NO debe rebajar cantidad física todavía (solo reserva)').toBe(20)

    const pedidoPostLanzarRes = await request.get(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado`, { headers })
    const [pedidoPostLanzar] = (await pedidoPostLanzarRes.json()) as Array<{ estado: string }>
    expect(pedidoPostLanzar.estado).toBe('en_preparacion')

    // ── Completar el reabastecimiento vía UI (/picking) — mismo mecanismo que el spec 106 ──
    await goto(page, '/picking')
    await waitForApp(page)
    const cardReab = page.getByTestId(`tarea-${tareaReabId}`)
    const cardPicking = page.getByTestId(`tarea-${tareaPickId}`)
    await expect(cardReab).toBeVisible({ timeout: 10000 })
    await expect(cardPicking).toBeVisible()

    const btnPicking = cardPicking.getByRole('button', { name: /Confirmar retiro/ })
    await expect(btnPicking).toBeDisabled()

    await cardReab.getByRole('button', { name: /Confirmar reabastecimiento/ }).click()
    await expect(cardReab).not.toBeVisible({ timeout: 10000 })

    // ── FIX MIG 297: la reserva tiene que haber viajado con el stock físico ──────────────
    const lineasPostReabRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}&select=lpn,cantidad,cantidad_reservada,ubicacion_id`, { headers },
    )
    const lineasPostReab = (await lineasPostReabRes.json()) as Array<{ lpn: string; cantidad: number; cantidad_reservada: number; ubicacion_id: string }>
    expect(lineasPostReab).toHaveLength(2)
    const origenPost = lineasPostReab.find(l => l.lpn === lpnBulk)!
    const destinoPost = lineasPostReab.find(l => l.lpn !== lpnBulk)!
    expect(Number(origenPost.cantidad), '[107] origen bulk: 20-6=14 físico').toBe(14)
    expect(Number(origenPost.cantidad_reservada), '[107] origen bulk: la reserva se transfirió, debe quedar en 0').toBe(0)
    // fn_wms_elegir_ubicacion_picking elige la MEJOR ubicación picking del tenant (no
    // necesariamente la que creó este test — puede haber otras ya cargadas con prioridad más
    // alta) — no asumimos cuál, solo que sea alguna de tipo 'picking' real.
    const destinoUbicRes = await request.get(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${destinoPost.ubicacion_id}&select=tipo_ubicacion`, { headers })
    const [destinoUbic] = (await destinoUbicRes.json()) as Array<{ tipo_ubicacion: string }>
    expect(destinoUbic.tipo_ubicacion, '[107] el reabastecimiento debe mover el stock a una ubicación tipo picking').toBe('picking')
    expect(Number(destinoPost.cantidad), '[107] destino picking: 6 unidades movidas').toBe(6)
    expect(Number(destinoPost.cantidad_reservada), '[107] FIX MIG 297: el LPN nuevo en picking debe NACER reservado (antes nacía en 0 — stock fantasma)').toBe(6)

    await expect(btnPicking).toBeEnabled({ timeout: 5000 })
    await btnPicking.click()
    await expect(cardPicking).not.toBeVisible({ timeout: 10000 })

    // ── Entregar (fn_pedido_generar_venta) — requiere una caja abierta real ──────────────
    await garantizarCajaAbierta(page, { caja: 'Caja1' })
    const sesionRes = await request.get(`${SUPABASE_URL}/rest/v1/caja_sesiones?tenant_id=eq.${tenantId}&estado=eq.abierta&select=id&limit=1`, { headers })
    const [sesion] = (await sesionRes.json()) as Array<{ id: string }>
    expect(sesion, '[107] no se encontró ninguna caja abierta tras garantizarCajaAbierta').toBeTruthy()

    const entregaRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_generar_venta`, {
      headers, data: {
        p_pedido_id: pedido.id, p_sesion_caja_id: sesion.id,
        p_medio_pago: [{ tipo: 'Efectivo', monto: null }],
      },
    })
    expect(entregaRes.ok(), `[107] fn_pedido_generar_venta falló: ${await entregaRes.text()}`).toBe(true)
    const ventaId = (await entregaRes.json()) as string
    expect(ventaId, '[107] fn_pedido_generar_venta debe devolver el uuid de la venta').toBeTruthy()

    // ── Verificación POSITIVA en DB: venta real generada, stock rebajado, caja asentada ──
    const ventaRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=*`, { headers })
    const [venta] = (await ventaRes.json()) as Array<{ id: string; pedido_id: string; total: number; estado: string; sucursal_id: string }>
    expect(venta.pedido_id).toBe(pedido.id)
    expect(Number(venta.total)).toBe(precioVenta * cantidadPedida)
    expect(venta.estado).toBe('despachada')

    const ventaItemsRes = await request.get(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${ventaId}&select=*`, { headers })
    const [ventaItem] = (await ventaItemsRes.json()) as Array<{ pedido_item_id: string; cantidad: number }>
    expect(ventaItem.pedido_item_id).toBe(pedidoItem.id)
    expect(Number(ventaItem.cantidad)).toBe(cantidadPedida)

    const lineaFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}&lpn=eq.${destinoPost.lpn}&select=cantidad,cantidad_reservada,activo`, { headers })
    const [lineaFinal] = (await lineaFinalRes.json()) as Array<{ cantidad: number; cantidad_reservada: number; activo: boolean }>
    expect(Number(lineaFinal.cantidad), '[107] el LPN de picking debe quedar rebajado a 0 tras entregar').toBe(0)
    expect(Number(lineaFinal.cantidad_reservada)).toBe(0)

    const movRes = await request.get(`${SUPABASE_URL}/rest/v1/movimientos_stock?venta_id=eq.${ventaId}&select=tipo,cantidad`, { headers })
    const [mov] = (await movRes.json()) as Array<{ tipo: string; cantidad: number }>
    expect(mov.tipo).toBe('rebaje')
    expect(Number(mov.cantidad)).toBe(cantidadPedida)

    const cajaMovRes = await request.get(`${SUPABASE_URL}/rest/v1/caja_movimientos?sesion_id=eq.${sesion.id}&concepto=eq.Pedido%20%23${pedido.numero}&select=tipo,monto`, { headers })
    const cajaMovs = (await cajaMovRes.json()) as Array<{ tipo: string; monto: number }>
    expect(cajaMovs.length, '[107] el ingreso en efectivo debe asentarse en caja_movimientos').toBeGreaterThan(0)
    expect(cajaMovs[0].tipo).toBe('ingreso')
    expect(Number(cajaMovs[0].monto)).toBe(precioVenta * cantidadPedida)

    const pedidoFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado`, { headers })
    const [pedidoFinal] = (await pedidoFinalRes.json()) as Array<{ estado: string }>
    expect(pedidoFinal.estado, '[107] 100% entregado + cierre automático (default) → entregado').toBe('entregado')

    const pedidoItemFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/pedido_items?id=eq.${pedidoItem.id}&select=cantidad_entregada,estado`, { headers })
    const [pedidoItemFinal] = (await pedidoItemFinalRes.json()) as Array<{ cantidad_entregada: number; estado: string }>
    expect(Number(pedidoItemFinal.cantidad_entregada)).toBe(cantidadPedida)
    expect(pedidoItemFinal.estado).toBe('preparado')

    // ── Limpieza ──────────────────────────────────────────────────────────────────────
    await request.delete(`${SUPABASE_URL}/rest/v1/caja_movimientos?sesion_id=eq.${sesion.id}&concepto=eq.Pedido%20%23${pedido.numero}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/movimientos_stock?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_item_despachos?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedido_items?pedido_id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicPicking.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicBulk.id}`, { headers })
  })

  test('Deshacer lanzamiento (fn_pedido_deslanzar) antes de pickear libera la reserva y vuelve a confirmado', async ({ page, request }) => {
    test.setTimeout(60000)
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    const tenantId = suc.tenant_id

    const tipoRes = await request.get(`${SUPABASE_URL}/rest/v1/tipos_pedido?tenant_id=eq.${tenantId}&select=id&limit=1`, { headers })
    const [tipo] = (await tipoRes.json()) as Array<{ id: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E Pedido Deslanzar ${ts}`, sku: `E2E-PED-DESL-${ts}`,
        precio_costo: 50, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[107] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers, data: { tenant_id: tenantId, nombre: `E2E Picking Desl ${ts}`, tipo_ubicacion: 'picking', activo: true },
    })
    expect(ubicRes.ok(), `[107] no se pudo crear la ubicación: ${await ubicRes.text()}`).toBe(true)
    const [ubicPicking] = (await ubicRes.json()) as Array<{ id: string }>

    const lpn = `LPN-E2E-PED-DESL-${ts}`
    await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn, cantidad: 10, ubicacion_id: ubicPicking.id, sucursal_id: suc.id, activo: true },
    })

    const pedidoRes = await request.post(`${SUPABASE_URL}/rest/v1/pedidos`, {
      headers, data: { tenant_id: tenantId, tipo_pedido_id: tipo.id, cliente_nombre: `E2E Cliente Desl ${ts}`, estado: 'confirmado' },
    })
    expect(pedidoRes.ok(), `[107] no se pudo crear el pedido: ${await pedidoRes.text()}`).toBe(true)
    const [pedido] = (await pedidoRes.json()) as Array<{ id: string }>

    await request.post(`${SUPABASE_URL}/rest/v1/pedido_items`, {
      headers, data: { tenant_id: tenantId, pedido_id: pedido.id, producto_id: producto.id, cantidad: 3 },
    })

    const lanzarRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, { headers, data: { p_pedido_id: pedido.id } })
    expect(lanzarRes.ok(), `[107] fn_generar_tareas_picking_pedido falló: ${await lanzarRes.text()}`).toBe(true)

    const lineaPostLanzarRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?lpn=eq.${lpn}&select=cantidad_reservada`, { headers })
    const [lineaPostLanzar] = (await lineaPostLanzarRes.json()) as Array<{ cantidad_reservada: number }>
    expect(Number(lineaPostLanzar.cantidad_reservada)).toBe(3)

    const deslanzarRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_deslanzar`, { headers, data: { p_pedido_id: pedido.id } })
    expect(deslanzarRes.ok(), `[107] fn_pedido_deslanzar falló: ${await deslanzarRes.text()}`).toBe(true)

    const lineaPostDeslanzarRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?lpn=eq.${lpn}&select=cantidad,cantidad_reservada`, { headers })
    const [lineaPostDeslanzar] = (await lineaPostDeslanzarRes.json()) as Array<{ cantidad: number; cantidad_reservada: number }>
    expect(Number(lineaPostDeslanzar.cantidad_reservada), '[107] deslanzar debe liberar la reserva completa').toBe(0)
    expect(Number(lineaPostDeslanzar.cantidad)).toBe(10)

    const pedidoPostRes = await request.get(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}&select=estado,lanzado_at`, { headers })
    const [pedidoPost] = (await pedidoPostRes.json()) as Array<{ estado: string; lanzado_at: string | null }>
    expect(pedidoPost.estado, '[107] deslanzar debe volver el pedido a confirmado').toBe('confirmado')
    expect(pedidoPost.lanzado_at).toBeNull()

    const tareasRes = await request.get(`${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedido.id}&select=estado`, { headers })
    const tareas = (await tareasRes.json()) as Array<{ estado: string }>
    expect(tareas.every(t => t.estado === 'cancelada'), '[107] todas las tareas generadas deben quedar canceladas').toBe(true)

    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedido_items?pedido_id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicPicking.id}`, { headers })
  })
})
