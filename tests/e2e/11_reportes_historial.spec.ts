/**
 * 11_reportes_historial.spec.ts
 * Valida reportes e historial (pueden estar bloqueados por plan).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Reportes', () => {
  test('página carga (plan permite o muestra UpgradePrompt)', async ({ page }) => {
    await goto(page, '/reportes')
    await waitForApp(page)
    await expect(
      page.getByText(/reporte|exportar|upgrade|plan/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Historial de actividad', () => {
  test('página carga (plan permite o muestra UpgradePrompt)', async ({ page }) => {
    await goto(page, '/historial')
    await waitForApp(page)
    await expect(
      page.getByText(/historial|actividad|upgrade|plan/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Recomendaciones', () => {
  test('página /recomendaciones carga con score e insights', async ({ page }) => {
    await goto(page, '/recomendaciones')
    await waitForApp(page)
    await expect(
      page.getByText(/recomendac|score|salud/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})
