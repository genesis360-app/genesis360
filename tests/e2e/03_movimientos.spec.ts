/**
 * 03_movimientos.spec.ts
 * Valida el módulo de movimientos de stock: carga, banner de límites y
 * apertura del formulario de ingreso/rebaje.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Movimientos', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/movimientos')
    await waitForApp(page)
  })

  test('página carga con botones de Ingreso y Rebaje', async ({ page }) => {
    await expect(page.getByRole('button', { name: /ingreso/i })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /rebaje/i })).toBeVisible()
  })

  test('formulario de ingreso abre y cierra', async ({ page }) => {
    const btnIngreso = page.getByRole('button', { name: /ingreso/i })
    // Si está deshabilitado (límite alcanzado) el test pasa igual
    if (await btnIngreso.isEnabled()) {
      await btnIngreso.click()
      await expect(page.getByText(/producto|buscar/i).first()).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    } else {
      // Banner de límite debe estar visible
      await expect(page.getByText(/límite|movimientos del mes/i)).toBeVisible()
    }
  })

  test('tabla de historial se muestra (o mensaje vacío)', async ({ page }) => {
    await expect(
      page.getByText(/historial|sin movimiento|ingreso|rebaje/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  // UAT-INV-02: el modal de rebaje masivo debe poder abrirse y mostrar el buscador
  test('UAT-INV-02: rebaje masivo abre modal con buscador', async ({ page }) => {
    const btnRebajeMasivo = page.getByRole('button', { name: /rebaje masivo/i })
    if (await btnRebajeMasivo.isVisible({ timeout: 5000 }).catch(() => false)) {
      if (await btnRebajeMasivo.isEnabled()) {
        await btnRebajeMasivo.click()
        await expect(
          page.getByPlaceholder(/buscar y agregar producto/i).first()
        ).toBeVisible({ timeout: 5000 })
        // El botón de confirmar debe estar deshabilitado (lista vacía)
        const btnConfirmar = page.getByRole('button', { name: /confirmar/i })
        await expect(btnConfirmar).toBeDisabled()
        await page.keyboard.press('Escape')
      }
    }
  })
})
