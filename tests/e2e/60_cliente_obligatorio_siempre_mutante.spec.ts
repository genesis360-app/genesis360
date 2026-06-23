/**
 * 60_cliente_obligatorio_siempre_mutante.spec.ts
 * E2E MUTANTE — `cliente_obligatorio='siempre'` exige cliente hasta en una venta directa CF.
 *
 * Lógica L20 (`VentasPage.registrarVenta`, ~2407-2417): `clienteObligatorio==='siempre'` fuerza cliente
 * en TODA venta (no solo reservas/presupuestos). Se prueba la rama distintiva del flag: una venta
 * directa marcada Consumidor Final (que con el default `'reservas'` NO exige cliente) se BLOQUEA cuando
 * el flag está en `'siempre'`. Aísla el flag manteniendo modo CF (así la cláusula de facturación
 * `factHabilitada && !ventaCF` no confunde el bloqueo).
 *
 * Fixture (DEV, Almacén Jorgito): `cliente_obligatorio='siempre'` (reversible → restaurar a 'reservas').
 * Flujo: agregar producto → modo "Venta directa" (CF por default) → SIN cliente → "Venta directa".
 *
 * Aserción POSITIVA del bloqueo (toast "Registrá o seleccioná un cliente para continuar."); que NO se
 * creó la venta se evidencia porque el carrito NO se limpia (el guard corta antes de crear/cobrar). El
 * check de cliente precede al de pago/caja → alcanza el guard sin sembrar cobro. No muta.
 *
 * GATE: requiere E2E_CLI_OBLIG_FIXTURE=1 (solo con el flag aplicado). Sin él, skip — con 'reservas' la
 * venta directa CF NO bloquea (pasaría a cobro). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('cliente_obligatorio=siempre exige cliente en venta directa CF (mutante)', () => {
  test.skip(process.env.E2E_CLI_OBLIG_FIXTURE !== '1', "Fixture cliente_obligatorio='siempre' no aplicado (E2E_CLI_OBLIG_FIXTURE!=1).")

  test("venta directa CF sin cliente con cliente_obligatorio='siempre' → bloquea, no crea venta", async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // Agregar un producto vendible
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    if (!(await prod.isVisible().catch(() => false))) {
      test.skip(true, 'No hay productos vendibles en el tenant de prueba')
    }
    await prod.click()
    await page.waitForTimeout(500)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Modo "Venta directa" (Consumidor Final por default; sin tocar el toggle CF)
    await page.getByRole('button', { name: /^Venta directa$/ }).first().click()
    await page.waitForTimeout(300)

    // "Venta directa" (CTA) SIN cliente → guard L20 bloquea por cliente_obligatorio='siempre'
    await page.getByRole('button', { name: /^Venta directa$/ }).last().click()
    await expect(page.getByText(/Registrá o seleccioná un cliente para continuar/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue (la venta no se creó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
