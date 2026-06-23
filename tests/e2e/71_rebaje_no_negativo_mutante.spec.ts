/**
 * 71_rebaje_no_negativo_mutante.spec.ts
 * E2E MUTANTE — Rebaje de stock no puede dejar disponible negativo (REGLA #0, stock).
 *
 * L02 (`InventarioPage.rebajeMutation` ~1174-1175): antes de mutar, valida que la cantidad a rebajar no
 * supere `cantidad − cantidad_reservada` de la línea; si la supera → "Stock disponible insuficiente: N u.",
 * y NO toca `inventario_lineas` ni `movimientos_stock`. Rebajar más de lo disponible dejaría stock
 * negativo / sacaría stock reservado → cero error tolerado.
 *
 * Datos reales (Almacén Jorgito, NO fixture): se elige un producto con stock y se intenta rebajar una
 * cantidad enorme (9.999.999) → el guard bloquea. Read-only: el bloqueo precede a cualquier insert →
 * NO muta. Skip-guards si no hay producto/línea. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const PRODUCTO = 'Coca Cola 1.5'

test.describe('Rebaje de stock no negativo (mutante)', () => {
  test('rebajar 9.999.999 (> disponible) → "Stock disponible insuficiente", no muta', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/inventario')
    await waitForApp(page)

    // Tab "Quitar stock" → botón "Rebaje" abre el modal
    await page.getByRole('button', { name: /Quitar stock/i }).first().click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^Rebaje$/ }).click()
    await page.waitForTimeout(400)

    // Buscar y elegir el producto (DENTRO del modal de rebaje, no el buscador de la tab)
    const modal = page.locator('.fixed.inset-0').filter({ has: page.getByRole('heading', { name: /Rebaje de stock/i }) })
    const search = modal.getByPlaceholder(/Buscar por nombre, SKU o código/i)
    await expect(search).toBeVisible({ timeout: 6000 })
    await search.fill(PRODUCTO)
    await page.waitForTimeout(800)
    const prodBtn = modal.locator('button').filter({ hasText: new RegExp(PRODUCTO, 'i') }).first()
    if (!(await prodBtn.isVisible().catch(() => false))) {
      test.skip(true, `Producto "${PRODUCTO}" no encontrado para rebajar`)
    }
    await prodBtn.click()
    await page.waitForTimeout(700)

    // Elegir la primera línea con stock (habilita "Confirmar rebaje")
    const linea = modal.locator('div.space-y-2 > button').first()
    if (!(await linea.isVisible().catch(() => false))) {
      test.skip(true, 'No hay líneas con stock para el producto')
    }
    await linea.click()
    await page.waitForTimeout(400)

    // Cantidad enorme → supera lo disponible
    const cantInput = page.locator('input[type="number"]').last()
    await cantInput.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '9999999')

    // Confirmar rebaje → guard de stock disponible
    await page.getByRole('button', { name: /Confirmar rebaje/i }).click()
    await expect(page.getByText(/Stock disponible insuficiente/i)).toBeVisible({ timeout: 8000 })
  })
})
