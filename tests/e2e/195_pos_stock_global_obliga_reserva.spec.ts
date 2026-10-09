/**
 * 195_pos_stock_global_obliga_reserva.spec.ts
 * 🛑 REGLA #0 (inventario) — UAT §111 (F1): en el POS de Sur, un producto con stock de NORTE en una ubicación Global
 * suma ese stock (se puede vender), el carrito avisa de qué sucursal sale, y "Venta directa" se frena: la venta con stock de
 * otra sucursal va SIEMPRE por reserva + pedido.
 *
 * No cobra nada: el intento de venta directa se rechaza antes de escribir (se verifica que el carrito sigue intacto).
 * Corre con OWNER (chromium) contra DEV (Almacén Jorgito: "E2E Siembra" es Global y tiene stock de Norte).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

test('POS: stock de otra sucursal en Global se ofrece, se avisa y obliga a reservar', async ({ page, request }) => {
  test.setTimeout(120000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  await page.evaluate((id) => {
    localStorage.setItem('sucursal-id', id)
    for (const k of Object.keys(localStorage)) if (/cart|carrito/i.test(k)) localStorage.removeItem(k)
  }, SUR)
  const h = restHeaders(await tokenDesdeBrowser(page))
  const get = async (p: string) => (await request.get(`${SUPABASE_URL}/rest/v1/${p}`, { headers: h })).json()
  const hoy = new Date().toISOString().slice(0, 10)
  const libre = (l: any) => Math.max(0, Number(l.cantidad) - Number(l.cantidad_reservada ?? 0))
  const vendible = (l: any) => l.estados_inventario?.es_disponible_venta && l.ubicaciones?.disponible_surtido !== false
    && (!l.fecha_vencimiento || l.fecha_vencimiento >= hoy)

  // Producto sin serie, activo, con stock de Norte en una Global que supere lo que hay en Sur.
  const globales = await get(
    `inventario_lineas?sucursal_id=eq.${NORTE}&activo=eq.true&select=producto_id,cantidad,cantidad_reservada,fecha_vencimiento,` +
    `estados_inventario(es_disponible_venta),ubicaciones!inner(sucursal_id,disponible_surtido),productos!inner(nombre,tiene_series,activo)` +
    `&ubicaciones.sucursal_id=is.null&productos.tiene_series=eq.false&productos.activo=eq.true&limit=200`) as any[]
  const porProd = new Map<string, { nombre: string; global: number }>()
  for (const l of globales.filter(vendible)) {
    const e = porProd.get(l.producto_id) ?? { nombre: l.productos.nombre, global: 0 }
    e.global += libre(l); porProd.set(l.producto_id, e)
  }
  let elegido: { id: string; nombre: string; sur: number; global: number } | null = null
  for (const [id, e] of porProd) {
    if (e.global < 2) continue
    const sur = (await get(`inventario_lineas?producto_id=eq.${id}&sucursal_id=eq.${SUR}&activo=eq.true&ubicacion_id=not.is.null` +
      `&select=cantidad,cantidad_reservada,fecha_vencimiento,estados_inventario(es_disponible_venta),ubicaciones(disponible_surtido)`) as any[])
      .filter(vendible).reduce((a, l) => a + libre(l), 0)
    if (e.global >= sur + 1 && sur < 50) { elegido = { id, nombre: e.nombre, sur, global: e.global }; break }
  }
  test.skip(!elegido, '[195] no hay un producto con stock de Norte en una Global que supere el de Sur')

  await goto(page, '/ventas')
  await waitForApp(page)
  await page.getByRole('button', { name: /^Todos$/ }).first().click()
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await buscador.click()
  await buscador.pressSequentially(elegido!.nombre.slice(0, 18), { delay: 30 })
  const prodBtn = page.locator('div.absolute.top-full button').filter({ hasText: elegido!.nombre }).first()
  await expect(prodBtn, '[195] el producto no aparece en el POS de Sur').toBeVisible({ timeout: 15000 })
  await expect(prodBtn.getByText(/de otra sucursal/), '[195] la búsqueda tiene que separar el stock de otra sucursal').toBeVisible()
  await prodBtn.click()
  await expect(page.getByText(/1\s+producto/).first()).toBeVisible({ timeout: 8000 })

  // Pedir más de lo que hay en Sur → el plan toma la Global de Norte y el carrito avisa.
  const cantidad = page.getByTitle('Aumentar cantidad').first().locator('xpath=preceding-sibling::input[1]')
  await cantidad.fill(String(elegido!.sur + 1))
  await cantidad.blur()
  await expect(page.getByText(/Sale de stock de .* \(ubicación Global\)/).first(), '[195] falta el aviso de stock de otra sucursal').toBeVisible({ timeout: 8000 })
  await expect(page.getByText(/Stock máximo disponible/), '[195] el tope tiene que incluir la Global').toHaveCount(0)

  // "Venta directa" se rechaza antes de escribir nada.
  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(v => v))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const monto = page.getByPlaceholder(/^Monto$/i).first()
  await monto.fill('99999999')
  await monto.blur()
  await page.locator('button', { hasText: /^Venta directa$/ }).last().click()
  await expect(page.getByText(/registrala como RESERVA/).first(), '[195] la venta directa con stock de otra sucursal se tiene que frenar').toBeVisible({ timeout: 8000 })
  await expect(page.getByText(/1\s+producto/).first(), '[195] no se registró nada: el carrito sigue').toBeVisible()
})
