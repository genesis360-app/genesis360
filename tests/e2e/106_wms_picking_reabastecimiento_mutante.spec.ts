/**
 * 106_wms_picking_reabastecimiento_mutante.spec.ts
 * E2E MUTANTE — Módulo WMS: Zonas + tareas de picking + reabastecimiento (migs 289-290).
 *
 * Decisión de arquitectura (confirmada con GO 2026-07-22): el picking es una capa de
 * LOGÍSTICA PURA — nunca decide qué LPN consume una venta ni cuándo se rebaja (eso lo sigue
 * haciendo el motor de ventas exactamente igual). Genera tareas leyendo la decisión YA
 * TOMADA por la venta (venta_item_despachos) y, si el LPN vive fuera de una zona de picking,
 * encadena un reabastecimiento que ejecuta la MISMA operación que ya existe en
 * LpnAccionesModal → Mover (reduce el LPN origen, crea uno nuevo en destino).
 *
 * Genera su propia precondición 100% vía REST (con el token real del usuario, respeta RLS):
 * producto + 2 ubicaciones (picking/bulk) + LPN en bulk + venta despachada con
 * venta_item_despachos apuntando a ese LPN + envío. No pasa por el flujo completo del POS
 * (sería un spec aparte) — lo que está bajo prueba acá es /picking y las RPCs de la mig 290.
 *
 * Verifica en DB real (no solo UI): el reabastecimiento decrementa el LPN origen y crea uno
 * nuevo en la ubicación de picking con la cantidad exacta (sin pérdida ni duplicación), y el
 * picking queda bloqueado hasta que el reabastecimiento se completa.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('WMS — Picking y reabastecimiento (mutante)', () => {
  test('reabastecer bulk→picking mueve stock real, y el picking queda bloqueado hasta completarlo', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const skuProd = `E2E-WMS-${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // tenant_id propio: cualquier fila que la RLS ya scopea a mi tenant
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[106] no se encontró sucursal para inferir tenant_id').toBeTruthy()
    const tenantId = suc.tenant_id

    // 1) Producto de prueba
    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E WMS Picking ${ts}`, sku: skuProd,
        precio_costo: 100, precio_venta: 200, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[106] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    // 2) Ubicaciones picking + bulk (globales, sin sucursal_id — para no depender de cuál esté activa)
    const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers, data: [
        { tenant_id: tenantId, nombre: `E2E Picking ${ts}`, tipo_ubicacion: 'picking', activo: true },
        { tenant_id: tenantId, nombre: `E2E Bulk ${ts}`, tipo_ubicacion: 'bulk', activo: true },
      ],
    })
    expect(ubicRes.ok(), `[106] no se pudieron crear las ubicaciones: ${await ubicRes.text()}`).toBe(true)
    const ubics = (await ubicRes.json()) as Array<{ id: string; nombre: string }>
    const ubicPicking = ubics.find(u => u.nombre.startsWith('E2E Picking'))!
    const ubicBulk = ubics.find(u => u.nombre.startsWith('E2E Bulk'))!

    // 3) Stock real en bulk (20 unidades)
    const lpnBulk = `LPN-E2E-${ts}`
    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn: lpnBulk, cantidad: 20, ubicacion_id: ubicBulk.id, activo: true },
    })
    expect(lineaRes.ok(), `[106] no se pudo crear el LPN en bulk: ${await lineaRes.text()}`).toBe(true)

    // 4) Venta despachada + venta_item + venta_item_despachos apuntando al LPN de bulk
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

    const despachoRes = await request.post(`${SUPABASE_URL}/rest/v1/venta_item_despachos`, {
      headers, data: {
        tenant_id: tenantId, venta_id: venta.id, venta_item_id: ventaItem.id, producto_id: producto.id,
        lpn: lpnBulk, ubicacion_id: ubicBulk.id, ubicacion_nombre: ubicBulk.nombre, cantidad: 5, origen: 'auto',
      },
    })
    expect(despachoRes.ok(), `[106] no se pudo crear venta_item_despachos: ${await despachoRes.text()}`).toBe(true)

    // 5) Envío para esa venta
    const envioRes = await request.post(`${SUPABASE_URL}/rest/v1/envios`, {
      headers, data: { tenant_id: tenantId, venta_id: venta.id, estado: 'pendiente' },
    })
    expect(envioRes.ok(), `[106] no se pudo crear el envío: ${await envioRes.text()}`).toBe(true)
    const [envio] = (await envioRes.json()) as Array<{ id: string }>

    // 6) Generar las tareas (misma RPC que dispararía el flujo real de preparar el envío)
    const genRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_envio`, {
      headers, data: { p_envio_id: envio.id },
    })
    expect(genRes.ok(), `[106] fn_generar_tareas_picking_envio falló: ${await genRes.text()}`).toBe(true)
    const tareasGeneradas = await genRes.json() as Array<{ tarea_id: string; tipo: string }>
    expect(tareasGeneradas).toHaveLength(2)
    expect(tareasGeneradas.map(t => t.tipo).sort()).toEqual(['picking', 'replenishment'])
    const tareaReabId = tareasGeneradas.find(t => t.tipo === 'replenishment')!.tarea_id
    const tareaPickId = tareasGeneradas.find(t => t.tipo === 'picking')!.tarea_id

    // 7) UI real: /picking muestra ambas tareas (scopeado por data-testid — puede haber otras
    // tareas WMS de otros tests/uso real del tenant en la misma pantalla)
    await goto(page, '/picking')
    await waitForApp(page)
    const cardReab = page.getByTestId(`tarea-${tareaReabId}`)
    const cardPicking = page.getByTestId(`tarea-${tareaPickId}`)
    await expect(cardReab).toBeVisible({ timeout: 10000 })
    await expect(cardPicking).toBeVisible()
    await expect(cardReab.getByText('Reabastecimiento', { exact: true })).toBeVisible()
    await expect(cardPicking.getByText('Esperando que se complete el reabastecimiento')).toBeVisible()

    // El picking está bloqueado: el botón debe estar deshabilitado
    const btnPicking = cardPicking.getByRole('button', { name: /Confirmar retiro/ })
    await expect(btnPicking).toBeDisabled()

    // 8) Completar el reabastecimiento desde la UI real
    await cardReab.getByRole('button', { name: /Confirmar reabastecimiento/ }).click()
    await expect(cardReab).not.toBeVisible({ timeout: 10000 }) // sale de la lista (ya no está pendiente/en_curso)
    await expect(cardPicking.getByText('Esperando que se complete el reabastecimiento')).not.toBeVisible()

    // 9) POSITIVO en DB: el LPN de bulk se redujo (20→15) y hay un LPN nuevo en picking con 5u
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
    expect(destinoLinea?.ubicacion_id).toBe(ubicPicking.id)

    // 10) Ahora el picking se puede completar
    await expect(btnPicking).toBeEnabled({ timeout: 5000 })
    await btnPicking.click()
    await expect(page.getByText('E2E WMS Picking ' + ts)).toHaveCount(0, { timeout: 10000 })

    // 11) POSITIVO en DB: ambas tareas completadas
    const tareasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}&select=tipo,estado`, { headers },
    )
    const tareasFinal = (await tareasRes.json()) as Array<{ tipo: string; estado: string }>
    expect(tareasFinal).toHaveLength(2)
    expect(tareasFinal.every(t => t.estado === 'completada'), '[106] las 2 tareas deberían quedar completadas').toBe(true)

    // Limpieza — no dejar tareas WMS de prueba pobladas en la pantalla real de /picking
    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?envio_id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/envios?id=eq.${envio.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_item_despachos?venta_id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicPicking.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicBulk.id}`, { headers })
  })
})
