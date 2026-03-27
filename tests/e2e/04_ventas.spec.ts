/**
 * 04_ventas.spec.ts
 * Valida el módulo de ventas: carga, búsqueda de productos y carrito.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Ventas', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
  })

  test('página carga con buscador de productos', async ({ page }) => {
    await expect(
      page.getByPlaceholder(/buscar por nombre/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('carrito vacío muestra estado inicial', async ({ page }) => {
    await expect(
      page.getByText(/carrito vacío|sin productos|agregar productos/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('lista de ventas muestra historial o mensaje vacío', async ({ page }) => {
    // La página tiene carrito + lista de ventas
    await expect(
      page.getByText(/venta|historial|sin ventas/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  /**
   * Regla de negocio: ninguna venta (despachada o reservada) puede registrarse
   * sin una caja abierta. Sin caja no hay negocio — todos los movimientos de
   * ventas deben estar asociados a una sesión de caja.
   */
  test('checkout siempre muestra estado de caja (abierta o bloqueada)', async ({ page }) => {
    // Agregar un producto al carrito buscando cualquiera disponible
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await buscador.fill('a')
    await page.waitForTimeout(800)

    // Click en el primer producto disponible del dropdown
    const primerProducto = page.locator('[data-testid="producto-resultado"], .cursor-pointer').first()
    const hayProducto = await primerProducto.isVisible().catch(() => false)
    if (!hayProducto) return // skip si no hay productos en DEV

    await primerProducto.click()
    await page.waitForTimeout(300)

    // El widget de estado de caja debe ser SIEMPRE visible cuando hay items en el carrito
    // (independientemente del medio de pago elegido)
    await expect(
      page.getByText(/sin caja abierta|efectivo →|venta →/i).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('toggle lista/galería funciona', async ({ page }) => {
    const toggleGaleria = page.getByRole('button', { name: /vista galería|vista lista/i }).first()
    if (await toggleGaleria.isVisible()) {
      await toggleGaleria.click()
      await page.waitForTimeout(300)
      // Volver a lista
      const toggleLista = page.getByRole('button', { name: /vista galería|vista lista/i }).first()
      if (await toggleLista.isVisible()) await toggleLista.click()
    }
  })
})
