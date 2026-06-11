/**
 * 03_movimientos.spec.ts
 * Movimientos de stock (ingreso / rebaje). La ruta /movimientos quedó HUÉRFANA:
 * desde v1.x redirige a /inventario (App.tsx: <Navigate to="/inventario" replace />).
 * El flujo real de movimientos vive en los tabs "Agregar stock" / "Quitar stock"
 * de InventarioPage. Estos tests validan tanto el redirect como el flujo real.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Movimientos de stock', () => {
  test('/movimientos redirige a /inventario', async ({ page }) => {
    await goto(page, '/movimientos')
    await waitForApp(page)
    await expect(page).toHaveURL(/\/inventario/, { timeout: 8000 })
  })

  test('tab "Agregar stock" abre el buscador de producto', async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: /agregar stock/i }).click()
    await expect(
      page.getByPlaceholder(/buscar por producto|buscar.*sku|escanear o buscar/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('tab "Quitar stock" abre el buscador de producto', async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: /quitar stock/i }).click()
    await expect(
      page.getByPlaceholder(/buscar/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('tabla/historial de inventario se muestra (o estado vacío)', async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
    await expect(
      page.getByText(/inventario|producto|sin datos|no hay productos|historial/i).first()
    ).toBeVisible({ timeout: 8000 })
  })
})
