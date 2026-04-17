/**
 * 06_gastos.spec.ts
 * Valida el módulo de gastos.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Gastos', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/gastos')
    await waitForApp(page)
  })

  test('página carga con botón de nuevo gasto', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /nuevo gasto/i })
    ).toBeVisible({ timeout: 8000 })
  })

  test('lista de gastos o mensaje vacío está visible', async ({ page }) => {
    await expect(
      page.getByText(/gasto|sin gastos/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('formulario nuevo gasto abre correctamente', async ({ page }) => {
    await page.getByRole('button', { name: /nuevo gasto/i }).click()
    await expect(
      page.getByPlaceholder(/pago de alquiler|detalles/i).first()
    ).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
  })

  // UAT-GAS-01: medio de pago no debe tener "Efectivo" preseleccionado
  test('UAT-GAS-01: formulario nuevo gasto abre sin medio de pago preseleccionado', async ({ page }) => {
    await page.getByRole('button', { name: /nuevo gasto/i }).click()
    await page.waitForTimeout(300)

    // El select de medio de pago debe tener valor vacío (placeholder "Elegir método…")
    const selectMedio = page.locator('select').filter({ hasText: /elegir método|efectivo|tarjeta/i }).first()
    if (await selectMedio.isVisible({ timeout: 3000 }).catch(() => false)) {
      const valor = await selectMedio.inputValue()
      expect(valor).toBe('')
    }
    await page.keyboard.press('Escape')
  })
})
