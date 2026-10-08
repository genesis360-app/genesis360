/**
 * 189_inventario_sigue_sucursal.spec.ts
 * Productos e Inventario siguen el selector de sucursal del encabezado (pedido de GO 2026-10-08).
 *
 * - Inventario con una sucursal elegida: solo los productos con stock EN ESA sucursal; los demás quedan ocultos con un
 *   aviso "N productos sin stock en esta sucursal no se muestran · Mostrar". "Mostrar" los trae.
 * - Productos con una sucursal elegida: el número chico de la fila es "X en la sucursal", nunca el "X total" de todas.
 *
 * Solo lectura. Corre con OWNER (chromium) contra DEV (Almacén Jorgito, Sucursal Norte).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('Productos e Inventario siguen la sucursal del encabezado', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
  })

  test('Inventario con una sucursal: oculta los productos sin stock ahí y "Mostrar" los trae', async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
    const aviso = page.getByTestId('inv-ocultos-sin-stock')
    await expect(aviso, 'el catálogo de prueba tiene productos sin stock en Norte: tenía que avisar que están ocultos').toBeVisible({ timeout: 15000 })
    const ocultos = Number((await aviso.textContent())?.match(/(\d+)/)?.[1] ?? 0)
    expect(ocultos).toBeGreaterThan(0)

    await aviso.getByRole('button', { name: 'Mostrar' }).click()
    await expect(aviso).toBeHidden()
  })

  test('Productos con una sucursal: la fila nunca muestra el "total" de todas las sucursales', async ({ page }) => {
    await goto(page, '/productos')
    await waitForApp(page)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/^\d+(\.\d+)? total$/)).toHaveCount(0)
  })
})
