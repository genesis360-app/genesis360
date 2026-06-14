/**
 * 21_facturacion_mutante.spec.ts
 * E2E MUTANTE de facturación electrónica AFIP (homologación).
 *
 * Completa una venta real y emite una Factura C contra AFIP homologación vía la
 * Edge Function emitir-factura (que usa el certificado propio del tenant + AfipSDK).
 * Verifica que vuelve un CAE real. EMITE un comprobante de homologación por corrida
 * (sin valor fiscal) — es intencional (mutante), como 19/20.
 *
 * Se auto-omite si el tenant de prueba no tiene facturación configurada (no aparece
 * el modal "¿Emitir comprobante?" tras despachar).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Facturación electrónica (mutante)', () => {
  test('venta → emite Factura C → CAE de AFIP homologación', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)

    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    const hayProducto = await primerProducto.isVisible().catch(() => false)
    test.skip(!hayProducto, 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)

    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Elegir caja si hay selector
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // 3) Pago en efectivo cubriendo de sobra
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('100000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // 4) Finalizar venta directa (despachada)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // El carrito se limpia (venta creada)
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 5) Modal post-despacho "¿Emitir comprobante?" (solo si facturación está configurada)
    const modal = page.getByRole('heading', { name: /¿Emitir comprobante\?/ })
    const apareceModal = await modal.isVisible({ timeout: 6000 }).catch(() => false)
    test.skip(!apareceModal, 'Facturación no configurada en el tenant de prueba (no aparece el modal)')

    // 6) Elegir Factura C (Monotributista) y emitir
    await page.getByRole('button', { name: /^Factura C$/ }).click()
    await page.getByRole('button', { name: /Emitir Factura C/ }).click()

    // 7) Verificar el CAE real de AFIP en el toast de éxito (la llamada a AFIP tarda)
    await expect(page.getByText(/Factura C emitida — CAE:/)).toBeVisible({ timeout: 30000 })

    // No debe quedar un toast de error de emisión
    await expect(page.getByText(/Error al emitir/i)).not.toBeVisible()
  })
})
