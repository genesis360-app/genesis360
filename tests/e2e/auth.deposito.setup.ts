/**
 * auth.deposito.setup.ts
 * Autenticación para tests de rol DEPOSITO.
 * Requiere: E2E_DEPOSITO_EMAIL + E2E_DEPOSITO_PASSWORD en .env.test.local
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DEPOSITO_SESSION_FILE = path.join(__dirname, '.auth/deposito_session.json')

setup('autenticar deposito', async ({ page }) => {
  const email    = process.env.E2E_DEPOSITO_EMAIL
  const password = process.env.E2E_DEPOSITO_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_DEPOSITO_EMAIL y E2E_DEPOSITO_PASSWORD en .env.test.local\n' +
      'Usuario de prueba sugerido: deposito1@local.com'
    )
  }

  fs.mkdirSync(path.dirname(DEPOSITO_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  await page.waitForURL('**/inventario', { timeout: 15000 }) // DEPOSITO redirige a /inventario
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: DEPOSITO_SESSION_FILE })
})
