/**
 * auth.fotranto-sup.setup.ts
 * Autenticación SUPERVISOR del tenant "Familia Otranto De Porto" (DEV) — tenant SIN clave maestra.
 * Se usa para validar el comportamiento SIN clave (H3): donde hay un límite numérico (tope de
 * descuento) y NO hay clave configurada, la acción se BLOQUEA sin posibilidad de override.
 * Requiere: E2E_FOTRANTO_SUP_EMAIL + E2E_FOTRANTO_SUP_PASSWORD en .env.test.local.
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FOTRANTO_SUP_SESSION_FILE = path.join(__dirname, '.auth/fotranto_sup_session.json')

setup('autenticar supervisor (Familia Otranto, sin clave)', async ({ page }) => {
  const email    = process.env.E2E_FOTRANTO_SUP_EMAIL
  const password = process.env.E2E_FOTRANTO_SUP_PASSWORD
  if (!email || !password) {
    throw new Error('Faltan E2E_FOTRANTO_SUP_EMAIL y E2E_FOTRANTO_SUP_PASSWORD en .env.test.local')
  }

  fs.mkdirSync(path.dirname(FOTRANTO_SUP_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))

  await page.context().storageState({ path: FOTRANTO_SUP_SESSION_FILE })
})
