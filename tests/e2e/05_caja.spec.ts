/**
 * 05_caja.spec.ts
 * Valida el módulo de caja: estado, apertura de sesión.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Caja', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/caja')
    await waitForApp(page)
  })

  test('página carga y muestra estado de caja', async ({ page }) => {
    // Debe mostrar "Caja abierta", "Caja cerrada" o botón de abrir
    await expect(
      page.getByText(/caja abierta|caja cerrada|abrir caja|nueva sesión/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('saldo y movimientos visibles cuando hay sesión abierta', async ({ page }) => {
    const cajaAbierta = await page.getByText(/caja abierta/i).isVisible()
    if (cajaAbierta) {
      // Debe mostrar saldo
      await expect(page.getByText(/saldo/i).first()).toBeVisible()
    }
  })

  test('formulario de apertura es accesible cuando caja está cerrada', async ({ page }) => {
    const btnAbrir = page.getByRole('button', { name: /abrir caja|nueva sesión/i })
    if (await btnAbrir.isVisible()) {
      await btnAbrir.click()
      await expect(page.getByText(/apertura|saldo inicial/i).first()).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    }
  })
})
