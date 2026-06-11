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

  // v1.51 — el acceso a la cuenta/plan migró del sidebar al menú de avatar.
  // "Perfil" lleva a /mi-cuenta (donde se ve el plan y se gestiona la suscripción).
  test('menú de cuenta da acceso al perfil (/mi-cuenta)', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await page.getByRole('button', { name: /mi cuenta/i }).first().click()
    await page.getByRole('button', { name: /perfil/i }).first().click()
    await expect(page).toHaveURL(/mi-cuenta/, { timeout: 5000 })
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
