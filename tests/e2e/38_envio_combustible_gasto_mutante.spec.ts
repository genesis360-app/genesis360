/**
 * 38_envio_combustible_gasto_mutante.spec.ts
 * E2E MUTANTE — Envío propio → combustible → genera un gasto (REGLA #0, contable).
 *
 * En un envío propio con vehículo asignado, "Registrar combustible" (EN7/G2,
 * `EnviosPage.registrarCombustible`) inserta un gasto en `gastos` (categoría Combustible,
 * estado_pago 'pagado', IVA crédito) + suma KM al vehículo + vincula `envios.gasto_combustible_id`.
 *
 * Aserción POSITIVA (toast "Combustible registrado como gasto"); el gasto + el link en el envío
 * se verifican aparte con execute_sql.
 *
 * Requiere un envío propio con `recurso_id` (fixture: envío #15 con un vehículo). La fila del
 * envío se expande (chevron) para ver las acciones. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Envío propio → combustible → gasto (mutante)', () => {
  test('registrar combustible de un envío propio genera el gasto', async ({ page }) => {
    await goto(page, '/envios')
    await waitForApp(page)

    // Tab Envíos (suele ser el default; lo aseguramos)
    const tabEnvios = page.getByRole('button', { name: /^Env[ií]os$/ }).first()
    if (await tabEnvios.isVisible().catch(() => false)) {
      await tabEnvios.click()
      await page.waitForTimeout(500)
    }

    // Expandir la fila del envío #15 (chevron = primer botón de la fila)
    const fila = page.locator('tr', { hasText: /#15\b/ }).first()
    await expect(fila).toBeVisible({ timeout: 8000 })
    await fila.getByRole('button').first().click()
    await page.waitForTimeout(500)

    // "Registrar combustible" (único — solo el envío con vehículo lo muestra)
    const btnComb = page.getByRole('button', { name: /Registrar combustible/i })
    await expect(btnComb).toBeVisible({ timeout: 5000 })
    await btnComb.click()

    // Modal: monto del gasto
    await expect(page.getByRole('heading', { name: /Registrar combustible/i })).toBeVisible({ timeout: 5000 })
    await page.locator('xpath=//label[contains(.,"Monto del gasto")]/following::input[1]').fill('5000')
    await page.waitForTimeout(200)

    // Confirmar
    await page.getByRole('button', { name: /Registrar gasto/i }).click()

    // POSITIVO: toast de combustible registrado como gasto
    await expect(page.getByText(/Combustible registrado como gasto/i)).toBeVisible({ timeout: 12000 })
  })
})
