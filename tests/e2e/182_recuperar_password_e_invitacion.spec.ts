/**
 * 182_recuperar_password_e_invitacion.spec.ts
 * E2E — Acceso por correo (2026-10-05, caso El Tilo con Hotmail).
 *
 * El link de invitación iniciaba sesión UNA vez y nunca pedía contraseña; sin Google, el invitado no podía volver a
 * entrar, y el login no tenía "¿Olvidaste tu contraseña?". Arreglo: invite-user crea al invitado con
 * `debe_cambiar_password` (el AuthGuard le pide elegirla, mig 471 marca a los que ya existían), "¿Olvidaste tu
 * contraseña?" en el login + /restablecer-contrasena, y aviso de dominio mal tipeado al invitar.
 *
 * Lo que NO cubre (DEV no tiene SMTP propio: los correos solo llegan al equipo): el correo real y su link. La pantalla
 * de contraseña del invitado se verificó a mano en DEV marcando un usuario de prueba (UAT §100).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Recuperar contraseña e invitaciones', () => {
  test('"¿Olvidaste tu contraseña?" responde lo mismo exista o no el correo; los sin correo van al dueño', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' })
    const page = await ctx.newPage()
    await page.goto('/login')
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
    await page.locator('#recuperar-email').fill(`nadie-${Date.now()}@ejemplo.com`)
    await page.getByRole('button', { name: 'Mandarme el link' }).click()
    await expect(page.getByTestId('recuperar-password')).toContainText(/te llega un correo con un link/, { timeout: 15000 })

    await page.getByRole('button', { name: 'Volver al ingreso' }).click()
    await page.getByRole('button', { name: /entrar con usuario/ }).click()
    await expect(page.getByText(/Pedile al dueño del negocio que te genere una nueva/)).toBeVisible()
    await expect(page.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toHaveCount(0)
    await ctx.close()
  })

  test('/restablecer-contrasena sin un link válido explica que venció y lleva al ingreso', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' })
    const page = await ctx.newPage()
    await page.goto('/restablecer-contrasena')
    await expect(page.getByTestId('restablecer-vencido')).toBeVisible({ timeout: 10000 })
    await page.getByRole('link', { name: 'Ir al ingreso' }).click()
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('al invitar, un dominio mal tipeado ofrece la corrección (el caso outloock.com)', async ({ page }) => {
    await goto(page, '/usuarios')
    await waitForApp(page)
    await page.getByRole('button', { name: /Agregar usuario/ }).first().click()
    await page.getByRole('button', { name: /Con email/ }).first().click()
    const correo = page.getByPlaceholder('usuario@email.com')
    await expect(correo).toBeVisible({ timeout: 8000 })
    await correo.fill('juan@outloock.com')
    const sugerencia = page.getByTestId('sugerencia-correo')
    await expect(sugerencia).toContainText('juan@outlook.com')
    await sugerencia.getByRole('button').click()
    await expect(correo).toHaveValue('juan@outlook.com')
    await expect(sugerencia).toHaveCount(0)
  })
})
