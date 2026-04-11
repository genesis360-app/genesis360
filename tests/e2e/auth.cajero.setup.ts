/**
 * auth.cajero.setup.ts
 * Autenticación para tests de rol CAJERO.
 * Requiere: E2E_CAJERO_EMAIL + E2E_CAJERO_PASSWORD en .env.test.local
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CAJERO_SESSION_FILE = path.join(__dirname, '.auth/cajero_session.json')

setup('autenticar cajero', async ({ page }) => {
  const email    = process.env.E2E_CAJERO_EMAIL
  const password = process.env.E2E_CAJERO_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_CAJERO_EMAIL y E2E_CAJERO_PASSWORD en .env.test.local\n' +
      'Usuario de prueba: cajero1@local.com'
    )
  }

  fs.mkdirSync(path.dirname(CAJERO_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  await page.waitForURL('**/ventas', { timeout: 15000 }) // CAJERO redirige a /ventas
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: CAJERO_SESSION_FILE })
})
