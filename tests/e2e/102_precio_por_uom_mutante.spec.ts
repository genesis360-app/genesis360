/**
 * 102_precio_por_uom_mutante.spec.ts
 * E2E MUTANTE — Precio de venta/costo por Unidad de Medida en la estructura (backlog Fede,
 * puntos 4/6/7): un nivel de la estructura (ej. Caja) puede tener su propio precio_venta/costo,
 * y la hoja de producto puede anclar sus precios a cualquier nivel de la estructura default
 * (no forzosamente el nivel base) vía "Estos precios corresponden a".
 *
 * Genera su propia precondición: producto nuevo + estructura de 2 niveles (Unidad→Caja ×12) con
 * precio propio en Caja, vía RPC real `fn_estructura_guardar_niveles`. Verifica en DB que el
 * precio del nivel persiste, y por UI que el selector de ancla en ProductoFormPage relabelea
 * "Precio de venta (por Caja)" al anclar ahí y que persiste `productos.nivel_precio_orden`.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Precio por Unidad de Medida en la estructura (mutante)', () => {
  test('nivel con precio propio persiste + ancla de precio en la hoja de producto', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E PrecioUoM ${Date.now()}`

    // 1) Producto nuevo
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(prod, '[102] no se encontró el producto recién creado por REST').toBeTruthy()

    // Precio base (nivel Unidad) conocido, para poder verificar el cálculo proporcional del
    // nivel sin precio propio si hiciera falta más adelante.
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: 100, precio_costo: 60 },
    })

    // 2) Estructura Unidad → Caja ×12, con precio propio en Caja ($1080, no 100×12=1200)
    const udmRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Unidad&select=id`, { headers })
    const [udmUnidad] = (await udmRes.json()) as Array<{ id: string }>
    expect(udmUnidad, '[102] falta la UdM predefinida Unidad').toBeTruthy()
    const udmCajaRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Caja&select=id`, { headers })
    const [udmCaja] = (await udmCajaRes.json()) as Array<{ id: string }>
    expect(udmCaja, '[102] falta la UdM predefinida Caja').toBeTruthy()

    const estrId = crypto.randomUUID()
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_estructuras`, {
      headers,
      data: { id: estrId, tenant_id: prod.tenant_id, producto_id: prod.id, nombre: 'Precio UoM E2E', is_default: true },
    })
    expect(insRes.ok(), `[102] no se pudo crear la estructura: ${await insRes.text()}`).toBe(true)

    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: {
        p_estructura_id: estrId,
        p_niveles: [
          { unidad_medida_id: udmUnidad.id, factor: 1 },
          { unidad_medida_id: udmCaja.id, factor: 12, precio_venta: 1080, precio_costo: 650 },
        ],
      },
    })
    expect(rpcRes.ok(), `[102] no se pudieron guardar los niveles con precio: ${await rpcRes.text()}`).toBe(true)

    // 3) POSITIVO en DB: el precio propio del nivel Caja persistió tal cual (no se recalculó)
    const nivelesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estrId}&order=orden&select=orden,precio_venta,precio_costo,unidades_base`,
      { headers },
    )
    const niveles = (await nivelesRes.json()) as Array<{ orden: number; precio_venta: number | null; precio_costo: number | null; unidades_base: number }>
    expect(niveles).toHaveLength(2)
    expect(niveles[0].precio_venta, '[102] nivel base no debería tener precio propio (usa el de productos)').toBeNull()
    expect(Number(niveles[1].precio_venta), '[102] el nivel Caja debería guardar su precio propio, no 12×100').toBe(1080)
    expect(Number(niveles[1].precio_costo)).toBe(650)
    expect(niveles[1].unidades_base).toBe(12)

    // 4) Ancla de precio en la hoja de producto — seleccionar "Caja" y guardar
    await goto(page, `/productos/${prod.id}/editar`)
    await waitForApp(page)
    const anclaSelect = page.locator('xpath=//label[contains(.,"Estos precios corresponden a")]/following::select[1]')
    await expect(anclaSelect).toBeVisible({ timeout: 8000 })
    const opcionCaja = anclaSelect.locator('option', { hasText: 'Caja' })
    await expect(opcionCaja).toHaveCount(1)
    const valorCaja = await opcionCaja.getAttribute('value')
    await anclaSelect.selectOption(valorCaja!)

    // El label se relabelea con la UdM anclada (confirma que el estado del form se actualizó)
    await expect(page.getByText(/Precio de venta \(por Caja\)/)).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /Guardar cambios|Guardar producto/i }).first().click()
    await expect(page.getByText(/Producto actualizado|actualizado correctamente|Cambios guardados/i)).toBeVisible({ timeout: 10000 })

    // 5) POSITIVO en DB: nivel_precio_orden quedó en 2 (Caja)
    const prodFinalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}&select=nivel_precio_orden`,
      { headers },
    )
    const [prodFinal] = (await prodFinalRes.json()) as Array<{ nivel_precio_orden: number | null }>
    expect(prodFinal.nivel_precio_orden, '[102] nivel_precio_orden debería haber quedado en 2 (Caja)').toBe(2)
  })
})
