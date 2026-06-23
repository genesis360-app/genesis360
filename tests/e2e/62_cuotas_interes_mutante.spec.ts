/**
 * 62_cuotas_interes_mutante.spec.ts
 * E2E — Cuotas por banco (tarjeta) con interés: el picker computa el total financiado (REGLA #0, plata).
 *
 * L40 (`VentasPage`, picker ISS-086 ~5170-5208): con `cuotas_bancos` configurado, al pagar con "Tarjeta
 * crédito" se elige banco + plan de cuotas. Si el plan tiene interés, la UI muestra el recargo y el total
 * financiado: `montoCuota = monto × (1 + interés/100) / cuotas`, `total = monto × (1 + interés/100)`. El
 * dato de cuotas se persiste en `ventas.cuotas_info` (~2545). La aritmética del interés es plata real.
 *
 * Datos reales del tenant (Almacén Jorgito, NO fixture): "Banco Galicia" con plan 3x al +0.5%. Con un
 * monto de $10.000 → 3 cuotas de $3.350 = $10.050 total (10000 × 1.005). Sin interés sería $10.000.
 *
 * 🐛 BUG REGLA #0 hallado en este barrido (CORREGIDO): el picker se gatillaba con
 * `mp.tipo === 'Tarjeta crédito'` (sin "de"), pero el método canónico (Config/fallback/Jorgito) es
 * "Tarjeta de crédito" → el picker de cuotas con interés NUNCA aparecía con la config estándar (no se
 * podía aplicar el interés de financiación en el POS). Fix: detectar la tarjeta de crédito por
 * normalización (`esTarjetaCredito`). Este spec falla/skip sin el fix; pasa con él.
 *
 * Test de SOLO LECTURA del picker (no se confirma la venta → NO muta). Skip-guards si el banco/plan no
 * existe (es dato del tenant, no fixture controlado). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Cuotas con interés — total financiado', () => {
  test('Banco Galicia 3x (+0.5%) sobre $10.000 → "3 cuotas de $3.350 = $10.050 total"', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto (la sección de pago aparece con carrito > 0 en modo no-presupuesto)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'No hay productos vendibles en el tenant de prueba')
    await prod.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Medio de pago = Tarjeta de crédito (nombre canónico del método; el picker de cuotas lo
    //    detecta por normalización — fix ISS-086: antes comparaba contra "Tarjeta crédito" sin "de").
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Tarjeta de crédito/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption({ label: 'Tarjeta de crédito' })

    // 3) Monto $10.000 (input controlado de React)
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '10000')
    await page.waitForTimeout(400)

    // 4) Picker de cuotas: elegir Banco Galicia (skip si no está configurado)
    const bancoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Banco\.\.\./ }) }).first()
    test.skip(!(await bancoSelect.isVisible({ timeout: 4000 }).catch(() => false)), 'Picker de cuotas no visible (cuotas_bancos vacío?)')
    const tieneGalicia = await bancoSelect.locator('option', { hasText: /Banco Galicia/ }).count()
    test.skip(tieneGalicia === 0, 'Banco Galicia no configurado en cuotas_bancos')
    await bancoSelect.selectOption({ label: 'Banco Galicia' })

    // 5) Elegir el plan 3x (+0.5%)
    const cuotasSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Cuotas\.\.\./ }) }).first()
    const tienePlan = await cuotasSelect.locator('option', { hasText: /3x \(\+0\.5%\)/ }).count()
    test.skip(tienePlan === 0, 'Plan 3x (+0.5%) no configurado para Banco Galicia')
    await cuotasSelect.selectOption('3')

    // 6) POSITIVO: el recargo y el total financiado se muestran con la aritmética correcta
    await expect(page.getByText(/\+0\.5% interés/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/3 cuotas de \$3\.350/)).toBeVisible()
    await expect(page.getByText(/\$10\.050 total/)).toBeVisible()
  })
})
