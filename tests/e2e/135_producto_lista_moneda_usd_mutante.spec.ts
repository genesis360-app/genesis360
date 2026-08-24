/**
 * 135_producto_lista_moneda_usd_mutante.spec.ts
 * E2E MUTANTE — bug real reportado por Fede (2026-08-20): la LISTA de Productos (ProductosPage)
 * ignoraba `moneda_venta`/`moneda_costo` y siempre convertía el precio/costo a $ (mirror ARS),
 * incluso para un producto priceado en USD — la ficha (ProductoFormPage) ya lo hacía bien desde
 * un bug anterior (mig 367). Verifica que la fila colapsada Y el panel expandido muestren el
 * valor NATIVO en USD (no el mirror ARS) para precio de venta y costo.
 *
 * Genera su propia precondición: producto nuevo vía UI, después patcheado por REST a
 * moneda_venta/moneda_costo='usd' con un mirror ARS decoy (si el fix regresara, el test vería
 * ese valor decoy en vez de "US$...").
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('ProductosPage → lista respeta moneda_venta/moneda_costo USD (mutante)', () => {
  test('fila colapsada y panel expandido muestran US$, no el mirror ARS', async ({ page, request }) => {
    const nombreProducto = `E2E MonedaUSD ${Date.now()}`
    const PRECIO_USD = 199.99
    const COSTO_USD = 99.99
    // Decoys: si el fix regresa, la lista volvería a mostrar ESTOS valores en $ en vez de US$.
    const PRECIO_ARS_DECOY = 301985
    const COSTO_ARS_DECOY = 150985

    // 1) Precondición: producto nuevo vía UI
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // 2) Por REST: patchear a moneda USD (venta y costo)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[135] no se encontró el producto recién creado').toBeTruthy()

    const patchRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`,
      {
        headers,
        data: {
          moneda_venta: 'usd', precio_usd: PRECIO_USD, precio_venta: PRECIO_ARS_DECOY,
          moneda_costo: 'usd', precio_costo_usd: COSTO_USD, precio_costo: COSTO_ARS_DECOY,
        },
      },
    )
    expect(patchRes.ok(), `[135] no se pudo patchear moneda USD: ${await patchRes.text()}`).toBe(true)

    // 3) Buscar el producto en la lista — fila colapsada
    await goto(page, '/productos')
    await waitForApp(page)
    await page.getByPlaceholder(/Buscar por nombre, SKU o código/i).fill(nombreProducto)

    // Ojo: `div.filter({hasText}).last()` matchea el div ENVOLVENTE más profundo por texto — acá
    // el nombre y el precio viven en divs HERMANOS (no uno dentro del otro), así que hay que
    // escopear por la clase real de la FILA clickeable (única en la lista) en vez de por texto.
    const fila = page.locator('div.cursor-pointer').filter({ hasText: nombreProducto })
    await expect(fila, '[135] no apareció la fila del producto en la lista').toBeVisible({ timeout: 10000 })

    await expect(
      fila.getByText('US$199.99', { exact: false }),
      '[135] la fila colapsada NO muestra el precio nativo en USD',
    ).toBeVisible({ timeout: 8000 })
    await expect(
      fila.getByText(PRECIO_ARS_DECOY.toLocaleString('es-AR'), { exact: false }),
      '[135] BUG: la fila colapsada sigue mostrando el mirror ARS en vez de USD',
    ).not.toBeVisible()

    await expect(
      fila.getByText('US$99.99', { exact: false }),
      '[135] la fila colapsada NO muestra el costo nativo en USD',
    ).toBeVisible({ timeout: 8000 })

    // 4) Expandir la fila — panel de detalle. Escopear al grid de la sección (contiene TODAS las
    // celdas — "Precio venta" y "Costo" son divs HERMANOS, no uno dentro del otro) para no repetir
    // el mismo error de scoping de la fila colapsada.
    await page.getByText(nombreProducto, { exact: true }).click()
    const panel = page.locator('div.grid').filter({ hasText: 'Precio venta' })
    await expect(panel, '[135] no se expandió el panel de detalle del producto').toBeVisible({ timeout: 8000 })
    await expect(panel.getByText('US$199.99', { exact: false })).toBeVisible({ timeout: 8000 })
    await expect(panel.getByText('US$99.99', { exact: false })).toBeVisible({ timeout: 8000 })
    await expect(
      panel.getByText(COSTO_ARS_DECOY.toLocaleString('es-AR'), { exact: false }),
      '[135] BUG: el panel expandido muestra el mirror ARS del costo en vez de USD',
    ).not.toBeVisible()
  })
})
