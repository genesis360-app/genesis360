/**
 * 179_motor_unico_precio_mutante.spec.ts
 * E2E — B2 / Fase 3: MOTOR ÚNICO de precio (mig 467, `fn_precios_lineas`). REGLA #0, plata.
 *
 * 1. Sin respuesta del motor el POS NO cobra (PL-5 = A): con la RPC cortada aparece el aviso
 *    `pos-precios-error` y el botón de registrar queda deshabilitado; al volver la conexión, se habilita solo.
 * 2. "Actualizar precios" de un presupuesto vencido usa el motor: aplica el mayorista por cantidad (antes tomaba
 *    `precio_venta` crudo e ignoraba el tier) y deja precio, subtotal, IVA y total consistentes en la base.
 *
 * Los specs 54/110/116/123 (tiers en el carrito real, con venta persistida) cubren que el precio que se cobra
 * desde el servidor es el mismo de antes. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, irAlPOS, agregarPrimerProductoAlCarrito, visible,
} from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('Motor único de precio (mig 467)', () => {
  test('sin respuesta del motor no se puede registrar la venta; vuelve sola al reconectar', async ({ page }) => {
    test.setTimeout(90000)
    await irAlPOS(page)

    // Cortar el motor ANTES de agregar el producto.
    await page.route('**/rest/v1/rpc/fn_precios_lineas', route => route.abort('internetdisconnected'))
    await agregarPrimerProductoAlCarrito(page)

    const aviso = page.getByTestId('pos-precios-error')
    await expect(aviso).toBeVisible({ timeout: 20000 })
    await expect(aviso).toContainText(/Sin conexión con el servidor/i)
    await expect(page.getByTestId('pos-registrar-venta')).toBeDisabled()

    // Vuelve la conexión: un cambio en el carrito (agregar otra unidad) dispara la consulta y el botón se habilita.
    await page.unroute('**/rest/v1/rpc/fn_precios_lineas')
    const respuesta = page.waitForResponse(r => r.url().includes('/rpc/fn_precios_lineas') && r.ok(), { timeout: 20000 })
    await agregarPrimerProductoAlCarrito(page)
    await respuesta
    await expect(aviso).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('pos-registrar-venta')).toBeEnabled({ timeout: 15000 })
  })

  test('"Actualizar precios" de un presupuesto aplica el mayorista del motor', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const LISTA = 1013
    const PCT = 10
    const CANT = 7
    const PRECIO_TIER = Math.round(LISTA * (1 - PCT / 100) * 100) / 100   // 911,70
    const TOTAL_VIEJO = LISTA * CANT                                       // 7.091 (distintivo en la lista)
    const TOTAL_NUEVO = Math.round(PRECIO_TIER * CANT * 100) / 100         // 6.381,90

    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const [{ tenant_id: tenantId, precio_redondeo: redondeo, presupuesto_validez_dias: validez }] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/tenants?select=tenant_id:id,precio_redondeo,presupuesto_validez_dias&limit=1`, { headers })).json()
    test.skip(!!redondeo && redondeo !== 'none', 'El tenant de prueba tiene redondeo: los montos esperados no aplican.')
    test.skip(!validez, 'El tenant no tiene validez de presupuesto configurada.')

    const [producto] = await (await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: `E2E Motor179 ${ts}`, sku: `E2E-179-${ts}`, precio_costo: 500,
        precio_venta: LISTA, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })).json()
    expect(producto?.id, 'no se pudo crear el producto').toBeTruthy()
    const tier = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, cantidad_minima: 5, precio: PCT, tipo_valor: 'pct' },
    })
    expect(tier.ok(), `no se pudo crear el tier: ${await tier.text()}`).toBe(true)

    // Presupuesto viejo (precio de lista, sin tier) y vencido.
    const hace = new Date(Date.now() - (Number(validez) + 10) * 86_400_000).toISOString()
    const ventaId = crypto.randomUUID()
    const v = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers, data: {
        id: ventaId, tenant_id: tenantId, sucursal_id: NORTE, estado: 'pendiente', consumidor_final: true,
        subtotal: TOTAL_VIEJO, total: TOTAL_VIEJO, created_at: hace, updated_at: hace, origen: 'POS',
      },
    })
    expect(v.ok(), `no se pudo crear el presupuesto: ${await v.text()}`).toBe(true)
    const it = await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
      headers, data: {
        tenant_id: tenantId, venta_id: ventaId, producto_id: producto.id, cantidad: CANT, precio_unitario: LISTA,
        subtotal: TOTAL_VIEJO, alicuota_iva: 21, iva_monto: Math.round((TOTAL_VIEJO - TOTAL_VIEJO / 1.21) * 100) / 100,
      },
    })
    expect(it.ok(), `no se pudo crear la línea: ${await it.text()}`).toBe(true)
    // El trigger de updated_at puede haberlo pisado al insertar la línea: lo volvemos a envejecer.
    await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}`, { headers, data: { updated_at: hace } })

    await goto(page, '/ventas')
    await waitForApp(page)
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los estados/ }) }).first()
      .selectOption('pendiente')
    const fila = page.locator('div.divide-y > div').filter({ hasText: /7\.091/ }).first()
    expect(await visible(fila, 10000), 'el presupuesto sembrado no aparece en el historial').toBe(true)
    await fila.click()

    // Vencido muestra "Actualizar precios ahora"; si no, "Actualizar presupuesto (precios + validez)": la misma función.
    await page.getByRole('button', { name: /Actualizar (precios|presupuesto)/ }).first().click()
    await expect(page.getByText(/Precios actualizados/i).first()).toBeVisible({ timeout: 15000 })

    const [linea] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${ventaId}&select=precio_unitario,subtotal,iva_monto,ventas(total)`, { headers })).json()
    expect(Number(linea.precio_unitario), 'precio con el 10 % del mayorista (antes quedaba en lista)').toBeCloseTo(PRECIO_TIER, 2)
    expect(Number(linea.subtotal)).toBeCloseTo(TOTAL_NUEVO, 2)
    expect(Number(linea.iva_monto)).toBeCloseTo(Math.round((TOTAL_NUEVO - TOTAL_NUEVO / 1.21) * 100) / 100, 2)
    expect(Number(linea.ventas.total)).toBeCloseTo(TOTAL_NUEVO, 2)

    // Limpieza (presupuesto no movió stock ni caja).
    await request.delete(`${SUPABASE_URL}/rest/v1/venta_items?venta_id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista?producto_id=eq.${producto.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, { headers })
  })
})
