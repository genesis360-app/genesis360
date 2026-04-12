/**
 * auth.supervisor.setup.ts
 * Autenticación para tests de rol SUPERVISOR.
 * Requiere: E2E_SUPERVISOR_EMAIL + E2E_SUPERVISOR_PASSWORD en .env.test.local
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SUPERVISOR_SESSION_FILE = path.join(__dirname, '.auth/supervisor_session.json')

setup('autenticar supervisor', async ({ page }) => {
  const email    = process.env.E2E_SUPERVISOR_EMAIL
  const password = process.env.E2E_SUPERVISOR_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_SUPERVISOR_EMAIL y E2E_SUPERVISOR_PASSWORD en .env.test.local\n' +
      'Crear usuario con rol SUPERVISOR en Supabase DEV para el tenant de testing.'
    )
  }

  fs.mkdirSync(path.dirname(SUPERVISOR_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  // SUPERVISOR aterriza en /dashboard (no redirige)
  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: SUPERVISOR_SESSION_FILE })
})
