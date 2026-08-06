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
import { visible } from './helpers/fixtures'

test.describe('Reserva exige seña (mutante)', () => {
  test('reservar sin seña con reserva_sena_obligatoria → bloquea, no crea reserva', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // Agregar un producto vendible
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    if (!(await visible(prod, 5000))) {
      test.skip(true, 'No hay productos vendibles en el tenant de prueba')
    }
    await prod.click()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Seleccionar cliente (la reserva lo exige por cliente_obligatorio='reservas')
    const cliInput = page.getByPlaceholder(/Buscar por nombre o DNI/i)
    await expect(cliInput).toBeVisible({ timeout: 5000 })
    await cliInput.fill('Fede Messina')
    const cliOpt = page.getByRole('button', { name: /Fede Messina/ }).first()
    if (!(await visible(cliOpt, 5000))) {
      test.skip(true, 'Cliente "Fede Messina" no encontrado en el tenant.')
    }
    await cliOpt.click()
    // Dejar asentar el fetch de saldo a favor (ISS E2, auto-aplica "Crédito a favor" como medio si
    // el cliente tiene saldo) ANTES de neutralizarlo — si se limpia el monto demasiado pronto, el
    // auto-fill llega después y pisa el "" con el saldo, rompiendo la precondición "sin seña".
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})

    // Neutralizar cualquier medio de pago auto-sugerido (ISS E2: "Crédito a favor" se auto-aplica
    // si el cliente tiene saldo a favor). Si no se limpia, cuenta como "seña real" y el bloqueo
    // esperado no se dispara — ver nota AUTOSUFICIENTE en el header del archivo.
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    if (await montoInput.isVisible().catch(() => false)) await montoInput.fill('')

    // Modo "Reservar" (toggle exacto, distinto del CTA "Reservar stock")
    await page.getByRole('button', { name: /^Reservar$/ }).click()

    // "Reservar stock" SIN haber cobrado seña → guard E6 bloquea
    await page.getByRole('button', { name: /Reservar stock/i }).click()
    await expect(page.getByText(/No se puede reservar sin seña/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue (la reserva no se creó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
