/**
 * 103_venta_por_uom_mutante.spec.ts
 * E2E MUTANTE — Vender por Unidad de Medida en el POS (backlog Fede 4/6/7, Fase 2): elegir un
 * nivel de la estructura del producto (ej. "Caja") en el carrito usa el precio de ESE nivel,
 * convierte la cantidad a unidades base para el stock, y queda trazado en venta_items.
 *
 * Genera su propia precondición: producto nuevo ($100 la Unidad) + estructura Unidad→Caja ×12
 * con precio propio en Caja ($1.080, no 12×100=$1.200) vía RPC real + ingreso de stock real por
 * UI. Vende 3 Cajas y verifica en DB: cantidad=36 (unidades base), unidad_medida_id=Caja,
 * cantidad_uom=3, precio_unitario≈90 (1080/12), subtotal=3240.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta, totalDelCarrito } from './helpers/fixtures'

test.describe('Venta por Unidad de Medida en el POS (mutante)', () => {
  test('vender 3 Cajas usa el precio de Caja y convierte a 36 unidades base', async ({ page, request }) => {
    test.setTimeout(90000)
    const sufijo = Date.now()
    const nombreProducto = `E2E VentaUoM ${sufijo}`
    const PRECIO_UNIDAD = 100
    const PRECIO_CAJA = 1080 // no 12×100=1200 — a propósito, para probar que NO se recalcula
    const FACTOR_CAJA = 12
    const CAJAS_A_VENDER = 3

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 1) Producto nuevo con precio base conocido
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
    expect(prod, '[103] no se encontró el producto recién creado por REST').toBeTruthy()

    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: PRECIO_UNIDAD, precio_costo: 60 },
    })

    // 2) Estructura Unidad → Caja ×12, Caja con precio propio
    const udmUnidadRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Unidad&select=id`, { headers })
    const [udmUnidad] = (await udmUnidadRes.json()) as Array<{ id: string }>
    const udmCajaRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Caja&select=id`, { headers })
    const [udmCaja] = (await udmCajaRes.json()) as Array<{ id: string }>
    expect(udmUnidad && udmCaja, '[103] faltan las UdM predefinidas Unidad/Caja').toBeTruthy()

    const estrId = crypto.randomUUID()
    await request.post(`${SUPABASE_URL}/rest/v1/producto_estructuras`, {
      headers,
      data: { id: estrId, tenant_id: prod.tenant_id, producto_id: prod.id, nombre: 'Venta UoM E2E', is_default: true },
    })
    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: {
        p_estructura_id: estrId,
        p_niveles: [
          { unidad_medida_id: udmUnidad.id, factor: 1 },
          { unidad_medida_id: udmCaja.id, factor: FACTOR_CAJA, precio_venta: PRECIO_CAJA, precio_costo: 650 },
        ],
      },
    })
    expect(rpcRes.ok(), `[103] no se pudieron guardar los niveles: ${await rpcRes.text()}`).toBe(true)

    // 3) Ingreso real de stock (suficiente para 3 cajas = 36 unidades) por UI
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
    // Estado — en modo avanzado, stock "Sin estado" (NULL) queda EXCLUIDO del cálculo de
    // disponible-para-venta (el filtro es `.in('estado_id', estadosVendibles)`, NULL nunca
    // matchea un IN) — sin elegir un estado vendible acá, la venta de más abajo falla con
    // "sin stock" pese a haber ingresado 50 unidades.
    const estadoSelect = page.locator('xpath=//label[contains(.,"Estado")]/following::select[1]')
    if (await estadoSelect.isVisible().catch(() => false)) {
      const opcionDisponible = estadoSelect.locator('option', { hasText: 'Disponible' })
      if (await opcionDisponible.count() > 0) {
        await estadoSelect.selectOption({ value: (await opcionDisponible.first().getAttribute('value'))! })
      } else {
        const vals = await estadoSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
        if (vals.length > 0) await estadoSelect.selectOption(vals[0])
      }
    }
    const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
    if (await ubicSelect.isVisible().catch(() => false)) {
      const vals = await ubicSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length > 0) await ubicSelect.selectOption(vals[0])
    }
    await page.locator('input[type="number"][placeholder="0"]').first().fill('50')
    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 4) POS: agregar el producto y cambiar la UoM a "Caja"
    await garantizarCajaAbierta(page)
    await goto(page, '/ventas')
    await waitForApp(page)
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

    // Por default vende 1 Unidad @ $100 — el selector de UoM debe existir con "Caja" de opción
    const selectorUom = page.locator('select').filter({ has: page.locator('option', { hasText: 'Caja' }) }).first()
    await expect(selectorUom).toBeVisible({ timeout: 8000 })
    const opcionCaja = selectorUom.locator('option', { hasText: 'Caja' })
    const valorCaja = await opcionCaja.getAttribute('value')
    await selectorUom.selectOption(valorCaja!)
    await page.waitForTimeout(400)

    // Subir la cantidad EN CAJAS a 3 (arranca en 1) — botón "+" de los controles de UoM
    const btnMas = page.getByTitle('Aumentar cantidad').first()
    for (let i = 1; i < CAJAS_A_VENDER; i++) {
      await btnMas.click()
      await page.waitForTimeout(300)
    }

    // "= 36 Unidad" confirma la conversión visible antes de cobrar
    await expect(page.getByText(/= 36 Unidad/)).toBeVisible({ timeout: 5000 })

    const totalEsperado = CAJAS_A_VENDER * PRECIO_CAJA // 3240, NO 3×12×100=3600
    const total = await totalDelCarrito(page)
    expect(total, `[103] el total debería usar el precio de Caja ($${PRECIO_CAJA}), no 12×$100`).toBeCloseTo(totalEsperado, 0)

    // 5) Cobrar y finalizar
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(totalEsperado + 1000))
    await montoInput.blur()
    await page.waitForTimeout(300)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 6) POSITIVO en DB: cantidad=36 (unidades base), UoM=Caja, cantidad_uom=3, precio≈90
    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${prod.id}&select=cantidad,cantidad_uom,precio_unitario,subtotal,unidad_medida_id&order=created_at.desc&limit=1`,
      { headers },
    )
    const [item] = (await itemsRes.json()) as Array<{
      cantidad: number; cantidad_uom: number | null; precio_unitario: number; subtotal: number; unidad_medida_id: string | null
    }>
    expect(item, '[103] no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad, '[103] cantidad en unidades BASE (3 cajas × 12)').toBe(36)
    expect(item.cantidad_uom, '[103] cantidad_uom = 3 (cajas)').toBe(3)
    expect(item.unidad_medida_id, '[103] unidad_medida_id = Caja').toBe(udmCaja.id)
    expect(Number(item.precio_unitario), '[103] precio por unidad base = 1080/12 = 90').toBeCloseTo(90, 1)
    expect(Number(item.subtotal), '[103] subtotal = 3 × 1080 = 3240').toBeCloseTo(3240, 0)
  })
})
