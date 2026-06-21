/**
 * 32_caja_fuerte_deposito_mutante.spec.ts
 * E2E MUTANTE — Depósito de una caja operativa a la Caja Fuerte / Bóveda (REGLA #0, contable).
 *
 * Mover plata de una caja a la bóveda DEBE generar las dos patas balanceadas
 * (CajaPage.operarCajaFuerte):
 *   - egreso_traspaso en la sesión de la caja origen (sale el efectivo),
 *   - ingreso_traspaso en la sesión permanente de la bóveda (entra el efectivo).
 *
 * El click-through de Caja Fuerte estaba pendiente (antes solo validado a nivel DB). Aserción
 * POSITIVA (toast "Depositado en caja fuerte") + las dos patas se verifican aparte con
 * execute_sql usando un concepto único.
 *
 * Self-healing: abre Caja1 si está cerrada (necesaria como origen con saldo). Corre con el
 * usuario OWNER (proyecto chromium) contra el tenant de prueba DEV (Almacén Jorgito, avanzado).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Depósito a Caja Fuerte (mutante)', () => {
  test('depositar desde una caja a la bóveda genera egreso + ingreso de traspaso', async ({ page }) => {
    const concepto = `DepFuerte_${Date.now()}` // único → identifica las dos patas en DB

    // 1) Asegurar Caja1 abierta (origen con saldo)
    await goto(page, '/caja')
    await waitForApp(page)
    const pill = page.getByRole('button', { name: /Caja1\b/ }).first()
    if (await pill.isVisible().catch(() => false)) {
      await pill.click()
      await page.waitForTimeout(400)
      const abrir = page.getByRole('button', { name: /^Abrir caja$/ }).first()
      if (await abrir.isVisible().catch(() => false)) {
        await abrir.click()
        await page.waitForTimeout(400)
        await page.locator('xpath=//label[contains(.,"Monto inicial")]/following::input[1]').fill('5000')
        await page.getByRole('button', { name: /Confirmar apertura|Sí, abrir con diferencia/ }).first().click()
        await page.waitForTimeout(500)
        const dif = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
        if (await dif.isVisible().catch(() => false)) await dif.click()
        await page.waitForTimeout(500)
      }
    }

    // 2) Tab Caja Fuerte
    await page.getByRole('button', { name: /^Caja Fuerte$/ }).first().click()
    await page.waitForTimeout(800)

    // 3) Abrir "Ingresar a Caja Fuerte"
    await page.getByRole('button', { name: /Ingresar a Caja Fuerte/i }).click()
    await expect(page.getByRole('heading', { name: /Ingresar a Caja Fuerte/i })).toBeVisible({ timeout: 5000 })

    // 4) Caja de origen = Caja1 (select identificado por la opción "Ingreso externo")
    const origen = page.locator('select').filter({ has: page.locator('option', { hasText: /Ingreso externo/i }) }).first()
    const cajaOpt = origen.locator('option', { hasText: /Caja1/ }).first()
    await expect(cajaOpt).toHaveCount(1, { timeout: 5000 })
    const origenVal = await cajaOpt.getAttribute('value')
    test.skip(!origenVal, 'Caja1 no aparece como sesión abierta')
    await origen.selectOption(origenVal!)
    await page.waitForTimeout(300)

    // 5) Monto + concepto único (Cuenta de destino queda en Efectivo por default)
    await page.locator('xpath=//label[contains(.,"Monto *")]/following::input[1]').fill('50')
    await page.getByPlaceholder(/Depósito desde caja/i).fill(concepto)

    // 6) Confirmar
    await page.getByRole('button', { name: /Confirmar ingreso/i }).click()

    // 7) POSITIVO: toast de depósito + sin error de saldo insuficiente
    await expect(page.getByText(/Depositado en caja fuerte/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Saldo insuficiente/i)).not.toBeVisible()
  })
})
