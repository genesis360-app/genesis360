/**
 * 46_cc_limite_bloquear_mutante.spec.ts
 * E2E MUTANTE — Límite de Cuenta Corriente con política 'bloquear' (Tanda A, REGLA #0 contable).
 *
 * B1 (`VentasPage.registrarVenta`, líneas ~2420-2439): cuando el tenant tiene
 * `cc_enforcement_politica='bloquear'` y una venta a Cuenta Corriente dejaría la deuda del cliente
 * por encima de su `limite_credito`, la venta se BLOQUEA ("supera el límite … Operación bloqueada.").
 * Es la capa UI del guard server-side `fn_ventas_cc_guard` (mig 234, ya en PROD pero dormido en
 * 'avisar'); este test valida el camino 'bloquear' por click-through.
 *
 * Fixtures por SQL (creados antes y limpiados después):
 *   - cliente "ZZZ CC Limite Test" con cuenta_corriente_habilitada=true, limite_credito=1.
 *   - tenants.cc_enforcement_politica='bloquear' (Almacén Jorgito), reseteado a 'avisar' al terminar.
 * Con límite=1, cualquier monto a CC supera el límite → bloqueo determinista.
 *
 * Aserción POSITIVA: el toast de bloqueo. La venta NO se crea (el carrito sigue cargado).
 * Corre con OWNER (proyecto chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'ZZZ CC Limite Test'

test.describe('Límite de CC con política bloquear (mutante)', () => {
  test('venta a Cuenta Corriente sobre el límite → bloqueada', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Elegir el cliente registrado con CC (habilita el medio "Cuenta Corriente")
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    const clienteSearch = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await expect(clienteSearch).toBeVisible({ timeout: 5000 })
    await clienteSearch.fill('ZZZ CC Limite')
    await page.waitForTimeout(800)
    const clienteBtn = page.getByRole('button', { name: new RegExp(CLIENTE, 'i') }).first()
    // Auto-omitir si la fixture no está sembrada (patrón specs 35/42): el cliente CC con límite=1
    // y cc_enforcement_politica='bloquear' se siembran por SQL antes de correr.
    test.skip(!(await clienteBtn.isVisible({ timeout: 4000 }).catch(() => false)),
      'Fixture ausente: cliente "ZZZ CC Limite Test" (CC, límite=1) + tenant cc_enforcement_politica=bloquear')
    await clienteBtn.click()
    await page.waitForTimeout(400)

    // 3) Medio de pago: Cuenta Corriente cubriendo el total (monto > límite=1 → supera)
    const medioSelect = page.locator('select').filter({ has: page.locator('option[value="Cuenta Corriente"]') }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Cuenta Corriente')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('5000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // 4) Submit → con la venta 100% a CC el CTA pasa a "Despachar (cuenta corriente)" (línea 5327).
    //    El guard de límite de CC corre antes de tocar caja/stock.
    const finalizar = page.getByRole('button', { name: /Despachar \(cuenta corriente\)/i })
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // 5) POSITIVO: la venta se bloquea por superar el límite de CC
    await expect(page.getByText(/supera el límite/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/Operación bloqueada/i)).toBeVisible()

    // 6) La venta NO se creó: el carrito sigue cargado (registrarVenta hizo return, no reseteó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
