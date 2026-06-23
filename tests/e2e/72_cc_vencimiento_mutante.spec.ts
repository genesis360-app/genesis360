/**
 * 72_cc_vencimiento_mutante.spec.ts
 * E2E MUTANTE — Venta a Cuenta Corriente fija el vencimiento (REGLA #0, contable).
 *
 * B3 (`VentasPage.registrarVenta` ~2540-2542): cuando la venta va a CC (`modoCC && montoCC>0.5`) y el
 * tenant tiene `cc_dias_vencimiento` configurado, se setea `fecha_vencimiento_cc = hoy + N` en la venta.
 * Esa fecha gobierna la morosidad/aging del cliente → debe quedar exacta. Además valida el camino CC
 * EXITOSO (crea la deuda), complemento de los specs de bloqueo (46 límite / 49 morosidad).
 *
 * Fixture SQL (DEV, Almacén Jorgito): `cc_dias_vencimiento=15` + cliente "ZZZ Venc CC Test" (CC, límite
 * holgado). Producto pineado Coca Cola 1.5L ($1.657). Esperado: venta `es_cuenta_corriente=true` con
 * `fecha_vencimiento_cc = hoy + 15`.
 *
 * Aserción POSITIVA por UI (modal de factura / cart limpio); el `fecha_vencimiento_cc` se verifica con
 * execute_sql. MUTANTE (crea venta + deuda + rebaja 1u); se limpia por SQL. GATE: E2E_VENC_CC=1.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const CLIENTE = 'ZZZ Venc CC Test'

test.describe('Vencimiento de venta CC (mutante)', () => {
  test.skip(process.env.E2E_VENC_CC !== '1', 'Fixture cc_dias_vencimiento + cliente CC no sembrado (E2E_VENC_CC!=1).')

  test('venta 100% CC con cc_dias_vencimiento=15 → fecha_vencimiento_cc = hoy + 15', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    // Producto pineado
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('Coca Cola 1.5')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'Coca Cola no encontrada')
    await prod.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Cliente registrado con CC
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    const cliSearch = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await cliSearch.fill(CLIENTE)
    await page.waitForTimeout(800)
    const cliBtn = page.getByRole('button', { name: new RegExp(CLIENTE, 'i') }).first()
    test.skip(!(await cliBtn.isVisible({ timeout: 4000 }).catch(() => false)), `Cliente "${CLIENTE}" no sembrado`)
    await cliBtn.click()
    await page.waitForTimeout(400)

    // Cuenta Corriente por el total ($1.657)
    const medioSelect = page.locator('select').filter({ has: page.locator('option[value="Cuenta Corriente"]') }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Cuenta Corriente')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('1657')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // Elegir caja (Jorgito tiene 2+ cajas abiertas → el despacho exige una caja elegida)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
      await page.waitForTimeout(300)
    }

    // Despachar a CC
    const despachar = page.getByRole('button', { name: /Despachar \(cuenta corriente\)/i })
    await expect(despachar).toBeEnabled({ timeout: 5000 })
    await despachar.click()

    // POSITIVO: la venta se creó (aparece el modal de factura o se limpia el carrito).
    // El efecto fecha_vencimiento_cc se verifica aparte con execute_sql.
    await expect(
      page.getByText(/Emitir comprobante/i).or(page.getByText(/Venta registrada|registrada con éxito|despachada/i)).first()
    ).toBeVisible({ timeout: 12000 })
  })
})
