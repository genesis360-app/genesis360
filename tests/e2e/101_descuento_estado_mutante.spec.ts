/**
 * 101_descuento_estado_mutante.spec.ts
 * E2E MUTANTE — Descuento automático por estado de inventario (backlog Fede, punto 3):
 * un estado con `descuento_pct` (Config→Inventario→Estados) aplica su % automáticamente,
 * sin clave de supervisor, cuando la venta consume stock de ese estado.
 *
 * Genera su propia precondición: estado nuevo con 15% de descuento (por REST, no toca estados
 * compartidos) + producto nuevo con precio conocido + ingreso REAL por UI en ese estado (no
 * INSERT directo a inventario_lineas — respeta el flujo real de ingreso/movimientos_stock).
 * Verifica en DB que `venta_items.descuento_estado_monto` y `ventas.descuento_estado` reflejan
 * exactamente el % configurado (REGLA #0: la plata cobrada tiene que coincidir con lo trazado).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta, totalDelCarrito } from './helpers/fixtures'

test.describe('Descuento automático por estado de inventario (mutante)', () => {
  test('estado con 15% de descuento aplica solo, sin clave, y queda trazado en la venta', async ({ page, request }) => {
    test.setTimeout(90000)
    const sufijo = Date.now()
    const nombreEstado = `E2E Próximo a Vencer ${sufijo}`
    const nombreProducto = `E2E DescEstado ${sufijo}`
    const PRECIO = 1000
    const CANTIDAD = 4
    const PCT = 15

    // 1) Login del owner ya está en storageState — token para sembrar por REST
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 2) Estado NUEVO con descuento_pct (no toca estados compartidos de otros specs)
    const tenantDeEstados = await request.get(`${SUPABASE_URL}/rest/v1/estados_inventario?select=tenant_id&limit=1`, { headers })
    const [{ tenant_id: tenantId }] = (await tenantDeEstados.json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[101] no se pudo resolver el tenant_id del usuario e2e').toBeTruthy()

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers,
      data: { tenant_id: tenantId, nombre: nombreEstado, color: '#f59e0b', es_disponible_venta: true, descuento_pct: PCT },
    })
    expect(estadoRes.ok(), `[101] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estado] = (await estadoRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(estado, '[101] insert de estado no devolvió fila').toBeTruthy()

    // 3) Producto nuevo con precio conocido (el form de alta no pide precio → se fija por REST)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(prod, '[101] no se encontró el producto recién creado por REST').toBeTruthy()

    const patchRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: PRECIO, precio_costo: PRECIO * 0.6 },
    })
    expect(patchRes.ok(), '[101] no se pudo fijar precio_venta').toBe(true)

    // 4) Ingreso REAL por UI, seleccionando el estado nuevo (flujo real: crea inventario_lineas
    //    + movimientos_stock consistentes, no un INSERT directo que se saltearía eso).
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()
    await page.waitForTimeout(400)
    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
    await ingresoBtn.click()
    await page.waitForTimeout(400)

    const buscadorIngreso = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscadorIngreso).toBeVisible({ timeout: 6000 })
    await buscadorIngreso.fill(nombreProducto)
    await page.waitForTimeout(900)
    const modalIngreso = page.locator('div.fixed.inset-0').filter({ has: buscadorIngreso }).first()
    await modalIngreso.getByText(nombreProducto).first().click()
    await page.waitForTimeout(500)

    const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelect.isVisible().catch(() => false)) {
      const vals = await sucSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length > 0) await sucSelect.selectOption(vals[0])
    }

    const estadoSelect = page.locator('xpath=//label[contains(.,"Estado")]/following::select[1]')
    await expect(estadoSelect).toBeVisible({ timeout: 5000 })
    await estadoSelect.selectOption({ label: nombreEstado })

    const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
    if (await ubicSelect.isVisible().catch(() => false)) {
      const vals = await ubicSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length > 0) await ubicSelect.selectOption(vals[0])
    }

    await page.locator('input[type="number"][placeholder="0"]').first().fill(String(CANTIDAD))
    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 5) Vender el producto — toda la cantidad viene del estado con descuento (única línea)
    await garantizarCajaAbierta(page)
    await goto(page, '/ventas')
    await waitForApp(page)
    // "Ver stock de: Disponible ★" es el filtro default (grupo de estados) — el estado nuevo
    // no pertenece a ningún grupo, así que queda afuera salvo que se vea "Todos".
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    const buscadorPOS = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscadorPOS).toBeVisible({ timeout: 8000 })
    await buscadorPOS.fill(nombreProducto)
    await page.waitForTimeout(700)
    const prodBtn = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: nombreProducto }).first()
    await expect(prodBtn).toBeVisible({ timeout: 10000 })
    await prodBtn.click()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })

    // Subir la cantidad del carrito a CANTIDAD (se agrega con 1 por default) — botón "+",
    // único ítem en el carrito (producto recién creado), sin ambigüedad de selector. Se espera
    // el VALOR real del input (se remonta con key={qty-...-cantidad}) antes del próximo click,
    // no un timeout fijo — evita leer `item.cantidad` de un closure stale entre clicks.
    const btnMas = page.getByTitle('Aumentar cantidad').first()
    const cantInput = page.locator('input[inputmode="numeric"], input[inputmode="decimal"]').first()
    await expect(btnMas).toBeVisible({ timeout: 5000 })
    for (let i = 1; i < CANTIDAD; i++) {
      await btnMas.click()
      await expect(cantInput).toHaveValue(String(i + 1), { timeout: 5000 })
    }

    // 6) POSITIVO por UI: el resumen muestra la línea informativa del descuento por estado
    await expect(page.getByText(new RegExp(`Incluye desc\\. ${nombreEstado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(${PCT}%\\)`))).toBeVisible({ timeout: 8000 })

    const totalEsperado = CANTIDAD * PRECIO * (1 - PCT / 100)
    const total = await totalDelCarrito(page)
    expect(total, `[101] total del carrito debería reflejar el ${PCT}% off (esperado ~${totalEsperado})`).toBeLessThanOrEqual(totalEsperado + 1)
    expect(total).toBeGreaterThanOrEqual(totalEsperado - 1)

    // 7) Cobrar en efectivo y finalizar
    // Puede haber más de una caja abierta (otros specs/sesiones) → hay que elegir explícito.
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(Math.ceil(totalEsperado) + 1000))
    await montoInput.blur()
    await page.waitForTimeout(300)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 8) POSITIVO en DB: venta_items y ventas quedaron con el descuento trazado
    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${prod.id}&select=cantidad,subtotal,descuento_estado_pct,descuento_estado_monto,ventas(descuento_estado,total)&order=created_at.desc&limit=1`,
      { headers },
    )
    expect(itemsRes.ok(), `[101] no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{
      cantidad: number; subtotal: number; descuento_estado_pct: number | null; descuento_estado_monto: number | null
      ventas: { descuento_estado: Array<{ estado_nombre: string; pct: number; cantidad: number; monto: number }> | null; total: number }
    }>
    expect(item, '[101] no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad, '[101] cantidad vendida').toBe(CANTIDAD)
    expect(item.descuento_estado_pct, '[101] % de descuento por estado en la línea').toBe(PCT)
    const montoEsperado = CANTIDAD * PRECIO * PCT / 100
    expect(item.descuento_estado_monto, `[101] monto $ descontado por estado (esperado ${montoEsperado})`).toBeCloseTo(montoEsperado, 1)
    expect(item.subtotal, `[101] subtotal de la línea ya con el descuento aplicado`).toBeCloseTo(totalEsperado, 1)
    expect(item.ventas?.descuento_estado, '[101] ventas.descuento_estado debería tener el detalle').toBeTruthy()
    const detalle = item.ventas!.descuento_estado!.find(d => d.estado_nombre === nombreEstado)
    expect(detalle, '[101] falta el renglón del estado en ventas.descuento_estado').toBeTruthy()
    expect(detalle!.pct).toBe(PCT)
    expect(detalle!.monto).toBeCloseTo(montoEsperado, 1)
  })
})
