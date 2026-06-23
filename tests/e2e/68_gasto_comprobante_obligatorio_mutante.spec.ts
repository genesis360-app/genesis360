/**
 * 68_gasto_comprobante_obligatorio_mutante.spec.ts
 * E2E MUTANTE — Comprobante obligatorio bloquea el gasto sin adjunto (REGLA #0, fiscal/respaldo).
 *
 * B1/ISS-182 (`GastosPage.guardar` ~1039-1055): el comprobante es obligatorio según 4 reglas OR del
 * tenant (`gastos_comp_siempre` / `_si_iva` / `_si_deduce_ganancias` / `_si_monto`). Si alguna aplica y
 * no hay adjunto, el alta se BLOQUEA. Un gasto deducible sin respaldo compromete la deducción fiscal del
 * cliente ante AFIP → debe frenarse.
 *
 * Fixture (DEV, Almacén Jorgito): `gastos_comp_siempre=true` (reversible → restaurar a false). Se intenta
 * registrar un gasto ($100, sin comprobante, sin medio de pago = borrador) → guard bloquea.
 *
 * Aserción POSITIVA del bloqueo (toast "Adjuntá el comprobante: la regla \"siempre obligatorio\"…"); el
 * gasto NO se crea (el guard corta antes del insert; el modal sigue abierto). GATE: E2E_GASTO_COMP=1
 * (sin el flag el gasto sin comprobante SÍ se crearía). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Comprobante de gasto obligatorio (mutante)', () => {
  test.skip(process.env.E2E_GASTO_COMP !== '1', 'Fixture gastos_comp_siempre=true no aplicado (E2E_GASTO_COMP!=1).')

  test('gasto sin comprobante con gastos_comp_siempre=true → bloquea, no crea gasto', async ({ page }) => {
    await goto(page, '/gastos')
    await waitForApp(page)

    await page.getByRole('button', { name: /^Nuevo gasto$/ }).first().click()
    await expect(page.getByRole('heading', { name: /^Nuevo gasto$/ }).or(page.getByText(/^Nuevo gasto$/).first())).toBeVisible({ timeout: 6000 })

    // Descripción + monto (sin comprobante, sin medio de pago = borrador)
    await page.getByPlaceholder(/Pago de alquiler/i).fill('ZZZ Comprobante Test E2E')
    await setReactNumber(page.locator('input[type="number"][step="0.01"]').first(), '100')

    // Registrar → guard de comprobante obligatorio bloquea
    await page.getByRole('button', { name: /^Registrar gasto$/ }).click()
    await expect(page.getByText(/Adjuntá el comprobante/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/siempre obligatorio/i)).toBeVisible()
    // No mutación: el modal sigue abierto (el gasto no se creó)
    await expect(page.getByPlaceholder(/Pago de alquiler/i)).toBeVisible()
  })
})
