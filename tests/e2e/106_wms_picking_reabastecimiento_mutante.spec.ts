/**
 * 106_wms_picking_reabastecimiento_mutante.spec.ts
 * E2E MUTANTE — Módulo WMS: Zonas + tareas de picking + reabastecimiento (migs 289-291).
 *
 * Decisión de arquitectura (confirmada con GO 2026-07-22): el picking es una capa de
 * LOGÍSTICA PURA — nunca decide qué LPN consume una venta ni cuándo se rebaja (eso lo sigue
 * haciendo el motor de ventas exactamente igual). Genera tareas leyendo la decisión YA
 * TOMADA por la venta.
 *
 * mig 291 (mismo día, tras pruebas manuales de GO contra datos reales — tenant Almacén
 * Jorgito, venta #395/envío #44) separó el comportamiento según la fuente de esa decisión:
 * - Fuente 1 (venta_item_despachos — venta YA despachada, el rebaje real YA ocurrió y el LPN
 *   que la cumple ya quedó fijado en el ledger): la tarea de picking es 100% bookkeeping,
 *   NUNCA encadena reabastecimiento — reubicar ese LPN crearía uno nuevo desvinculado del
 *   ledger (rompe trazabilidad por unidad) sin tocar el stock neto. Test A cubre esto.
 * - Fuente 2 (venta_items.lpn_plan — reserva todavía no despachada, nada se consumió): acá
 *   SÍ tiene sentido preparar el stock antes del retiro, encadena reabastecimiento igual que
 *   antes de la mig 291 (ejecuta la MISMA operación que ya existe en LpnAccionesModal →
 *   Mover: reduce el LPN origen, crea uno nuevo en destino). Test B cubre esto.
 *
 * Ambos generan su propia precondición 100% vía REST (con el token real del usuario, respeta
 * RLS). No pasan por el flujo completo del POS (sería un spec aparte) — lo que está bajo
 * prueba acá es /picking y las RPCs de la mig 290/291.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('WMS — Picking y reabastecimiento (mutante)', () => {
  test('Fuente 1 — venta ya despachada: picking directo, NUNCA reabastecimiento, cero movimiento de stock', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const skuProd = `E2E-WMS-F1-${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[106] no se encontró sucursal para inferir tenant_id').toBeTruthy()
    const tenantId = suc.tenant_id

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E WMS F1 ${ts}`, sku: skuProd,
        precio_costo: 100, precio_venta: 200, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[106] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    // Ubicación tipo bulk (no picking) — para probar que NO se encadena reabastecimiento
    // aunque el LPN esté fuera de zona de picking, porque la venta ya está despachada.
    const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers, data: { tenant_id: tenantId, nombre: `E2E Bulk F1 ${ts}`, tipo_logico: 'almacenamiento', subtipo_almacenamiento: 'bulk', activo: true },
    })
    expect(ubicRes.ok(), `[106] no se pudo crear la ubicación: ${await ubicRes.text()}`).toBe(true)
    const [ubicBulk] = (await ubicRes.json()) as Array<{ id: string; nombre: string }>

    const lpnBulk = `LPN-E2E-F1-${ts}`
    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn: lpnBulk, cantidad: 20, ubicacion_id: ubicBulk.id, activo: true },
    })
    expect(lineaRes.ok(), `[106] no se pudo crear el LPN en bulk: ${await lineaRes.text()}`).toBe(true)

    const ventaRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers, data: { tenant_id: tenantId, estado: 'despachada', subtotal: 1000, total: 1000, medio_pago: '[{"tipo":"Efectivo","monto":1000}]' },
    })
    expect(ventaRes.ok(), `[106] no se pudo crear la venta: ${await ventaRes.text()}`).toBe(true)
    const [venta] = (await ventaRes.json()) as Array<{ id: string }>

    const itemRes = await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
      headers, data: { tenant_id: tenantId, venta_id: venta.id, producto_id: producto.id, cantidad: 5, precio_unitario: 200, subtotal: 1000 },
    })
    expect(itemRes.ok(), `[106] no se pudo crear el venta_item: ${await itemRes.text()}`).toBe(true)
    const [ventaItem] = (await itemRes.json()) as Array<{ id: string }>

    // El rebaje REAL ya ocurrió (esto es lo que haría registrarVenta en VentasPage.tsx) — el
    // ledger ya fijó qué LPN cumple la venta.
    const despachoRes = await request.post(`${SUPABASE_URL}/rest/v1/venta_item_despachos`, {
      headers, data: {
        tenant_id: tenantId, venta_id: venta.id, venta_item_id: ventaItem.id, producto_id: producto.id,
        lpn: lpnBulk, ubicacion_id: ubicBulk.id, ubicacion_nombre: ubicBulk.nombre, cantidad: 5, origen: 'auto',
      },
    })
    expect(despachoRes.ok(), `[106] no se pudo crear venta_item_despachos: ${await despachoRes.text()}`).toBe(true)

    const envioRes = await request.post(`${SUPABASE_URL}/rest/v1/envios`, {
      headers, data: { tenant_id: tenantId, venta_id: venta.id, estado: 'pendiente' },
    })
    expect(envioRes.ok(), `[106] no se pudo crear el envío: ${await envioRes.text()}`).toBe(true)
    const [envio] = (await envioRes.json()) as Array<{ id: string }>

    const genRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_envio`, {
      headers, data: { p_envio_id: envio.id },
    })
    expect(genRes.ok(), `[106] fn_generar_tareas_picking_envio falló: ${await genRes.text()}`).toBe(true)
    const tareasGeneradas = await genRes.json() as Array<{ tarea_id: string; tipo: string }>
    // Fix mig 291: Fuente 1 nunca encadena reabastecimiento — 1 sola tarea, no 2.
    expect(tareasGeneradas, '[106] Fuente 1 no debe encadenar reabastecimiento').toHaveLength(1)
    expect(tareasGeneradas[0].tipo).toBe('picking')
    const tareaPickId = tareasGeneradas[0].tarea_id

    await goto(page, '/picking')
    await waitForApp(page)
    const cardPicking = page.getByTestId(`tarea-${tareaPickId}`)
    await expect(cardPicking).toBeVisible({ timeout: 10000 })
    await expect(cardPicking.getByText('Esperando que se complete el reabastecimiento')).toHaveCount(0)

    const btnPicking = cardPicking.getByRole('button', { name: /Confirmar retiro/ })
    await expect(btnPicking).toBeEnabled()
    await btnPicking.click()
    await expect(cardPicking).not.toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: cero movimiento de stock — sigue habiendo un único LPN, sin cambios,
    // y NO se creó ningún LPN nuevo (así se manifestó el bug real: aparecía un LPN nuevo en
    // la zona de picking desvinculado del ledger de la venta).
    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}&select=lpn,cantidad,ubicacion_id,activo`, { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ lpn: string; cantidad: number; ubicacion_id: string; activo: boolean }>
    expect(lineas, '[106] Fuente 1 no debe crear ni modificar ningún LPN').toHaveLength(1)
    expect(lineas[0].lpn).toBe(lpnBulk)
    expect(Number(lineas[0].cantidad)).toBe(20)
    expect(lineas[0].ubicacion_id).toBe(ubicBulk.id)

    const tareasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}&select=tipo,estado`, { headers },
    )
    const tareasFinal = (await tareasRes.json()) as Array<{ tipo: string; estado: string }>
    expect(tareasFinal).toHaveLength(1)
    expect(tareasFinal[0].estado).toBe('completada')

    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/envios?id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_item_despachos?venta_id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicBulk.id}`, { headers })
  })

  test('Fuente 2 — reserva pendiente de despacho: reabastecer bulk→picking mueve stock real, y el picking queda bloqueado hasta completarlo', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const skuProd = `E2E-WMS-F2-${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[106] no se encontró sucursal para inferir tenant_id').toBeTruthy()
    const tenantId = suc.tenant_id

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E WMS F2 ${ts}`, sku: skuProd,
        precio_costo: 100, precio_venta: 200, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[106] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers, data: [
        { tenant_id: tenantId, nombre: `E2E Picking F2 ${ts}`, tipo_logico: 'picking', subtipo_almacenamiento: null, disponible_surtido: true, activo: true },
        { tenant_id: tenantId, nombre: `E2E Bulk F2 ${ts}`, tipo_logico: 'almacenamiento', subtipo_almacenamiento: 'bulk', disponible_surtido: false, activo: true },
      ],
    })
    expect(ubicRes.ok(), `[106] no se pudieron crear las ubicaciones: ${await ubicRes.text()}`).toBe(true)
    const ubics = (await ubicRes.json()) as Array<{ id: string; nombre: string }>
    const ubicPicking = ubics.find(u => u.nombre.startsWith('E2E Picking'))!
    const ubicBulk = ubics.find(u => u.nombre.startsWith('E2E Bulk'))!

    const lpnBulk = `LPN-E2E-F2-${ts}`
    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn: lpnBulk, cantidad: 20, ubicacion_id: ubicBulk.id, activo: true },
    })
    expect(lineaRes.ok(), `[106] no se pudo crear el LPN en bulk: ${await lineaRes.text()}`).toBe(true)
    const [linea] = (await lineaRes.json()) as Array<{ id: string }>

    // Venta RESERVADA (todavía nada se consumió) — el plan queda en venta_items.lpn_plan,
    // no hay venta_item_despachos.
    const ventaRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers, data: { tenant_id: tenantId, estado: 'reservada', subtotal: 1000, total: 1000 },
    })
    expect(ventaRes.ok(), `[106] no se pudo crear la venta: ${await ventaRes.text()}`).toBe(true)
    const [venta] = (await ventaRes.json()) as Array<{ id: string }>

    const itemRes = await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
      headers, data: {
        tenant_id: tenantId, venta_id: venta.id, producto_id: producto.id, cantidad: 5, precio_unitario: 200, subtotal: 1000,
        lpn_plan: [{ linea_id: linea.id, lpn: lpnBulk, cantidad: 5 }],
      },
    })
    expect(itemRes.ok(), `[106] no se pudo crear el venta_item: ${await itemRes.text()}`).toBe(true)

    const envioRes = await request.post(`${SUPABASE_URL}/rest/v1/envios`, {
      headers, data: { tenant_id: tenantId, venta_id: venta.id, estado: 'pendiente' },
    })
    expect(envioRes.ok(), `[106] no se pudo crear el envío: ${await envioRes.text()}`).toBe(true)
    const [envio] = (await envioRes.json()) as Array<{ id: string }>

    const genRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_envio`, {
      headers, data: { p_envio_id: envio.id },
    })
    expect(genRes.ok(), `[106] fn_generar_tareas_picking_envio falló: ${await genRes.text()}`).toBe(true)
    const tareasGeneradas = await genRes.json() as Array<{ tarea_id: string; tipo: string }>
    expect(tareasGeneradas).toHaveLength(2)
    expect(tareasGeneradas.map(t => t.tipo).sort()).toEqual(['picking', 'replenishment'])
    const tareaReabId = tareasGeneradas.find(t => t.tipo === 'replenishment')!.tarea_id
    const tareaPickId = tareasGeneradas.find(t => t.tipo === 'picking')!.tarea_id

    await goto(page, '/picking')
    await waitForApp(page)
    const cardReab = page.getByTestId(`tarea-${tareaReabId}`)
    const cardPicking = page.getByTestId(`tarea-${tareaPickId}`)
    await expect(cardReab).toBeVisible({ timeout: 10000 })
    await expect(cardPicking).toBeVisible()
    await expect(cardReab.getByText('Reabastecimiento', { exact: true })).toBeVisible()
    await expect(cardPicking.getByText('Esperando que se complete el reabastecimiento')).toBeVisible()

    const btnPicking = cardPicking.getByRole('button', { name: /Confirmar retiro/ })
    await expect(btnPicking).toBeDisabled()

    await cardReab.getByRole('button', { name: /Confirmar reabastecimiento/ }).click()
    await expect(cardReab).not.toBeVisible({ timeout: 10000 })
    await expect(cardPicking.getByText('Esperando que se complete el reabastecimiento')).not.toBeVisible()

    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}&select=lpn,cantidad,ubicacion_id,activo`, { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ lpn: string; cantidad: number; ubicacion_id: string; activo: boolean }>
    expect(lineas).toHaveLength(2)
    const origenLinea = lineas.find(l => l.lpn === lpnBulk)
    const destinoLinea = lineas.find(l => l.lpn !== lpnBulk)
    expect(Number(origenLinea?.cantidad), '[106] el LPN de bulk debería haber quedado en 15 (20-5)').toBe(15)
    expect(origenLinea?.ubicacion_id).toBe(ubicBulk.id)
    expect(Number(destinoLinea?.cantidad), '[106] el LPN nuevo en picking debería tener las 5 unidades movidas').toBe(5)

    // 🛑 El invariante real es que el stock aterrice EXACTAMENTE donde la tarea dijo que iba a
    // aterrizar (`wms_tareas.ubicacion_destino_id`), y que esa ubicación sea de picking. NO se
    // puede exigir que sea la ubicación que creó este spec: cuál se elige lo decide
    // `fn_wms_elegir_ubicacion_picking` entre TODAS las de picking del tenant (prefiere una que
    // ya tenga el producto, después secuencia/prioridad), así que con más de una cargada en el
    // tenant —cosa normal— la elegida puede ser otra y el reabastecimiento sigue siendo correcto.
    const tareaReabRes = await request.get(
      `${SUPABASE_URL}/rest/v1/wms_tareas?id=eq.${tareaReabId}&select=ubicacion_destino_id`, { headers },
    )
    const [tareaReab] = (await tareaReabRes.json()) as Array<{ ubicacion_destino_id: string }>
    expect(destinoLinea?.ubicacion_id,
      '[106] el stock reabastecido tiene que quedar en la ubicación destino declarada por la tarea')
      .toBe(tareaReab.ubicacion_destino_id)

    const ubicDestRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${tareaReab.ubicacion_destino_id}&select=tipo_logico`, { headers },
    )
    const [ubicDest] = (await ubicDestRes.json()) as Array<{ tipo_logico: string }>
    expect(ubicDest?.tipo_logico, '[106] el destino del reabastecimiento tiene que ser zona de picking').toBe('picking')

    await expect(btnPicking).toBeEnabled({ timeout: 5000 })
    await btnPicking.click()
    await expect(page.getByText('E2E WMS F2 ' + ts)).toHaveCount(0, { timeout: 10000 })

    const tareasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}&select=tipo,estado`, { headers },
    )
    const tareasFinal = (await tareasRes.json()) as Array<{ tipo: string; estado: string }>
    expect(tareasFinal).toHaveLength(2)
    expect(tareasFinal.every(t => t.estado === 'completada'), '[106] las 2 tareas deberían quedar completadas').toBe(true)

    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/envios?id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicPicking.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicBulk.id}`, { headers })
  })
})
