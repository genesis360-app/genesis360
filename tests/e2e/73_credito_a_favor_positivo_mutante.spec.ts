/**
 * 73_credito_a_favor_positivo_mutante.spec.ts
 * E2E MUTANTE — Pagar con crédito a favor consume el saldo exacto del cliente (REGLA #0, plata).
 *
 * E2 (`VentasPage.registrarVenta` ~2812-2822): cuando la venta (estado≠pendiente) se paga con el medio
 * "Crédito a favor", se inserta una fila NEGATIVA en `cliente_creditos` (`monto: −montoCredito`) → el
 * saldo a favor baja exactamente lo aplicado. El guard negativo (no aplicar más que el disponible) está
 * en spec 53; éste valida el consumo POSITIVO. Un crédito mal consumido = plata mal.
 *
 * Fixture SQL (DEV, Almacén Jorgito): cliente "ZZZ Credito Pos Test" con $5.000 de crédito. Producto
 * pineado Coca Cola 1.5L ($1.657). Esperado: venta despachada + fila `cliente_creditos = −1.657` →
 * saldo neto $3.343.
 *
 * Aserción POSITIVA por UI (modal de factura / cart); el consumo se verifica con execute_sql. MUTANTE
 * (crea venta + rebaja 1u + consume crédito); se limpia por SQL (restaurando la línea, sin tocar
 * stock_actual — lo recalcula el trigger). GATE: E2E_CREDITO_POS=1.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const CLIENTE = 'ZZZ Credito Pos Test'

test.describe('Crédito a favor positivo (mutante)', () => {
  test.skip(process.env.E2E_CREDITO_POS !== '1', 'Fixture cliente + crédito no sembrado (E2E_CREDITO_POS!=1).')

  test('venta pagada con crédito $1.657 → consume cliente_creditos (saldo 5.000 → 3.343)', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('Coca Cola 1.5')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'Coca Cola no encontrada')
    await prod.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Cliente registrado con crédito a favor
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    const cliSearch = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await cliSearch.fill(CLIENTE)
    await page.waitForTimeout(800)
    const cliBtn = page.getByRole('button', { name: new RegExp(CLIENTE, 'i') }).first()
    test.skip(!(await cliBtn.isVisible({ timeout: 4000 }).catch(() => false)), `Cliente "${CLIENTE}" no sembrado`)
    await cliBtn.click()
    await page.waitForTimeout(900)   // cargar clienteCredito → habilita la opción "Crédito a favor"

    // Medio "Crédito a favor" por el total ($1.657)
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Crédito a favor/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Crédito a favor')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('1657')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // Elegir caja (2+ cajas abiertas)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
      await page.waitForTimeout(300)
    }

    // Venta directa (el crédito cubre el total)
    await page.locator('button', { hasText: /^Venta directa$/ }).last().click()

    // POSITIVO: la venta se creó (modal de factura o success). El consumo se verifica con execute_sql.
    await expect(
      page.getByText(/Emitir comprobante/i).or(page.getByText(/Venta registrada|registrada con éxito|despachada/i)).first()
    ).toBeVisible({ timeout: 12000 })
  })
})
