/**
 * auth.rrhh.setup.ts
 * Autenticación para tests de rol RRHH.
 * Requiere: E2E_RRHH_EMAIL + E2E_RRHH_PASSWORD en .env.test.local
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const RRHH_SESSION_FILE = path.join(__dirname, '.auth/rrhh_session.json')

setup('autenticar rrhh', async ({ page }) => {
  const email    = process.env.E2E_RRHH_EMAIL
  const password = process.env.E2E_RRHH_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_RRHH_EMAIL y E2E_RRHH_PASSWORD en .env.test.local\n' +
      'Usuario de prueba: rrhh1@local.com'
    )
  }

  fs.mkdirSync(path.dirname(RRHH_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  // RRHH redirige a /rrhh al iniciar sesión
  await page.waitForURL('**/rrhh', { timeout: 15000 })
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: RRHH_SESSION_FILE })
})
