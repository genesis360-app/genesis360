/**
 * 40_cc_incobrable_clave_maestra_mutante.spec.ts
 * E2E MUTANTE — Dar de baja incobrable con clave maestra (REGLA #0, contable + control).
 *
 * B6 (`ClientesPage.confirmarIncobrable`): da por PERDIDA toda la deuda CC pendiente del cliente,
 * exige la **clave maestra** del dueño (`verificar_clave_maestra`), marca cada venta con el tag
 * 'Incobrable' (monto_pagado=total) y genera un gasto automático "Deudor incobrable: …" en la
 * categoría "Deudores incobrables" (la pérdida, para el contador). Solo DUEÑO/SUPER_USUARIO/ADMIN.
 *
 * Aserción POSITIVA (toast "Deuda dada de baja como incobrable"); el gasto + las ventas saldadas
 * se verifican aparte con execute_sql.
 *
 * Clave maestra real del tenant de prueba = "12345678" (hasheada con bcrypt, mig 233). Usa "Gaston Otranto" (deuda CC pendiente).
 * Corre con OWNER=DUEÑO (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'Gaston Otranto'
const CLAVE_MAESTRA = '12345678'

test.describe('Incobrable con clave maestra (mutante)', () => {
  test('dar de baja incobrable → salda la deuda + gasto de pérdida (clave maestra)', async ({ page }) => {
    await goto(page, '/clientes')
    await waitForApp(page)

    await page.getByRole('button', { name: /Cuenta Corriente/i }).first().click()
    await page.waitForTimeout(800)

    // Card del cliente → botón "Incobrable"
    const card = page.locator('div').filter({ hasText: new RegExp(CLIENTE) })
      .filter({ has: page.getByRole('button', { name: /Incobrable/i }) }).last()
    test.skip(!(await card.isVisible().catch(() => false)), `${CLIENTE} sin deuda CC para dar de baja`)
    await card.getByRole('button', { name: /Incobrable/i }).first().click()

    // Modal B6
    await expect(page.getByRole('heading', { name: /Dar de baja incobrable/i })).toBeVisible({ timeout: 5000 })
    await page.getByPlaceholder(/quiebra|ilocalizable/i).fill('Test e2e — baja incobrable')
    await page.locator('input[type="password"]').first().fill(CLAVE_MAESTRA)
    await page.getByRole('button', { name: /Confirmar baja/i }).click()

    // POSITIVO: toast de baja incobrable + sin error de clave
    await expect(page.getByText(/Deuda dada de baja como incobrable/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Clave maestra incorrecta/i)).not.toBeVisible()
  })
})
