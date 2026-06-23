/**
 * 55_venta_usd_conversion_mutante.spec.ts
 * E2E — Producto en USD se convierte a moneda local a la cotización vigente (REGLA #0, plata).
 *
 * Lógica L41 (`VentasPage` ~1281-1292): si el producto tiene `moneda_venta='usd'` + `precio_usd>0`
 * y el tenant tiene `cotizacion_usd>0`, al agregarlo al carrito su `precio_unitario` se calcula como
 * `round(precio_usd × cotizacion_usd)` (moneda local) y guarda `precio_usd_origen`. Ese precio_unitario
 * alimenta subtotal/IVA/`venta_items` → si la conversión está mal, se vende a un precio equivocado.
 *
 * Valida por UI (sin mutar): al agregar el producto USD, el carrito muestra
 * "Precio USD {origen} · convertido a ${local}". Con `precio_usd=10` y `cotizacion_usd=1430` → $14.300.
 *
 * Fixture SQL (DEV, Almacén Jorgito): se marca temporalmente "Coca Cola 1.5L Original" (CON stock, así
 * aparece en el buscador) como `moneda_venta='usd'` + `precio_usd=10` (se restaura a 'local'/NULL tras
 * correr). La `cotizacion_usd=1430` ya estaba seteada.
 *
 * Re-ejecutable y sin efectos (no completa la venta). Skip-guard si el producto no aparece o el fixture
 * USD no está aplicado. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Venta de producto en USD — conversión a la cotización vigente', () => {
  test('agregar producto USD → precio convertido a moneda local', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('Coca Cola 1.5L')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /Coca Cola 1\.5L/i }).first()
    if (!(await prod.isVisible().catch(() => false))) {
      test.skip(true, 'Producto "Coca Cola 1.5L Original" no disponible en el tenant.')
    }
    await prod.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Si no aparece el indicador USD, el fixture (moneda_venta='usd' + precio_usd) no está aplicado.
    const usdInd = page.getByText(/Precio USD/i).first()
    if (!(await usdInd.isVisible().catch(() => false))) {
      test.skip(true, 'Fixture USD no aplicado (marcar el producto moneda_venta=usd, precio_usd=10) o sin cotización.')
    }
    // POSITIVO: 10 USD × 1430 = $14.300 (conversión a moneda local en el carrito)
    await expect(page.getByText(/Precio USD\s*10.*convertido a \$14[.,]300/i)).toBeVisible({ timeout: 6000 })
  })
})
