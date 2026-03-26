/**
 * 09_suscripcion_plan.spec.ts
 * Valida acceso a la página de suscripción y visibilidad del plan.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Suscripción / Mi Plan', () => {
  test('página /suscripcion es accesible directamente', async ({ page }) => {
    await goto(page, '/suscripcion')
    await waitForApp(page)
    await expect(
      page.getByText(/plan|suscripción|free|básico|pro/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('sidebar tiene link "Mi Plan" que lleva a /suscripcion', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    const linkPlan = page.getByRole('link', { name: /plan/i }).first()
    await expect(linkPlan).toBeVisible()
    await linkPlan.click()
    await expect(page).toHaveURL(/suscripcion/, { timeout: 5000 })
  })

  test('muestra información del plan actual', async ({ page }) => {
    await goto(page, '/suscripcion')
    await waitForApp(page)
    // Debe mostrar alguno de los planes conocidos
    await expect(
      page.getByText(/free|básico|pro|enterprise/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})
