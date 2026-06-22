/**
 * 49_morosidad_cc_bloquea_mutante.spec.ts
 * E2E MUTANTE — Morosidad de Cuenta Corriente (Tanda A, REGLA #0 contable).
 *
 * B4 (`VentasPage.registrarVenta` ~2420-2431): si el cliente tiene DEUDA VENCIDA y el tenant usa
 * `cc_morosidad_politica='bloqueo_total'`, NINGUNA venta (ni en efectivo) se permite hasta saldar
 * ("Cliente con deuda vencida (…). No puede comprar hasta saldar."). Capa UI del guard server-side
 * `fn_ventas_cc_guard` (mig 234, también valida morosidad). Multi-tenant: corre en Familia Otranto.
 *
 * Fixtures por SQL: cliente "ZZZ Morosidad Test" + una venta CC con saldo impago y
 * `fecha_vencimiento_cc` en el pasado (deuda vencida) + `cc_morosidad_politica='bloqueo_total'`.
 * Producto "Mantecol Clasico 111g" priceado (mismo que spec 48).
 *
 * Aserción POSITIVA: el toast de bloqueo por morosidad. La venta NO se crea (carrito intacto).
 * Corre con el SUPERVISOR de prueba de Familia Otranto (proyecto chromium-fotranto-sup).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'ZZZ Morosidad Test'

test.describe('Morosidad CC bloquea la venta (mutante)', () => {
  test('cliente con deuda vencida + bloqueo_total → venta bloqueada (no puede comprar)', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Producto al carrito (Mantecol, fixture priceado)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('Mantecol')
    await page.waitForTimeout(1200)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /Mantecol/i }).first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'Fixture ausente: producto vendible "Mantecol" en Familia Otranto')
    await prod.click()
    await page.waitForTimeout(600)
    const cartLoaded = await page.getByText(/\d+\s+producto/).first().isVisible({ timeout: 5000 }).catch(() => false)
    test.skip(!cartLoaded, 'No se pudo agregar el producto al carrito en Familia Otranto')

    // 2) Elegir el cliente moroso. En Familia Otranto la facturación está OFF → no hay toggle
    //    "Cliente registrado"; el buscador de cliente se muestra directo.
    const clienteSearch = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await expect(clienteSearch).toBeVisible({ timeout: 5000 })
    await clienteSearch.fill('ZZZ Morosidad')
    await page.waitForTimeout(1500)
    const clienteBtn = page.getByRole('button', { name: new RegExp(CLIENTE, 'i') }).first()
    test.skip(!(await clienteBtn.isVisible({ timeout: 6000 }).catch(() => false)),
      'Fixture ausente: cliente "ZZZ Morosidad Test" con deuda vencida + cc_morosidad_politica=bloqueo_total')
    await clienteBtn.click()
    await page.waitForTimeout(400)

    // 3) Pago en efectivo (para habilitar el CTA) — el guard de morosidad corre ANTES que el pago
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    if (await tipoSelect.isVisible().catch(() => false)) {
      await tipoSelect.selectOption('Efectivo')
      const montoInput = page.getByPlaceholder(/^Monto$/i).first()
      await montoInput.fill('5000'); await montoInput.blur(); await page.waitForTimeout(300)
    }

    // 4) "Venta directa" → bloqueada por morosidad (bloqueo_total aplica a cualquier medio)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeVisible({ timeout: 5000 })
    await finalizar.click()

    // 5) POSITIVO: bloqueo por deuda vencida; la venta no se crea
    await expect(page.getByText(/deuda vencida/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/No puede comprar hasta saldar/i)).toBeVisible()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
