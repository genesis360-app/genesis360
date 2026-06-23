/**
 * 58_reserva_sena_minima_mutante.spec.ts
 * E2E MUTANTE — Reservar exige seña ≥ `reserva_sena_minima_pct`% del total (REGLA #0, plata).
 *
 * Guard E6 (`VentasPage.registrarVenta`, ~2467): con `reserva_sena_obligatoria=true` y
 * `reserva_sena_minima_pct > 0`, una reserva cuya seña real (dinero, excluye CC) es MENOR al N% del
 * total se BLOQUEA. Reservar con una seña por debajo del mínimo dejaría stock comprometido con un
 * respaldo de caja insuficiente respecto de la política del negocio.
 *
 * Fixture (DEV, Almacén Jorgito): `reserva_sena_minima_pct = 50` (reversible → restaurar a 0). Se
 * agrega un producto (total ≫ $2), cliente "Fede Messina" (la reserva exige cliente), modo "Reservar",
 * seña en Efectivo de $1 (< 50% de cualquier total ≥ $3) → "Reservar stock".
 *
 * Aserción POSITIVA del bloqueo (toast "La seña mínima es 50%…"); que NO se creó la reserva se
 * evidencia porque el carrito NO se limpia (registrarVenta corta antes de crear la venta / reservar
 * stock / asentar caja). Re-ejecutable: el guard bloquea, no muta. Corre con OWNER (chromium) contra DEV.
 *
 * GATE: requiere E2E_SENA_MIN_FIXTURE=1 (se setea solo cuando el fixture flag=50 está aplicado). Sin él,
 * skip — así el full-suite no intenta reservar con el flag restaurado a 0 (lo que SÍ crearía la reserva).
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

/** Setea un <input type=number> controlado por React (native value-setter + evento input burbujeante). */
async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Reserva exige seña mínima % (mutante)', () => {
  test.skip(process.env.E2E_SENA_MIN_FIXTURE !== '1', 'Fixture reserva_sena_minima_pct=50 no aplicado (E2E_SENA_MIN_FIXTURE!=1).')

  test('seña $1 < 50% del total con reserva_sena_minima_pct=50 → bloquea, no crea reserva', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto vendible (cualquiera; total ≫ $2)
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

    // 2) Seleccionar cliente (la reserva lo exige por cliente_obligatorio='reservas')
    const cliInput = page.getByPlaceholder(/Buscar por nombre o DNI/i)
    await expect(cliInput).toBeVisible({ timeout: 5000 })
    await cliInput.fill('Fede Messina')
    await page.waitForTimeout(900)
    const cliOpt = page.getByRole('button', { name: /Fede Messina/ }).first()
    if (!(await cliOpt.isVisible().catch(() => false))) {
      test.skip(true, 'Cliente "Fede Messina" no encontrado en el tenant.')
    }
    await cliOpt.click()
    await page.waitForTimeout(400)

    // 3) Modo "Reservar" (toggle exacto, distinto del CTA "Reservar stock")
    await page.getByRole('button', { name: /^Reservar$/ }).click()
    await page.waitForTimeout(300)

    // 4) Seña en Efectivo de $1 (≥ 0.5 supera el "sin seña", pero < 50% del total)
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await setReactNumber(montoInput, '1')

    // 5) "Reservar stock" → guard E6 bloquea por seña mínima
    await page.getByRole('button', { name: /Reservar stock/i }).click()
    await expect(page.getByText(/La seña mínima es 50%/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue (la reserva no se creó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
