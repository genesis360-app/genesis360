/**
 * 176_inventario_busqueda_lpn_mutante.spec.ts
 * E2E MUTANTE — Buscar un LPN en Inventario deja a la vista ESE LPN (pedido de GO 2026-10-02).
 *
 * Antes: buscar un LPN filtraba el producto, pero al expandirlo aparecían todos sus LPN (miles) y había que buscarlo a
 * mano. Ahora: la fila del producto dice cuántos LPN coinciden y, al expandirlo, muestra solo los LPN que coinciden (resaltados)
 * con un aviso "Mostrando 1 de N" y "Ver todos" muestra el resto con el buscado resaltado. NO tilda el checkbox (el
 * checkbox alimenta las acciones masivas: una búsqueda no debe dejar LPN seleccionados sin querer).
 * Siembra su propio producto con 3 LPN en Almacén Jorgito (avanzado); limpieza en `finally`.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test('buscar un LPN → producto expandido, solo ese LPN resaltado, "Ver todos" muestra el resto', async ({ page }) => {
  test.setTimeout(120_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const get = async (path: string) => (await (await page.request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers })).json()) as any[]

  const sucs = await get('sucursales?select=id,nombre,tenant_id&activo=eq.true')
  const suc = sucs.find(s => /norte/i.test(s.nombre)) ?? sucs[0]
  const [ubi] = await get(`ubicaciones?select=id&activo=eq.true&sucursal_id=eq.${suc.id}&limit=1`)
  expect(ubi, '[176] la sucursal no tiene ubicaciones').toBeTruthy()

  const ts = Date.now()
  const r = await page.request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: { ...headers, Prefer: 'return=representation' },
    data: { tenant_id: suc.tenant_id, nombre: `E2E176 ${ts}`, sku: `E2E176-${ts}`, precio_venta: 100, precio_costo: 50, activo: true },
  })
  expect(r.ok(), `[176] producto: ${await r.text()}`).toBe(true)
  const prodId = ((await r.json()) as any[])[0].id as string
  const lpns = [`E2E176A${ts}`, `E2E176B${ts}`, `E2E176C${ts}`]
  try {
    for (const lpn of lpns) {
      const li = await page.request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
        headers, data: { tenant_id: suc.tenant_id, producto_id: prodId, lpn, cantidad: 2, sucursal_id: suc.id, ubicacion_id: ubi.id, activo: true },
      })
      expect(li.ok(), `[176] línea ${lpn}: ${await li.text()}`).toBe(true)
    }

    await page.evaluate(id => localStorage.setItem('sucursal-id', id), suc.id)
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/).fill(lpns[1])
    // La fila del producto avisa cuántos LPN coinciden; se expande con un click (no solo: el click lo cerraría).
    await expect(page.getByText('1 LPN coincide')).toBeVisible({ timeout: 15000 })
    await page.getByText(`E2E176 ${ts}`, { exact: true }).first().click()

    const aviso = page.getByText(/Mostrando 1 de 3 LPN/)
    await expect(aviso, '[176] al expandir no muestra el aviso').toBeVisible({ timeout: 15000 })
    await expect(page.getByText(lpns[1]).first()).toBeVisible()
    await expect(page.getByText(lpns[0])).toHaveCount(0)
    // El buscado NO queda tildado (las acciones masivas no deben heredar una búsqueda).
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0)

    await page.getByRole('button', { name: 'Ver todos' }).click()
    await expect(page.getByText(/Mostrando los 3 LPN del producto/)).toBeVisible()
    await expect(page.getByText(lpns[0]).first()).toBeVisible()
    await expect(page.locator('[id^="lpn-fila-"].ring-2')).toHaveCount(1)
  } finally {
    await page.request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prodId}`, { headers, data: { activo: false } })
    await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, { headers, data: { activo: false } })
  }
})
