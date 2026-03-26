/**
 * 07_alertas.spec.ts
 * Valida la página de alertas de stock.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Alertas', () => {
  test('página carga y muestra alertas o estado vacío', async ({ page }) => {
    await goto(page, '/alertas')
    await waitForApp(page)
    await expect(
      page.getByText(/alerta|stock mínimo|sin alertas|todo bien/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})
