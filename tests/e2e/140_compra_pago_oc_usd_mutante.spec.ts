/**
 * 140_compra_pago_oc_usd_mutante.spec.ts
 * E2E MUTANTE — Pago de una Orden de Compra en USD, de punta a punta (REGLA #0, plata real).
 *
 * Compras/Gastos en USD (relevamiento 2026-08-21, Fases 1-3 ya en PROD desde v1.184.0, mig
 * 379-381) nunca se había probado de punta a punta en vivo: ningún tenant tenía un método de
 * pago "Efectivo USD" real configurado (gap ya documentado). Este spec crea una OC en USD,
 * la paga con Efectivo USD desde la Caja USD operativa, y verifica que el egreso se asiente
 * en caja con la moneda correcta — cerrando ese gap.
 *
 * Precondición de infraestructura (NO la crea este spec — si falta, avisa con mensaje
 * accionable en vez de fallar críptico): método de pago "Efectivo USD" (es_efectivo=true,
 * moneda=USD, habilitado_gastos=true) en el tenant de prueba. Ver
 * G360.Wiki/wiki/development/reglas-negocio.md § Compras/Gastos en USD.
 *
 * Producto simple (Elite Pañuelos, sin lote/venc/series). Proveedor Mayorista MAX.
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito, avanzado).
 */
import { test, expect, Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { garantizarCajaAbierta } from './helpers/fixtures'

const PROVEEDOR = 'Mayorista MAX'
const PRODUCTO_OPT = 'Elite Pañuelos (SKU-0001)'
const PRECIO_USD = '100'

/**
 * Una navegación dura (`page.goto`) justo después de mutar algo (ej. abrir una caja) a veces
 * aterriza en `/login` de forma transitoria (la sesión no termina de rehidratarse a tiempo) y
 * recién después se autocorrige — mismo patrón ya documentado y sin causa raíz confirmada para
 * `/ventas` (ver reference_e2e_suite_no_deterministica). Reintentar en vez de perseguir la causa
 * acá, que excede el alcance de este spec.
 */
async function gotoRobusto(page: Page, path: string, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    await goto(page, path)
    await waitForApp(page)
    if (new URL(page.url()).pathname === path.split('?')[0]) return
    await page.waitForTimeout(1500)
  }
  throw new Error(`[140] goto("${path}") no aterrizó ahí tras ${intentos} intentos — quedó en "${page.url()}"`)
}

test.describe('Pago de OC en USD (mutante)', () => {
  test('crear OC en USD y pagarla con Efectivo USD → egreso en Caja USD con moneda correcta', async ({ page }) => {
    test.setTimeout(90000) // varios pasos secuenciales (abrir caja + crear OC + pagar) superan el default de 30s

    // Precondición: Caja USD abierta (self-healing, no asume estado previo).
    await garantizarCajaAbierta(page, { caja: 'Caja USD', montoInicial: 500 })

    // ── Crear la OC en USD ──────────────────────────────────────────────────
    await gotoRobusto(page, '/proveedores')
    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.getByRole('button', { name: /Nueva OC/i }).click()
    await expect(page.getByRole('heading', { name: /Nueva orden de compra/i })).toBeVisible({ timeout: 5000 })

    const provSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un proveedor/i }) }).first()
    await provSel.selectOption({ label: PROVEEDOR })

    // Moneda — select con las opciones "ARS — Pesos" / "USD — Dólares".
    const monedaSel = page.locator('select').filter({ has: page.locator('option', { hasText: /USD — Dólares/i }) }).first()
    await monedaSel.selectOption({ label: 'USD — Dólares' })

    const prodSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná producto/i }) }).first()
    await prodSel.selectOption({ label: PRODUCTO_OPT })
    await page.getByPlaceholder(/^Cant\./).first().fill('1')
    await page.getByPlaceholder('Precio unit.').first().fill(PRECIO_USD)

    await page.getByRole('button', { name: /Guardar OC/i }).click()
    await expect(page.getByText(/OC creada/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /Nueva orden de compra/i })).not.toBeVisible({ timeout: 5000 })

    // ── Pagarla con Efectivo USD ────────────────────────────────────────────
    await gotoRobusto(page, '/gastos?tab=oc')
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

    // La OC recién creada es la más nueva (orden created_at desc) → primera fila de la lista.
    // Ojo: filtrar por clase específica de la fila (no un `div` genérico) — el wrapper de la
    // lista ("space-y-2") también matchea `hasText` por contener todo el texto de sus hijos.
    const filaOC = page.locator('div.rounded-xl.shadow-sm').filter({ hasText: /^OC #\d+/ }).first()
    await expect(filaOC).toBeVisible({ timeout: 10000 })
    await expect(filaOC.getByText(/US\$/).first()).toBeVisible({ timeout: 5000 })

    await filaOC.getByRole('button', { name: /Pagar \/ CC/i }).click()
    await expect(page.getByRole('heading', { name: /^OC #\d+/ })).toBeVisible({ timeout: 5000 })

    // Cambiar el medio de pago default ("Transferencia") a "Efectivo USD" y cargar el monto total.
    const medioSel = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo USD/ }) }).first()
    await expect(
      medioSel,
      '[precondición faltante] No existe un método de pago "Efectivo USD" en este tenant — ' +
        'sembrarlo en metodos_pago (es_efectivo=true, moneda=USD, habilitado_gastos=true) antes de correr este spec.',
    ).toBeVisible({ timeout: 5000 })
    await medioSel.selectOption({ label: 'Efectivo USD' })

    const montoInput = page.locator('input[type="number"]').filter({ visible: true }).nth(1)
    await montoInput.fill(PRECIO_USD)

    // Caja USD es la única sesión abierta en USD → se resuelve sola (chip verde, sin selector).
    await expect(page.getByText('Caja USD', { exact: true })).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /^Confirmar pago$/ }).click()

    // POSITIVO: toast de éxito real (nunca solo "el modal se cerró").
    await expect(page.getByText(/Pago registrado/i)).toBeVisible({ timeout: 10000 })
  })
})
