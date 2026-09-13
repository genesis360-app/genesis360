/**
 * auth.ri.setup.ts
 * Autenticación del DUEÑO de un tenant **Responsable Inscripto** ("Kiosco Buildi" en DEV).
 *
 * 🛑 Por qué hace falta un tenant aparte: el tenant principal de e2e ("Almacén Jorgito") es
 * **Monotributista**, y en Genesis360 un Monotributista **no discrimina IVA crédito** — el bloque
 * de alícuota del formulario de Gastos solo aparece con `esRI && tipo_comprobante === 'Factura A'`.
 * Es decir: con el usuario e2e de siempre, **todo el circuito de IVA crédito es inalcanzable por
 * UI** (el Libro IVA Compras queda siempre vacío y el KPI de crédito siempre en cero).
 *
 * Eso dejaba sin cobertura real de navegador toda la superficie fiscal de compras — incluida la
 * cotización fiscal del gasto en moneda extranjera (mig 414). El spec `86_facturacion_libros_kpis`
 * verifica que esas pantallas *renderizan*, pero sobre un tenant que nunca puede tener un número
 * ahí adentro: un verde que no prueba los importes.
 *
 * Requiere: E2E_MULTICUIT_EMAIL + E2E_MULTICUIT_PASSWORD en .env.test.local (el mismo usuario que
 * ya usa el spec 63 de multi-CUIT, que hasta ahora solo se logueaba por API, nunca por navegador).
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const RI_SESSION_FILE = path.join(__dirname, '.auth/ri_session.json')

setup('autenticar dueño del tenant RI', async ({ page }) => {
  const email    = process.env.E2E_MULTICUIT_EMAIL
  const password = process.env.E2E_MULTICUIT_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Faltan E2E_MULTICUIT_EMAIL y E2E_MULTICUIT_PASSWORD en .env.test.local\n' +
      'Se necesita el DUEÑO de un tenant con condicion_iva_emisor = RI (en DEV: "Kiosco Buildi").'
    )
  }

  fs.mkdirSync(path.dirname(RI_SESSION_FILE), { recursive: true })

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(password)
  await page.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()

  await page.waitForURL('**/dashboard', { timeout: 15000 })
  await page.evaluate(() => {
    localStorage.setItem('genesis360_walkthrough_v1', 'seen')
  })

  await page.context().storageState({ path: RI_SESSION_FILE })
})
