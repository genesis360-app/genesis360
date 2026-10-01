/**
 * 160_usd_sin_cotizacion_y_pedido_usd_mutante.spec.ts
 * E2E MUTANTE — D-1 fase 2 (mig 440, 2026-09-26): la UNA tasa USD→ARS en los dos caminos que el UAT §70
 * había dejado sin test (70.5 y 70.9). REGLA #0: son caminos de plata.
 *
 * A (70.9) — Pedidos → venta con un producto en USD. `fn_precio_venta_efectivo` tiene que cotizarlo como
 *   `precio_usd × tasa vigente` (antes tomaba `precio_venta`, el espejo en pesos congelado) y
 *   `fn_pedido_generar_venta` tiene que sellar `ventas.cotizacion_usd` con esa tasa. Control anti-vacío:
 *   el mismo circuito con un producto en PESOS deja `cotizacion_usd` en NULL — si no, el sello no
 *   distinguiría nada. El `precio_venta` del producto USD se siembra a propósito en un valor absurdo
 *   ($1): si el total sale $1 × cantidad, la función volvió a leer el espejo.
 *
 * B (70.5) — POS sin cotización: un producto en USD NO se agrega al carrito (D5). No se toca la tabla
 *   global `cotizaciones_bna` (la comparten todos los negocios de DEV): se intercepta la red para que la
 *   EF `cotizacion-bna` y la RPC `fn_cotizacion_bna_vigente` respondan "sin cotización". Anti-vacío: el
 *   widget del menú tiene que mostrar "Sin cotización" (prueba que la intercepción llegó a la app).
 *
 * Todo lo que crea se borra; el producto que B marca en USD se restaura en `finally`. Límite conocido
 * (gotcha 11.5 de los e2e): `movimientos_stock` no tiene DELETE para el usuario (ledger inmutable), así
 * que los 2 productos/ubicaciones de A sobreviven al cleanup → limpiar con service_role
 * (`nombre LIKE 'E2E Ped USD %'`, mismo orden que el spec 107).
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, garantizarCajaAbierta, irAlPOS, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

/** Producto + stock en picking + pedido confirmado + lanzado. Devuelve ids para entregar y limpiar. */
async function pedidoLanzado(request: APIRequestContext, headers: H, tenantId: string, tipoId: string, ts: number, sufijo: string, producto: Record<string, unknown>) {
  const creados: { productoId?: string; ubicId?: string; pedidoId?: string; pedidoNumero?: number } = {}
  const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers, data: {
      tenant_id: tenantId, nombre: `E2E Ped USD ${sufijo} ${ts}`, sku: `E2E-PED-USD-${sufijo}-${ts}`,
      precio_costo: 1, unidad_medida: 'unidad', activo: true, alicuota_iva: 21, ...producto,
    },
  })
  expect(prodRes.ok(), `[160] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
  creados.productoId = ((await prodRes.json()) as Array<{ id: string }>)[0].id

  const ubicRes = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
    headers, data: { tenant_id: tenantId, nombre: `E2E Picking USD ${sufijo} ${ts}`, tipo_logico: 'picking', disponible_surtido: true, activo: true },
  })
  expect(ubicRes.ok(), `[160] no se pudo crear la ubicación: ${await ubicRes.text()}`).toBe(true)
  creados.ubicId = ((await ubicRes.json()) as Array<{ id: string }>)[0].id

  const linRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
    headers, data: { tenant_id: tenantId, producto_id: creados.productoId, lpn: `LPN-E2E-USD-${sufijo}-${ts}`, cantidad: 5, ubicacion_id: creados.ubicId, activo: true },
  })
  expect(linRes.ok(), `[160] no se pudo crear el stock: ${await linRes.text()}`).toBe(true)

  const pedRes = await request.post(`${SUPABASE_URL}/rest/v1/pedidos`, {
    headers, data: { tenant_id: tenantId, tipo_pedido_id: tipoId, cliente_nombre: `E2E Cliente USD ${ts}`, estado: 'confirmado' },
  })
  expect(pedRes.ok(), `[160] no se pudo crear el pedido: ${await pedRes.text()}`).toBe(true)
  const [ped] = (await pedRes.json()) as Array<{ id: string; numero: number }>
  creados.pedidoId = ped.id; creados.pedidoNumero = ped.numero

  const itRes = await request.post(`${SUPABASE_URL}/rest/v1/pedido_items`, {
    headers, data: { tenant_id: tenantId, pedido_id: ped.id, producto_id: creados.productoId, cantidad: 2 },
  })
  expect(itRes.ok(), `[160] no se pudo crear el pedido_item: ${await itRes.text()}`).toBe(true)

  const lanzarRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, { headers, data: { p_pedido_id: ped.id } })
  expect(lanzarRes.ok(), `[160] fn_generar_tareas_picking_pedido falló: ${await lanzarRes.text()}`).toBe(true)
  return creados
}

async function limpiar(request: APIRequestContext, headers: H, c: { productoId?: string; ubicId?: string; pedidoId?: string; pedidoNumero?: number }, ventaId: string | null, sesionId: string | null) {
  if (ventaId) {
    if (sesionId && c.pedidoNumero != null) await request.delete(`${SUPABASE_URL}/rest/v1/caja_movimientos?sesion_id=eq.${sesionId}&concepto=eq.Pedido%20%23${c.pedidoNumero}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/movimientos_stock?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_item_despachos?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}`, { headers })
  }
  if (c.pedidoId) {
    await request.delete(`${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${c.pedidoId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedido_items?pedido_id=eq.${c.pedidoId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${c.pedidoId}`, { headers })
  }
  if (c.productoId) {
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${c.productoId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${c.productoId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${c.productoId}`, { headers })
  }
  if (c.ubicId) await request.delete(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${c.ubicId}`, { headers })
}

test.describe('D-1 fase 2 — USD sin cotización y pedidos en USD (mutante)', () => {
  test('70.9 — un pedido con producto en USD se vende a precio_usd × tasa BNA y la venta queda sellada; uno en pesos no', async ({ page, request }) => {
    test.setTimeout(120_000)
    const ts = Date.now()
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    const [suc] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
    const tenantId = suc.tenant_id
    const [tipo] = (await (await request.get(`${SUPABASE_URL}/rest/v1/tipos_pedido?tenant_id=eq.${tenantId}&select=id&limit=1`, { headers })).json()) as Array<{ id: string }>
    expect(tipo, '[160] no hay tipo_pedido sembrado').toBeTruthy()

    const [tn] = (await (await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=precio_redondeo`, { headers })).json()) as Array<{ precio_redondeo: string | null }>
    test.skip(!!tn?.precio_redondeo && tn.precio_redondeo !== 'none', `[160] el tenant redondea precios (${tn?.precio_redondeo}): el total exacto no es comparable`)

    const cotRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cotizacion_bna_vigente`, { headers, data: { p_moneda: 'USD' } })
    const tasa = parseFloat(String((await cotRes.json())?.[0]?.venta ?? 0))
    expect(tasa > 1, `[160] sin cotización BNA vigente (${tasa}) — el test no mide nada`).toBe(true)

    await garantizarCajaAbierta(page, { caja: 'Caja1' })
    const [sesion] = (await (await request.get(`${SUPABASE_URL}/rest/v1/caja_sesiones?tenant_id=eq.${tenantId}&estado=eq.abierta&select=id&limit=1`, { headers })).json()) as Array<{ id: string }>
    expect(sesion, '[160] no hay caja abierta').toBeTruthy()

    const entregar = async (pedidoId: string) => {
      const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_generar_venta`, {
        headers, data: { p_pedido_id: pedidoId, p_sesion_caja_id: sesion.id, p_medio_pago: [{ tipo: 'Efectivo', monto: null }] },
      })
      expect(r.ok(), `[160] fn_pedido_generar_venta falló: ${await r.text()}`).toBe(true)
      return (await r.json()) as string
    }

    // ── USD: precio_usd 10; precio_venta sembrado en $1 a propósito (el espejo "congelado") ──
    let usd: Awaited<ReturnType<typeof pedidoLanzado>> = {}
    let ventaUsd: string | null = null
    let ars: Awaited<ReturnType<typeof pedidoLanzado>> = {}
    let ventaArs: string | null = null
    try {
      usd = await pedidoLanzado(request, headers, tenantId, tipo.id, ts, 'U', { moneda_venta: 'usd', precio_usd: 10, precio_venta: 1 })
      ventaUsd = await entregar(usd.pedidoId!)
      const [v] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaUsd}&select=total,cotizacion_usd`, { headers })).json()) as Array<{ total: string; cotizacion_usd: string | null }>
      const esperado = Math.round(10 * tasa * 100) / 100 * 2
      expect(Number(v.total), `[160] 2 × USD 10 × ${tasa} — si da 2, volvió a leer el precio_venta congelado`).toBeCloseTo(esperado, 2)
      expect(Number(v.cotizacion_usd), '[160] la venta con producto USD tiene que quedar sellada con la tasa usada').toBeCloseTo(tasa, 2)

      // ── Control anti-vacío: mismo circuito, producto en PESOS → sin sello ──
      ars = await pedidoLanzado(request, headers, tenantId, tipo.id, ts, 'A', { precio_venta: 500 })
      ventaArs = await entregar(ars.pedidoId!)
      const [va] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaArs}&select=total,cotizacion_usd`, { headers })).json()) as Array<{ total: string; cotizacion_usd: string | null }>
      expect(Number(va.total)).toBe(1000)
      expect(va.cotizacion_usd, '[160] una venta solo en pesos NO se sella con cotización').toBeNull()
    } finally {
      await limpiar(request, headers, usd, ventaUsd, sesion?.id ?? null)
      await limpiar(request, headers, ars, ventaArs, sesion?.id ?? null)
    }
  })

  test('70.5 — sin cotización del dólar, el POS NO agrega un producto con precio en USD (D5)', async ({ page, request }) => {
    test.setTimeout(90_000)
    // Sin cotización para ESTA página, sin tocar la tabla global.
    await page.route('**/functions/v1/cotizacion-bna', r => r.fulfill({ json: { ok: true, capturo: false, captura_ok: false, vigente: null } }))
    await page.route('**/rest/v1/rpc/fn_cotizacion_bna_vigente', r => r.fulfill({ json: [] }))

    await irAlPOS(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    // Anti-vacío: la app realmente se quedó sin cotización.
    await expect(page.getByText('Sin cotización').first(), '[160] el widget no muestra "Sin cotización": la intercepción no llegó').toBeVisible({ timeout: 15000 })

    // Fixture: un producto CON stock (aparece en el buscador) pasado a USD, restaurado al final.
    const [prod] = (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?nombre=eq.Coca%20Cola%201.5L%20Original&select=id,moneda_venta,precio_usd&limit=1`, { headers })).json()) as Array<{ id: string; moneda_venta: string; precio_usd: string | null }>
    test.skip(!prod, '[160] producto "Coca Cola 1.5L Original" no disponible en el tenant')
    const patch = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, { headers, data: { moneda_venta: 'usd', precio_usd: 10 } })
    expect(patch.ok(), `[160] no se pudo marcar el producto en USD: ${await patch.text()}`).toBe(true)
    try {
      const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
      await buscador.fill('Coca Cola 1.5L')
      const item = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /Coca Cola 1\.5L/i }).first()
      await expect(item).toBeVisible({ timeout: 15000 })
      await item.click()

      // POSITIVO: el aviso de D5, y el carrito sigue vacío.
      await expect(page.getByText(/tiene precio en dólares y no hay cotización del dólar BNA/i).first()).toBeVisible({ timeout: 8000 })
      await expect(page.getByText(/Precio USD/i)).toHaveCount(0)
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, { headers, data: { moneda_venta: prod.moneda_venta, precio_usd: prod.precio_usd } })
    }
  })
})
