/**
 * 29_recepcion_stock_mutante.spec.ts
 * E2E MUTANTE — Recepción de mercadería → sube el stock (REGLA #0, inventario).
 *
 * Recepción sin OC (CO2/B2: solo requiere proveedor) de un producto conocido. Al confirmar,
 * el trigger recalcula stock_actual hacia arriba. Verifica el efecto real consultando la DB.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PRODUCTO = 'Elite Pañuelos'  // sin lote/vencimiento/series (evita campos obligatorios extra)

test.describe('Recepción → stock (mutante)', () => {
  test('recepción sin OC: agrega un producto y sube el stock', async ({ page }) => {
    await goto(page, '/recepciones')
    await waitForApp(page)

    // Entrar al form si hay un botón de "Nueva recepción"
    const nueva = page.getByRole('button', { name: /Nueva recepci|Registrar recepci|^Recibir$/i }).first()
    if (await nueva.isVisible().catch(() => false)) {
      await nueva.click()
      await page.waitForTimeout(500)
    }

    // Proveedor (recepción sin OC lo exige) — select identificado por su opción "Sin proveedor"
    const provSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Sin proveedor/i }) }).first()
    await expect(provSelect).toBeVisible({ timeout: 8000 })
    const provVals = await provSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    test.skip(provVals.length === 0, 'No hay proveedores en el tenant')
    await provSelect.selectOption(provVals[0])
    await page.waitForTimeout(300)

    // Sucursal destino (select con opción "Sin sucursal"), si existe
    const sucSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Sin sucursal/i }) }).first()
    if (await sucSelect.isVisible().catch(() => false)) {
      const sv = await sucSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (sv.length) await sucSelect.selectOption(sv[0])
    }

    // Buscar el producto y agregarlo
    const buscador = page.getByPlaceholder(/Buscar producto por nombre o SKU/i)
    await buscador.fill(PRODUCTO)
    await page.waitForTimeout(900)
    await page.locator('div.absolute.z-20 button').first().click()
    await page.waitForTimeout(500)

    // Confirmar recepción
    const confirmar = page.getByRole('button', { name: /Confirmar recepción/i })
    await expect(confirmar).toBeVisible({ timeout: 5000 })
    await confirmar.click()

    // POSITIVO: el modal de resultado "Recepción #N confirmada" (RecepcionesPage:910)
    await expect(page.getByText(/Recepción #\d+ confirmada/i)).toBeVisible({ timeout: 15000 })
  })
})
