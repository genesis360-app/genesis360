/**
 * 23_inventario_ingreso_mutante.spec.ts
 * E2E MUTANTE del ingreso de stock (auditoría básico, pilar B).
 *
 * Es el camino de ENTRADA de stock del modo básico (Inventario → Agregar stock →
 * Ingreso): crea una inventario_lineas real (en básico con ubicacion_id/estado_id
 * NULL) y un movimiento de ingreso. Verifica la mutación vía el toast de éxito.
 *
 * 🌱 SIEMBRA SU PROPIO PRODUCTO (2026-07-28). Antes buscaba "a" y agarraba el PRIMER producto
 * que apareciera del tenant DEV — o sea, un producto distinto en cada corrida. Eso lo hacía
 * fallar de forma intermitente por motivos legítimos del producto elegido: el último caso fue
 * uno cuya ubicación predeterminada era Mono-SKU y ya estaba ocupada ("La ubicación RACK1 es
 * Mono-SKU y ya tiene ..."), es decir la app protegiendo bien y el test rompiéndose igual.
 * Un spec no puede depender de qué producto le toque: ahora crea el suyo, sin ubicación ni
 * atributos obligatorios, y lo borra al final.
 *
 * Corre con el usuario OWNER contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Inventario — ingreso de stock (mutante)', () => {
  test('ingresa stock de un producto y registra el movimiento', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E Ingreso ${Date.now()}`

    // 0) Sembrar el producto: sin ubicación predeterminada, sin atributos obligatorios, sin
    //    lote/vencimiento/series — nada que pueda bloquear legítimamente el ingreso.
    await goto(page, '/inventario')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const meRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?select=tenant_id&limit=1`, { headers })
    const [algunProd] = (await meRes.json()) as Array<{ tenant_id: string }>
    expect(algunProd, '[23] el tenant de prueba no tiene productos para leer el tenant_id').toBeTruthy()
    const crearRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: {
        tenant_id: algunProd.tenant_id, nombre: nombreProducto,
        sku: `E2E-ING-${Date.now()}`, precio_venta: 100, precio_costo: 50,
        unidad_medida: 'unidad', activo: true, stock_minimo: 0,
      },
    })
    expect(crearRes.ok(), `[23] no se pudo sembrar el producto: ${await crearRes.text()}`).toBe(true)
    const [prodSembrado] = (await crearRes.json()) as Array<{ id: string }>

    await goto(page, '/inventario')
    await waitForApp(page)

    // 1) Ir a la tab "Agregar stock"
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()
    await page.waitForTimeout(400)

    // 2) Abrir el modal de Ingreso
    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
    await ingresoBtn.click()
    await page.waitForTimeout(400)

    // 3) Buscar y elegir el producto QUE SEMBRÓ ESTE SPEC (no uno cualquiera del tenant)
    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscador).toBeVisible({ timeout: 6000 })
    await buscador.fill(nombreProducto)
    await page.waitForTimeout(900)
    // El resultado es un <button> full-width con el nombre del producto, DENTRO del modal de
    // Ingreso (evitamos un fallback page-wide que agarraba un botón detrás del backdrop).
    const modal = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
    const resultado = modal.locator('button.w-full.text-left').filter({ hasText: nombreProducto }).first()
    await expect(resultado, '[23] no apareció el producto sembrado por el propio spec').toBeVisible({ timeout: 8000 })
    await resultado.click()
    await page.waitForTimeout(500)

    // 4) Si hay selector de sucursal destino (vista "Todas"), elegir la primera
    const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelect.isVisible().catch(() => false)) {
      const vals = await sucSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (vals.length > 0) await sucSelect.selectOption(vals[0])
    }

    // 5) Cantidad = 1 (el input number con placeholder "0" dentro del modal)
    const cantidad = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidad).toBeVisible({ timeout: 5000 })
    await cantidad.fill('1')

    // 6) Confirmar ingreso
    const confirmar = page.getByRole('button', { name: /Confirmar ingreso/ }).first()
    await expect(confirmar).toBeEnabled({ timeout: 5000 })
    await confirmar.click()

    // 7) Verificar la mutación: toast de éxito
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 8) Y en DB: la línea existe con la cantidad ingresada (el toast solo no alcanza)
    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prodSembrado.id}&select=cantidad`, { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ cantidad: number }>
    expect(lineas, '[23] el ingreso debería haber creado una línea de stock').toHaveLength(1)
    expect(Number(lineas[0].cantidad)).toBe(1)

    // Cleanup — el orden importa por las FKs
    await request.delete(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prodSembrado.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${prodSembrado.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prodSembrado.id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodSembrado.id}`, { headers })
  })
})
