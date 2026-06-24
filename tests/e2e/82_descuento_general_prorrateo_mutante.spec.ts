/**
 * 82_descuento_general_prorrateo_mutante.spec.ts
 * E2E MUTANTE — "Descuento general" se prorratea en venta_items (REGLA #0 fiscal, G0.6).
 *
 * Valida el fix v1.88.0: con un "Descuento general", `registrarVenta` guarda los `venta_items` con el
 * precio EFECTIVO prorrateado (`prorratearDescuentoGlobal`) → `Σ venta_items.subtotal = venta.total`.
 * Antes del fix, los ítems sumaban el monto SIN descuento (> venta.total) → la factura y la NC
 * sobre-facturaban. Este spec crea una venta directa con 10% de descuento general; el invariante
 * `Σ venta_items = venta.total` se verifica aparte con execute_sql / supabase db query.
 *
 * Aserción POSITIVA por UI (carrito se limpia = venta creada). MUTANTE (crea venta + rebaja stock; queda
 * como evidencia UAT). GATE: E2E_DESC_GENERAL=1. OWNER (chromium) contra DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Descuento general prorrateado en venta_items (mutante)', () => {
  test.skip(process.env.E2E_DESC_GENERAL !== '1', 'Mutante de venta + stock (E2E_DESC_GENERAL!=1).')

  test('venta directa con 10% de descuento general → venta creada (Σ venta_items = total se verifica en DB)', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'No hay productos vendibles')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Caja (si hay más de una abierta)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // 3) Descuento general = 10% (input type=number controlado por React → native value-setter)
    const descInput = page.locator('xpath=//label[contains(.,"Descuento general")]/following::input[1]')
    await expect(descInput).toBeVisible({ timeout: 5000 })
    await setReactNumber(descInput, '10')
    await expect(descInput).toHaveValue('10')

    // 4) Pago efectivo cubriendo de sobra
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('100000'); await montoInput.blur()
    await page.waitForTimeout(300)

    // 5) Finalizar
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // 6) POSITIVO: carrito limpio (venta creada). El prorrateo (Σ venta_items = venta.total) se verifica en DB.
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/stock insuficiente|no se pudo registrar/i)).not.toBeVisible()
  })
})
