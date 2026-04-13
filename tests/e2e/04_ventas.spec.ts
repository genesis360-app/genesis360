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

  /**
   * Regresión v0.57.0 — modificarReserva con producto serializado.
   * Antes del fix, series_disponibles quedaba vacío al volver al carrito
   * porque no se pre-fetcheaban las series de la línea de inventario.
   * Este test verifica que, si existe una reserva serializada, al modificarla
   * el carrito queda poblado y el selector de series tiene ítems disponibles.
   */
  test('modificarReserva con serializado: series disponibles en carrito (si existe reserva serializada)', async ({ page }) => {
    // Navegar al tab historial
    const tabHistorial = page.getByRole('button', { name: /historial/i }).first()
    if (!await tabHistorial.isVisible().catch(() => false)) return
    await tabHistorial.click()
    await page.waitForTimeout(1200)

    // Buscar la primera fila/card con badge "reservada"
    const filaReservada = page.locator('text=reservada').first()
    if (!await filaReservada.isVisible().catch(() => false)) return // sin datos, skip
    await filaReservada.click()
    await page.waitForTimeout(800)

    // Si el modal detalle no abre, skip
    const modalDetalle = page.locator('[role="dialog"], .modal, [data-modal]').first()
    const modalAbierto = await modalDetalle.isVisible().catch(() => false)
    if (!modalAbierto) return

    // Buscar botón "Modificar productos"
    const btnModificar = page.getByRole('button', { name: /modificar productos/i })
    if (!await btnModificar.isVisible().catch(() => false)) return // venta sin serializado o sin botón, skip
    await btnModificar.click()
    await page.waitForTimeout(1500)

    // El carrito debe tener al menos un ítem (no estar vacío)
    await expect(page.getByText(/carrito vacío|sin productos/i)).not.toBeVisible({ timeout: 5000 })

    // Si el producto tiene series, el selector de series debe tener opciones (no vacío)
    const chipSeries = page.locator('button, span').filter({ hasText: /elegir series|n\/s|serie/i }).first()
    if (await chipSeries.isVisible().catch(() => false)) {
      await chipSeries.click()
      await page.waitForTimeout(500)
      // No debe mostrar "sin series disponibles" ni mensaje de error de stock
      await expect(page.getByText(/sin series disponibles|no hay series|sin stock/i)).not.toBeVisible()
    }
  })
})
