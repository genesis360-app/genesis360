/**
 * 183_categorias_permisos_y_eliminar.spec.ts
 * E2E — Categorías de clientes, rediseño 2026-10-05 (mig 472).
 *
 * A. Permisos en Configuración → Clientes (solo el DUEÑO): pestañas Roles / Usuarios con checkboxes; se guardan con el
 *    botón de la página y quedan en `tenants.categorias_cliente_roles` como 'SUPERVISOR' / 'user:<id>'.
 * B. Eliminar: el DUEÑO ve el botón; en una categoría que ya se usó está deshabilitado; una sin usar se elimina.
 * Restaura los permisos originales en `finally`.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test('permisos por rol y por usuario se guardan desde Configuración', async ({ page }) => {
  test.setTimeout(120_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [t] = await (await page.request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,categorias_cliente_roles&limit=1`, { headers })).json()
  const original = t.categorias_cliente_roles ?? []
  try {
    await page.request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${t.id}`, { headers, data: { categorias_cliente_roles: [] } })
    await page.reload()
    await goto(page, '/configuracion?tab=clientes')
    await waitForApp(page)
    const bloque = page.getByTestId('permiso-gestionar-categorias')
    await expect(bloque).toContainText('Solo el dueño', { timeout: 20000 })
    await bloque.locator('button[aria-expanded]').click()
    await bloque.getByRole('checkbox', { name: /^Supervisor/ }).check().catch(async () => {
      await bloque.locator('label', { hasText: 'Supervisor' }).first().locator('input').check()
    })
    await bloque.getByRole('tab', { name: /Usuarios/ }).click()
    const primerUsuario = bloque.locator('li label input[type="checkbox"]').first()
    await primerUsuario.check()
    await expect(bloque).toContainText('1 rol y 1 usuario')
    await page.getByRole('button', { name: /Guardar configuración de Clientes/ }).click()
    await expect.poll(async () => {
      const [x] = await (await page.request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${t.id}&select=categorias_cliente_roles`, { headers })).json()
      const v: string[] = x.categorias_cliente_roles ?? []
      return v.includes('SUPERVISOR') && v.some(k => k.startsWith('user:'))
    }, { timeout: 15000 }).toBe(true)
  } finally {
    await page.request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${t.id}`, { headers, data: { categorias_cliente_roles: original } })
  }
})

test('eliminar: deshabilitado si la categoría ya se usó; una sin usar se elimina', async ({ page }) => {
  test.setTimeout(90_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = { ...restHeaders(await tokenDesdeBrowser(page)), Prefer: 'return=representation' }
  const [s] = await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()
  const ts = Date.now()
  const [usada] = await (await page.request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, { headers, data: { tenant_id: s.tenant_id, nombre: `E2E183 usada ${ts}` } })).json()
  const [libre] = await (await page.request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, { headers, data: { tenant_id: s.tenant_id, nombre: `E2E183 libre ${ts}` } })).json()
  const [cli] = await (await page.request.post(`${SUPABASE_URL}/rest/v1/clientes`, { headers, data: { tenant_id: s.tenant_id, nombre: `E2E183 cliente ${ts}`, categoria_cliente_id: usada.id } })).json()
  try {
    await goto(page, '/clientes?tab=categorias')
    await waitForApp(page)
    await expect(page.locator(`[data-categoria="E2E183 usada ${ts}"]`).getByRole('button', { name: /^Eliminar / })).toBeDisabled({ timeout: 15000 })
    await page.locator(`[data-categoria="E2E183 libre ${ts}"]`).getByRole('button', { name: /^Eliminar / }).click()
    await page.getByRole('button', { name: /^(Confirmar|Aceptar|Eliminar)$/ }).last().click()
    await expect(page.getByText('Categoría eliminada').first()).toBeVisible({ timeout: 10000 })
    const quedan = await (await page.request.get(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${libre.id}&select=id`, { headers })).json()
    expect(quedan).toHaveLength(0)
  } finally {
    await page.request.patch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${cli.id}`, { headers, data: { categoria_cliente_id: null, activo: false } })
    await page.request.patch(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${usada.id}`, { headers, data: { activo: false } })
  }
})
