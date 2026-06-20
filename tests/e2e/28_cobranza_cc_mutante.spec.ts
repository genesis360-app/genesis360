/**
 * 28_cobranza_cc_mutante.spec.ts
 * E2E MUTANTE — Cobranza de cuenta corriente en efectivo (REGLA #0, plata).
 *
 * Cobra una parte de la deuda CC de un cliente en efectivo. La cobranza en efectivo EXIGE
 * caja abierta ANTES de saldar (cobranzaCC.ts `requiereCaja`, v1.69.0) y asienta un `ingreso`
 * en caja. Self-healing: abre Caja1 si está cerrada.
 *
 * Usa el cliente "Gaston Otranto" (tiene deuda CC en el tenant de prueba DEV).
 * Corre con el usuario OWNER (proyecto chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'Gaston Otranto'

test.describe('Cobranza CC efectivo (mutante)', () => {
  test('cobra parte de la deuda CC en efectivo (exige caja → ingreso)', async ({ page }) => {
    // 1) Asegurar caja abierta (la cobranza efectivo la exige)
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

    // 2) Clientes → tab Cuenta Corriente
    await goto(page, '/clientes')
    await waitForApp(page)
    await page.getByRole('button', { name: /Cuenta Corriente/i }).first().click()
    await page.waitForTimeout(800)

    // 3) Card del cliente con deuda → "Registrar pago" (abre el panel inline)
    const card = page.locator('div').filter({ hasText: new RegExp(CLIENTE) })
      .filter({ has: page.getByRole('button', { name: /Registrar pago/i }) }).last()
    test.skip(!(await card.isVisible().catch(() => false)), `${CLIENTE} no tiene deuda CC en el tenant`)
    await card.getByRole('button', { name: /Registrar pago/i }).first().click()

    // El panel se abrió si aparece "Confirmar pago" (aserción positiva, evita falso-verde)
    await expect(page.getByRole('button', { name: /Confirmar pago/i })).toBeVisible({ timeout: 5000 })

    // 4) Monto parcial + Efectivo (default) + confirmar
    const montoInput = page.locator('xpath=//label[contains(.,"Monto")]/following::input[1]')
    await montoInput.fill('100')
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Confirmar pago/i }).click()

    // 5) POSITIVO: toast "Pago de $… registrado" + NO error de caja exigida
    await expect(page.getByText(/Pago de .* registrado/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Abrí una caja antes de cobrar/i)).not.toBeVisible()
  })
})
