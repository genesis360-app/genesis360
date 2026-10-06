/**
 * 185_portal_proveedores_reenviar_y_crear_password.spec.ts
 * E2E — Portal de Proveedores (GO 2026-10-06): si el proveedor perdió el link de la invitación no había cómo volver a
 * mandárselo, y en el portal no tenía cómo crear ni recuperar su contraseña ("pedile al negocio que te invite de nuevo").
 *
 * A · Negocio: un proveedor VINCULADO muestra "Reenviar acceso por email" y "Copiar link del portal". Lo copiado es la
 *     DIRECCIÓN del portal + cómo entrar, NUNCA el link de acceso (entra a una cuenta que puede estar en otros negocios).
 *     No se toca "Reenviar" (mandaría un correo real).
 * B · Portal (contexto SIN sesión — página pública): "¿Primera vez u olvidaste tu contraseña?" pide el email y confirma
 *     el envío con el mismo mensaje exista o no la cuenta (no revela quién es proveedor).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'E2E PortalResp fixed95901'   // vinculado al portal (fixture del spec 139)

test('A · proveedor vinculado: reenviar acceso y copiar la dirección del portal (no el link de acceso)', async ({ page, context }) => {
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await goto(page, '/proveedores')
  await waitForApp(page)
  await page.getByPlaceholder(/Buscar por nombre, CUIT/).fill(PROVEEDOR)
  const tarjeta = page.locator('div').filter({ hasText: PROVEEDOR }).filter({ has: page.getByTitle('Ver productos') }).last()
  await tarjeta.getByTitle('Ver productos').click()
  await expect(page.getByText(/Vinculado —/).first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: /Reenviar acceso por email/ })).toBeVisible()
  await page.getByRole('button', { name: /Copiar link del portal/ }).click()
  await expect(page.getByText(/Link del portal copiado/)).toBeVisible({ timeout: 5000 })
  const copiado = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiado).toMatch(/^https?:\/\/[^\s]+\/portal-proveedores$/)   // solo el link (GO 06/10)
  expect(copiado, 'nunca se copia un link de acceso (token)').not.toMatch(/token|access_token|verify\?/i)
})

test('B · portal sin sesión: "¿Primera vez u olvidaste tu contraseña?" manda un link al correo', async ({ browser }) => {
  test.setTimeout(60_000)
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  try {
    await goto(page, '/portal-proveedores')
    await page.getByRole('button', { name: /Primera vez u olvidaste tu contraseña/ }).click()
    const panel = page.getByTestId('portal-recuperar')
    await panel.getByRole('button', { name: 'Enviarme el link' }).click()
    await expect(panel.getByText('Ingresá tu email')).toBeVisible()   // anti-vacío: sin email no manda nada
    await panel.getByLabel('Tu email').fill(`nadie-${Date.now()}@ejemplo.com`)
    await panel.getByRole('button', { name: 'Enviarme el link' }).click()
    await expect(panel).toContainText(/es un proveedor registrado, te llega un correo/, { timeout: 15000 })
    await panel.getByRole('button', { name: /Volver a ingresar con contraseña/ }).click()
    await expect(page.getByPlaceholder('Contraseña')).toBeVisible()
  } finally {
    await ctx.close()
  }
})
