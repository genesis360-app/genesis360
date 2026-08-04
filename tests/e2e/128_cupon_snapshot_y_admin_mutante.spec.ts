/**
 * 128_cupon_snapshot_y_admin_mutante.spec.ts
 * E2E MUTANTE — CUPON-09, 10: snapshot histórico (REGLA #0 — nunca reescribir histórico fiscal) y
 * el reporting de campaña ("usados/generado") del módulo Comercial.
 *
 * CUPON-09 — una venta YA CONFIRMADA con `cupon_monto` guardado sigue mostrando ese monto original
 *   aunque DESPUÉS se cambie el `monto` de la campaña o se la desactive: no hay ningún join/recompute
 *   que vuelva a leer `cupones.monto` para una venta pasada — es un snapshot real, no un valor
 *   derivado en caliente.
 * CUPON-10 — una campaña nueva creada desde `ComercialPage` (10 códigos, $500, vigente) donde se
 *   canjea 1 código en una venta real → el historial de la campaña muestra "1/10 usados · $500
 *   generado" (`usados × monto`).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito,
} from './helpers/fixtures'

async function tenantId(request: any, token: string): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/users?select=tenant_id&id=eq.${JSON.parse(atob(token.split('.')[1])).sub}`,
    { headers: restHeaders(token) },
  )
  const rows = await res.json()
  expect(rows.length, '[128] no se pudo resolver el tenant del usuario e2e').toBeGreaterThan(0)
  return rows[0].tenant_id
}

/** Aplica un código de cupón ya visible en el carrito y cierra la venta en Efectivo. */
async function venderConCupon(page: any, opts: { codigo: string; montoAPagar: number }) {
  const cuponInput = page.getByPlaceholder('Código de cupón')
  await expect(cuponInput).toBeVisible({ timeout: 8000 })
  await cuponInput.fill(opts.codigo)
  await page.getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText(new RegExp(`\\(${opts.codigo}\\)`))).toBeVisible({ timeout: 6000 })
  await expect(page.getByText(/🎟 Cupón/)).toBeVisible({ timeout: 6000 })

  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll((o: HTMLOptionElement[]) => o.map(x => x.value).filter(Boolean))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  // SIN anclas ^$: si algún otro spec dejó una promo configurada en Efectivo, la opción se etiqueta
  // "Efectivo · 🏷 X% off" — un regex exacto cuelga el .selectOption() (mismo criterio que el spec 98).
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Efectivo/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const montoInput = page.getByPlaceholder(/^Monto$/i).first()
  await montoInput.fill(String(Math.ceil(opts.montoAPagar) + 1000))
  await montoInput.blur()
  await page.waitForTimeout(300)

  const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
  await expect(finalizar).toBeEnabled({ timeout: 5000 })
  await finalizar.click()
  await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
}

