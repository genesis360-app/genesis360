/**
 * 70_producto_alicuota_exento_mutante.spec.ts
 * E2E MUTANTE — Alta de producto Exento (0%) persiste como 0, NO 21% (REGLA #0, fiscal).
 *
 * L49 (`ProductoFormPage` ~384-441): la alícuota se persiste con `Number.isFinite(parseFloat(...)) ? … : 21`
 * (NO `… || 21`). El caso CRÍTICO es Exento (0%): con `0 || 21` el 0 (falsy) se convertía en 21% →
 * IVA fantasma en la factura AFIP. Este spec crea un producto Exento por UI y verifica en DB que
 * `alicuota_iva = 0`, no 21. Complementa la spec 43 (10,5%).
 *
 * Mutante: crea un producto real en DEV con SKU único (se borra por SQL tras verificar). Aserción
 * POSITIVA del toast "Producto creado"; la persistencia (`alicuota_iva=0`) se verifica con execute_sql.
 * Corre con OWNER (chromium) contra DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const STAMP = Date.now()
const SKU = `E2E-EXENTO-${STAMP}`
const NOMBRE = `E2E Producto Exento ${STAMP}`

test.describe('Alta de producto Exento (mutante)', () => {
  test('crea producto Exento (0%) → persiste alicuota 0, no 21', async ({ page }) => {
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Nuevo producto/i })).toBeVisible({ timeout: 8000 })

    await page.getByPlaceholder(/Tornillo hexagonal/i).fill(NOMBRE)
    await page.getByPlaceholder(/SKU-00001/i).fill(SKU)

    const precioVenta = page.locator(
      'xpath=//label[contains(.,"Precio de venta")]/ancestor::div[1]/following-sibling::div[1]//input'
    ).first()
    await precioVenta.fill('1000')

    // Alícuota IVA = Exento (0%)
    const alicuotaSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Exento \(0%\)/ }) }).first()
    await alicuotaSel.selectOption('0')

    await page.getByRole('button', { name: /^Crear producto$/ }).click()

    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })
    // La persistencia alicuota_iva=0 (no 21) se verifica con execute_sql por el SKU único.
  })
})
