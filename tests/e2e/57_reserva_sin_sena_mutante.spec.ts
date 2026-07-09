/**
 * 57_reserva_sin_sena_mutante.spec.ts
 * E2E MUTANTE — Reservar exige seña real cuando `reserva_sena_obligatoria` (REGLA #0, plata).
 *
 * Guard E6 (`VentasPage.registrarVenta`, ~2459): con `reserva_sena_obligatoria=true` (default), una
 * reserva sin seña (dinero real; la CC no cuenta como seña) se BLOQUEA. Reservar sin cobrar seña dejaría
 * stock comprometido sin respaldo de caja → inconsistencia operativa/plata.
 *
 * Flujo (sin fixture, contra Almacén Jorgito con el flag default): agregar producto → seleccionar cliente
 * (la reserva exige cliente por `cliente_obligatorio='reservas'`) → modo "Reservar" → sin medio de pago →
 * "Reservar stock". Aserción POSITIVA del bloqueo (toast "No se puede reservar sin seña"); el carrito NO
 * se limpia (la reserva no se creó). Corre con OWNER (chromium) contra DEV.
 *
 * Cliente real del tenant: "Fede Messina". Re-ejecutable y sin efectos (el guard bloquea antes de crear
 * la reserva / reservar stock / asentar caja).
 *
 * AUTOSUFICIENTE frente a saldo a favor acumulado: si Fede Messina tiene "Crédito a favor" (queda de
 * otros mutantes de devolución/CC que corrieron antes), `VentasPage` lo auto-aplica como único medio de
 * pago al seleccionar el cliente (ISS E2, ~línea 2363). El guard E6 solo excluye "Cuenta Corriente" del
 * cómputo de la seña real — "Crédito a favor" SÍ cuenta como seña (es plata real que el cliente ya tiene
 * a favor) — así que si queda auto-aplicado, la reserva NO se bloquea y el test perdía la precondición
 * "sin seña". Por eso el test limpia explícitamente el monto del medio de pago después de elegir el
 * cliente, sin importar cuánto saldo a favor tenga acumulado.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Reserva exige seña (mutante)', () => {
  test('reservar sin seña con reserva_sena_obligatoria → bloquea, no crea reserva', async ({ page }) => {
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

    // Seleccionar cliente (la reserva lo exige por cliente_obligatorio='reservas')
    const cliInput = page.getByPlaceholder(/Buscar por nombre o DNI/i)
    await expect(cliInput).toBeVisible({ timeout: 5000 })
    await cliInput.fill('Fede Messina')
    await page.waitForTimeout(900)
    const cliOpt = page.getByRole('button', { name: /Fede Messina/ }).first()
    if (!(await cliOpt.isVisible().catch(() => false))) {
      test.skip(true, 'Cliente "Fede Messina" no encontrado en el tenant.')
    }
    await cliOpt.click()
    await page.waitForTimeout(600)

    // Neutralizar cualquier medio de pago auto-sugerido (ISS E2: "Crédito a favor" se auto-aplica
    // si el cliente tiene saldo a favor). Si no se limpia, cuenta como "seña real" y el bloqueo
    // esperado no se dispara — ver nota AUTOSUFICIENTE en el header del archivo.
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    if (await montoInput.isVisible().catch(() => false)) await montoInput.fill('')
    await page.waitForTimeout(200)

    // Modo "Reservar" (toggle exacto, distinto del CTA "Reservar stock")
    await page.getByRole('button', { name: /^Reservar$/ }).click()
    await page.waitForTimeout(300)

    // "Reservar stock" SIN haber cobrado seña → guard E6 bloquea
    await page.getByRole('button', { name: /Reservar stock/i }).click()
    await expect(page.getByText(/No se puede reservar sin seña/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue (la reserva no se creó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
