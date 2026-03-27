/**
 * auth.setup.ts
 * Corre UNA VEZ antes de todos los tests E2E.
 * Hace login y guarda la sesión en .auth/session.json para que los
 * demás tests no tengan que autenticarse de nuevo.
 *
 * Requiere variables de entorno:
 *   E2E_EMAIL    — email del usuario de prueba en DEV
 *   E2E_PASSWORD — contraseña del usuario de prueba
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_FILE = path.join(__dirname, '.auth/session.json')

setup('autenticar usuario de prueba', async ({ page }) => {
  const email    = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan variables de entorno E2E_EMAIL y E2E_PASSWORD.\n' +
      'Copiá tests/e2e/.env.test.example → .env.test.local y completá los valores.'
    )
  }

  // Asegurarse de que el directorio .auth existe
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  // Esperar redirección al dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 })

  // Marcar walkthrough como visto para que no bloquee los tests
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  // Guardar sesión (cookies + localStorage de Supabase)
  await page.context().storageState({ path: SESSION_FILE })
})
