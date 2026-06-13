/**
 * auth.contador.setup.ts
 * Autenticación para tests de rol CONTADOR.
 * Requiere: E2E_CONTADOR_EMAIL + E2E_CONTADOR_PASSWORD en .env.test.local
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CONTADOR_SESSION_FILE = path.join(__dirname, '.auth/contador_session.json')

setup('autenticar contador', async ({ page }) => {
  const email    = process.env.E2E_CONTADOR_EMAIL
  const password = process.env.E2E_CONTADOR_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_CONTADOR_EMAIL y E2E_CONTADOR_PASSWORD en .env.test.local\n' +
      'Usuario de prueba sugerido: contador1@local.com'
    )
  }

  fs.mkdirSync(path.dirname(CONTADOR_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  await page.waitForURL('**/dashboard', { timeout: 15000 }) // CONTADOR aterriza en /dashboard
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: CONTADOR_SESSION_FILE })
})
