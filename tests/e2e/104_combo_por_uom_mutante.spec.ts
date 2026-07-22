/**
 * 104_combo_por_uom_mutante.spec.ts
 * E2E MUTANTE — Combo con UoM propia (backlog Fede 4/6/7, Fase 2): un combo con
 * `unidad_medida_id` NULL (el default de TODOS los combos existentes) solo aplica a ventas en
 * la UoM base del producto — cambiar la línea a "por Caja" desactiva el combo, aunque la
 * cantidad en unidades base siga cumpliendo el umbral.
 *
 * BUG REAL de fondo que motivó el fix (relevamiento): el auto-combo agrupaba/reconstruía filas
 * solo por producto_id, clonando las propiedades de UNA fila representativa — con UoM distinta
 * de por medio hubiera mezclado precio/UoM de una fila en otra. El fix agrupa por
 * producto_id + unidad_medida_id y solo aplica combos cuya UoM matchea la de la línea.
 *
 * Genera su propia precondición: producto ($100 Unidad / $1.080 Caja ×12) + combo "3×10%" SOLO
 * para la UoM base + stock real.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta, totalDelCarrito } from './helpers/fixtures'

test.describe('Combo con UoM propia — solo aplica en su UoM (mutante)', () => {
  test('combo "3×10% off" (UoM base) aplica suelto, se desactiva al vender por Caja', async ({ page, request }) => {
    test.setTimeout(90000)
    const sufijo = Date.now()
    const nombreProducto = `E2E ComboUoM ${sufijo}`
    const PRECIO_UNIDAD = 100
    const PRECIO_CAJA = 1080
    const FACTOR_CAJA = 12

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 1) Producto + precio base
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
    expect(prod, '[104] no se encontró el producto recién creado').toBeTruthy()
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: PRECIO_UNIDAD, precio_costo: 60 },
    })

    // 2) Estructura Unidad → Caja ×12 con precio propio
    const udmUnidadRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Unidad&select=id`, { headers })
    const [udmUnidad] = (await udmUnidadRes.json()) as Array<{ id: string }>
    const udmCajaRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Caja&select=id`, { headers })
    const [udmCaja] = (await udmCajaRes.json()) as Array<{ id: string }>
    const estrId = crypto.randomUUID()
    await request.post(`${SUPABASE_URL}/rest/v1/producto_estructuras`, {
      headers, data: { id: estrId, tenant_id: prod.tenant_id, producto_id: prod.id, nombre: 'Combo UoM E2E', is_default: true },
    })
    await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: {
        p_estructura_id: estrId,
        p_niveles: [
          { unidad_medida_id: udmUnidad.id, factor: 1 },
          { unidad_medida_id: udmCaja.id, factor: FACTOR_CAJA, precio_venta: PRECIO_CAJA, precio_costo: 650 },
        ],
      },
    })

    // 3) Combo "3×10% off" SOLO para la UoM base (unidad_medida_id NULL — el default de todos
    //    los combos existentes, este fix no les cambia el comportamiento)
    const comboId = crypto.randomUUID()
    const comboRes = await request.post(`${SUPABASE_URL}/rest/v1/combos`, {
      headers,
      data: {
        id: comboId, tenant_id: prod.tenant_id, nombre: `Combo E2E ${sufijo}`, activo: true,
        descuento_tipo: 'pct', descuento_pct: 10, descuento_monto: 0,
      },
    })
    expect(comboRes.ok(), `[104] no se pudo crear el combo: ${await comboRes.text()}`).toBe(true)
    const comboItemRes = await request.post(`${SUPABASE_URL}/rest/v1/combo_items`, {
      headers, data: { tenant_id: prod.tenant_id, combo_id: comboId, producto_id: prod.id, cantidad: 3 },
    })
    expect(comboItemRes.ok(), `[104] no se pudo crear el combo_item: ${await comboItemRes.text()}`).toBe(true)

    // 4) Ingreso de stock suficiente en un estado vendible
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
    await page.locator('input[type="number"][placeholder="0"]').first().fill('60')
    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 5) POS: agregar el producto y subir a 3 unidades sueltas → dispara el combo 3×10%
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

    const btnMas = page.getByTitle('Aumentar cantidad').first()
    await btnMas.click()
    await page.waitForTimeout(300)
    await btnMas.click()
    await expect(page.getByText(/Combo aplicado/i)).toBeVisible({ timeout: 6000 })

    const totalConCombo = await totalDelCarrito(page)
    expect(totalConCombo, '[104] 3×$100 con 10% off = $270').toBeCloseTo(3 * PRECIO_UNIDAD * 0.9, 0)

    // 6) Cambiar la UoM de esa MISMA línea a "Caja" — el combo (UoM base) ya NO debería aplicar,
    //    aunque técnicamente 3×12=36 unidades base "cumplirían" el umbral del combo si se mirara
    //    solo la cantidad. Este es el corazón del fix: la UoM de la línea importa, no solo la qty.
    const selectorUom = page.locator('select').filter({ has: page.locator('option', { hasText: 'Caja' }) }).first()
    await expect(selectorUom).toBeVisible({ timeout: 8000 })
    const opcionCaja = selectorUom.locator('option', { hasText: 'Caja' })
    const valorCaja = await opcionCaja.getAttribute('value')
    await selectorUom.selectOption(valorCaja!)
    await page.waitForTimeout(600)

    const totalSinCombo = await totalDelCarrito(page)
    // 1 Caja (reinicia a cantidad_uom=1 al cambiar de UoM) a $1.080, SIN descuento de combo
    expect(totalSinCombo, '[104] al vender por Caja el combo de UoM base no debe aplicar').toBeCloseTo(PRECIO_CAJA, 0)

    // 7) Cobrar y finalizar
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(PRECIO_CAJA + 1000))
    await montoInput.blur()
    await page.waitForTimeout(300)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 8) POSITIVO en DB: la única línea final es "1 Caja", sin descuento
    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${prod.id}&select=cantidad,cantidad_uom,unidad_medida_id,descuento,subtotal&order=created_at.desc&limit=1`,
      { headers },
    )
    const [item] = (await itemsRes.json()) as Array<{
      cantidad: number; cantidad_uom: number | null; unidad_medida_id: string | null; descuento: number; subtotal: number
    }>
    expect(item, '[104] no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.unidad_medida_id, '[104] vendida por Caja').toBe(udmCaja.id)
    expect(item.cantidad, '[104] 1 Caja = 12 unidades base').toBe(12)
    expect(item.descuento, '[104] sin descuento de combo (el combo es solo de la UoM base)').toBe(0)
    expect(Number(item.subtotal), '[104] subtotal = precio de Caja intacto, $1.080').toBeCloseTo(PRECIO_CAJA, 0)
  })
})