test.describe('Cupones — snapshot histórico y reporting de campaña (mutante)', () => {
  test('una venta confirmada preserva su cupon_monto aunque la campaña cambie después (CUPON-09)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Cupon128 Snapshot ${ts}`
    const PRECIO = 5000
    const MONTO_CUPON = 500
    const CODIGO = `E2E128S${ts}`.slice(0, 16).toUpperCase()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const tid = await tenantId(request, token)

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tid, nombre: `E2E Disponible128S ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[128] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tid, nombre: nombreProducto, sku: `E2E-128S-${ts}`,
        precio_costo: PRECIO * 0.6, precio_venta: PRECIO, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[128] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const cuponRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
      headers, data: {
        tenant_id: tid, nombre: `E2E Cupón Snapshot 128 ${ts}`, monto: MONTO_CUPON,
        vigencia_desde: '2020-01-01', vigencia_hasta: '2099-12-31', activo: true,
      },
    })
    expect(cuponRes.ok(), `[128] no se pudo crear el cupón: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    const codigoRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
      headers, data: { tenant_id: tid, cupon_id: cupon.id, codigo: CODIGO },
    })
    expect(codigoRes.ok(), `[128] no se pudo crear el código: ${await codigoRes.text()}`).toBe(true)

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 5, estadoNombre: estadoVenta.nombre })
    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    const totalEsperado = PRECIO - MONTO_CUPON
    await venderConCupon(page, { codigo: CODIGO, montoAPagar: totalEsperado })

    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=ventas(id,total,cupon_monto)&order=created_at.desc&limit=1`,
      { headers })
    expect(itemsRes.ok(), `[128] no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{ ventas: { id: string; total: number; cupon_monto: number | null } }>
    expect(item, '[128] no se encontró el venta_item recién creado').toBeTruthy()
    const ventaId = item.ventas.id
    expect(item.ventas.cupon_monto, '[128] cupon_monto debía quedar guardado con el monto de ese momento').toBeCloseTo(MONTO_CUPON, 1)
    expect(item.ventas.total, `[128] ventas.total esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)

    // Cambiar la CAMPAÑA después de la venta: otro monto y desactivada.
    const patchCupon = await request.patch(`${SUPABASE_URL}/rest/v1/cupones?id=eq.${cupon.id}`, {
      headers, data: { monto: 999999, activo: false },
    })
    expect(patchCupon.ok(), `[128] no se pudo mutar la campaña después de la venta: ${await patchCupon.text()}`).toBe(true)

    // 🛑 POSITIVO: la venta HISTÓRICA sigue mostrando el cupon_monto/total ORIGINALES — nadie
    // recalcula contra `cupones.monto` actual.
    const ventaPostRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=cupon_monto,total`, { headers })
    expect(ventaPostRes.ok(), `[128] no se pudo releer la venta: ${await ventaPostRes.text()}`).toBe(true)
    const [ventaPost] = (await ventaPostRes.json()) as Array<{ cupon_monto: number | null; total: number }>
    expect(
      ventaPost.cupon_monto,
      '🛑 [128] CUPON-09: cupon_monto de la venta histórica cambió cuando se mutó la campaña — se está reescribiendo histórico fiscal (REGLA #0)',
    ).toBeCloseTo(MONTO_CUPON, 1)
    expect(
      ventaPost.total,
      '🛑 [128] CUPON-09: ventas.total de la venta histórica cambió cuando se mutó la campaña',
    ).toBeCloseTo(totalEsperado, 1)
  })

  test('campaña nueva creada desde ComercialPage: tras canjear 1 código muestra "1/10 usados · $500 generado" (CUPON-10)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Cupon128 Reporting ${ts}`
    const nombreCampaña = `E2E Campaña128 ${ts}`
    const PRECIO = 1000
    const MONTO_CUPON = 500

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const tid = await tenantId(request, token)

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tid, nombre: `E2E Disponible128R ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[128] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tid, nombre: nombreProducto, sku: `E2E-128R-${ts}`,
        precio_costo: PRECIO * 0.6, precio_venta: PRECIO, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[128] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)

    // ── Campaña de cupón creada desde la UI real de ComercialPage (no por REST) ──
    await goto(page, '/comercial')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Cupones' }).click()
    await page.getByRole('button', { name: /Nueva campaña de cupón/i }).click()

    const nombreInput = page.getByPlaceholder(/Día del amigo/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreCampaña)
    const montoInput = page.getByPlaceholder('1000')
    await montoInput.fill(String(MONTO_CUPON))
    const cantidadInput = page.locator('xpath=//label[contains(.,"Cantidad de códigos")]/following::input[1]')
    await cantidadInput.fill('10')
    const desdeInput = page.locator('xpath=//label[contains(.,"Vigencia desde")]/following::input[1]')
    await desdeInput.fill('2020-01-01')
    const hastaInput = page.locator('xpath=//label[contains(.,"Vigencia hasta")]/following::input[1]')
    await hastaInput.fill('2099-12-31')

    await page.getByRole('button', { name: /^Crear cupón$/ }).click()
    await expect(page.getByText(new RegExp(`Cupón "${nombreCampaña}" creado con 10 códigos`))).toBeVisible({ timeout: 12000 })

    // Tomar UNO de los 10 códigos recién generados para canjearlo en una venta real.
    const cuponRes = await request.get(
      `${SUPABASE_URL}/rest/v1/cupones?nombre=eq.${encodeURIComponent(nombreCampaña)}&select=id`, { headers })
    expect(cuponRes.ok(), `[128] no se pudo leer la campaña recién creada: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    expect(cupon, '[128] no se encontró la campaña recién creada por REST').toBeTruthy()
    const codigosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/cupones_codigos?cupon_id=eq.${cupon.id}&select=codigo&order=codigo&limit=1`, { headers })
    const [codigoRow] = (await codigosRes.json()) as Array<{ codigo: string }>
    expect(codigoRow, '[128] la campaña no generó ningún código').toBeTruthy()
    const codigo = codigoRow.codigo

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 3, estadoNombre: estadoVenta.nombre })
    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)
    await venderConCupon(page, { codigo, montoAPagar: PRECIO - MONTO_CUPON })

    // ── POSITIVO en UI: el historial de la campaña refleja "1/10 usados · $500 generado" ──
    // Scopeado a la TARJETA de esta campaña (por nombre) — el monto $500 es un valor común entre
    // los specs de cupón (115/119/122/128), así que un locator page-wide puede matchear la línea
    // "usados/generado" de una campaña VIEJA de otro spec con el mismo monto (visto en corrida real).
    await goto(page, '/comercial')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Cupones' }).click()
    const cardCampaña = page.locator('div', { has: page.getByText(nombreCampaña, { exact: true }) }).last()
    await expect(cardCampaña).toBeVisible({ timeout: 10000 })
    await expect(
      cardCampaña.getByText(new RegExp(`1/10 usados · \\$${MONTO_CUPON.toLocaleString('es-AR')} generado`)),
    ).toBeVisible({ timeout: 10000 })
  })
})
