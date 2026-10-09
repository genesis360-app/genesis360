/**
 * 193_pedido_ver_en_envios_filtra.spec.ts
 * Pedidos → "Ver en Envíos" lleva a Envíos filtrado EXACTO por el envío de ese pedido (pedido de GO 2026-10-09; antes
 * abría Envíos sin filtro). El link va por id (`/envios?envio=<id>`), no por texto: un "28" no puede traer el 280.
 *
 * Solo lectura. Toma un pedido de venta con envío, vivo, de DEV (Almacén Jorgito); si no hay, se saltea.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test('Pedidos → "Ver en Envíos" abre Envíos filtrado por el envío del pedido', async ({ page, request }) => {
  test.setTimeout(90000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const h = restHeaders(await tokenDesdeBrowser(page))
  const pedidos = await (await request.get(
    `${SUPABASE_URL}/rest/v1/pedidos?requiere_envio=eq.true&venta_origen_id=not.is.null&estado=not.in.(entregado,cancelado)` +
    `&select=id,numero,sucursal_id,venta_origen_id&order=created_at.desc&limit=20`, { headers: h })).json() as any[]
  let elegido: any = null, envio: any = null
  for (const p of pedidos) {
    const env = await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?or=(pedido_id.eq.${p.id},venta_id.eq.${p.venta_origen_id})&select=id,numero&order=created_at.desc&limit=1`,
      { headers: h })).json() as any[]
    if (env.length) { elegido = p; envio = env[0]; break }
  }
  test.skip(!elegido, '[193] no hay un pedido de venta con envío vivo en DEV')

  await page.evaluate((id) => localStorage.setItem('sucursal-id', id), elegido.sucursal_id)
  await goto(page, `/pedidos?busqueda=${encodeURIComponent(`Pedido:${elegido.numero}`)}`)
  await waitForApp(page)
  const boton = page.getByRole('button', { name: /Ver en Envíos/ }).first()
  await expect(boton, '[193] el pedido no muestra "Ver en Envíos"').toBeVisible({ timeout: 15000 })
  await boton.click()

  await expect(page).toHaveURL(new RegExp(`/envios\\?envio=${envio.id}`), { timeout: 10000 })
  // La lista muestra ese envío y ningún otro.
  await expect(page.getByText(`#${envio.numero}`, { exact: false }).first(), '[193] no se ve el envío del pedido').toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: /Limpiar/ }), '[193] el filtro se tiene que poder limpiar').toBeVisible()
  const filas = await (await request.get(`${SUPABASE_URL}/rest/v1/envios?id=eq.${envio.id}&select=id`, { headers: h })).json() as any[]
  expect(filas).toHaveLength(1)
})
