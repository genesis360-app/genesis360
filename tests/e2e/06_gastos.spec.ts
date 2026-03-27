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
})
