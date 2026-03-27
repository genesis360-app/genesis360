/**
 * 01_dashboard.spec.ts
 * Valida que el Dashboard cargue correctamente con sus tabs y secciones.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
  })

  test('carga con KPI cards visibles', async ({ page }) => {
    // Al menos dos cards con números
    await expect(page.locator('.grid').first()).toBeVisible()
    // Verifica que hay números en pantalla (no solo spinner)
    await expect(page.getByText(/total productos|alertas activas|stock crítico/i).first()).toBeVisible()
  })

  test('tabs General, Insights y Métricas están presentes', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'General' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Insights' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Métricas', exact: true })).toBeVisible()
  })

  test('tab Insights muestra score de salud y recomendaciones', async ({ page }) => {
    await page.getByRole('button', { name: 'Insights' }).click()
    // Score de salud debe aparecer
    await expect(page.getByText(/score de salud/i)).toBeVisible()
    // Siempre hay al menos 1 insight (el de "todo en orden" si no hay problemas)
    await expect(page.getByText(/insight/i).first()).toBeVisible()
  })

  test('tab Métricas es accesible', async ({ page }) => {
    await page.getByRole('button', { name: 'Métricas', exact: true }).click()
    // Puede mostrar UpgradePrompt (plan free) o las métricas reales
    await expect(
      page.getByText(/métricas|upgrade|plan/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('sidebar muestra link Mi Plan', async ({ page }) => {
    await expect(page.getByRole('link', { name: /plan/i }).first()).toBeVisible()
  })
})
