/**
 * 190_carrito_stock_de_la_sucursal_activa.spec.ts
 * 🛑 REGLA #0 (inventario) — El carrito del POS toma el stock SOLO de la sucursal activa.
 *
 * Caso de GO 2026-10-08 (DEV, Almacén de la Suerte): vendiendo en Flores, el POS decía "máximo 20" — las 20 u. de
 * Saavedra — porque `agregarProducto` traía las líneas del producto de TODAS las sucursales (la búsqueda y el registro
 * de la venta sí filtraban). De esa lista salen el LPN que se muestra en el carrito y el tope de cantidad.
 *
 * Acá: desde Sucursal Sur, "Leche La Serenisima 1L" (Sur ≈ 11 u. vendibles, Norte ≈ 121). Pedir una más de lo que hay en
 * Sur tiene que frenar en lo de Sur; con el bug, el tope era la suma de las dos sucursales. Solo lectura: no se cobra.
 *
 * Corre con OWNER (chromium) contra DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'
const SKU = 'LACT-0001'

test('el tope de cantidad del carrito es el stock de la sucursal activa, no el de todas', async ({ page, request }) => {
  test.setTimeout(90000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  await page.evaluate((id) => {
    localStorage.setItem('sucursal-id', id)
    for (const k of Object.keys(localStorage)) if (/cart|carrito/i.test(k)) localStorage.removeItem(k)
  }, SUR)

  // Lo vendible en Sur según la base (estado vendible, ubicación de surtido, no vencido, sin reservar).
  const h = restHeaders(await tokenDesdeBrowser(page))
  const prod = (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${SKU}&select=id`, { headers: h })).json())[0]
  expect(prod, `[190] falta el producto ${SKU} en el tenant de prueba`).toBeTruthy()
  const lineas = await (await request.get(
    `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&activo=eq.true&select=sucursal_id,cantidad,cantidad_reservada,fecha_vencimiento,estados_inventario(es_disponible_venta),ubicaciones(disponible_surtido)`,
    { headers: h })).json() as any[]
  const hoy = new Date().toISOString().slice(0, 10)
  const vendible = (l: any) => l.estados_inventario?.es_disponible_venta && l.ubicaciones?.disponible_surtido !== false
    && (!l.fecha_vencimiento || l.fecha_vencimiento >= hoy)
  const libre = (l: any) => Math.max(0, Number(l.cantidad) - Number(l.cantidad_reservada ?? 0))
  const enSur = lineas.filter(l => l.sucursal_id === SUR && vendible(l)).reduce((a, l) => a + libre(l), 0)
  const enOtras = lineas.filter(l => l.sucursal_id !== SUR && vendible(l)).reduce((a, l) => a + libre(l), 0)
  test.skip(enSur < 1 || enOtras < 1, `[190] hace falta stock vendible en Sur y en otra sucursal (Sur ${enSur}, otras ${enOtras})`)

  await goto(page, '/ventas')
  await waitForApp(page)
  await page.getByRole('button', { name: /^Todos$/ }).first().click()
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await buscador.click()
  await buscador.pressSequentially('Serenisima', { delay: 40 })
  const prodBtn = page.locator('div.absolute.top-full button').filter({ hasText: /Leche La Serenisima 1L/i }).first()
  await expect(prodBtn).toBeVisible({ timeout: 15000 })
  await prodBtn.click()
  await expect(page.getByText(/1\s+producto/).first()).toBeVisible({ timeout: 8000 })

  // Pedir una más de lo que hay en Sur → tiene que frenar con el stock de Sur.
  // El input de cantidad está entre los botones "Reducir" y "Aumentar cantidad" del ítem.
  const cantidad = page.getByTitle('Aumentar cantidad').first().locator('xpath=preceding-sibling::input[1]')
  await cantidad.fill(String(enSur + 1))
  await cantidad.blur()
  await expect(page.getByText(`Stock máximo disponible: ${enSur}`), '[190] el tope tiene que ser el stock de Sur, no el de todas las sucursales')
    .toBeVisible({ timeout: 8000 })
})
