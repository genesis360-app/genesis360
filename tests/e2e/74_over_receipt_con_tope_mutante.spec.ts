/**
 * 74_over_receipt_con_tope_mutante.spec.ts
 * E2E MUTANTE — Over-receipt PERMITIDO dentro del tope sube el stock (REGLA #0, stock).
 *
 * B3 (`recepcionLogic.superaOverReceipt` + `RecepcionesPage.guardar`): con `permite_over_receipt=true` y
 * `over_receipt_pct_max=10`, recibir hasta `pedido·(1+10%)` se ACEPTA (sube stock por el recibido real,
 * incluido el excedente). El bloqueo del exceso > tope está en spec 52; éste valida el camino ACEPTA.
 *
 * Fixture SQL (DEV, Almacén Jorgito): `permite_over_receipt=true` + `over_receipt_pct_max=10`; OC #16
 * confirmada (Bebida Sprite 2.5L, stock 0, pedido 10). Se recibe 11 (= +10%, dentro del tope). Esperado:
 * recepción creada, stock 0→11, OC `recibida`.
 *
 * Aserción POSITIVA por UI (success); el stock 11 + estado OC se verifican con execute_sql. MUTANTE
 * (sube stock real; queda como evidencia UAT). GATE: E2E_OVER_RECEIPT_CON=1. Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const OC_ID = '0c110011-0000-4000-8000-000000000011'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Over-receipt permitido dentro del tope (mutante)', () => {
  test.skip(process.env.E2E_OVER_RECEIPT_CON !== '1', 'Fixture OC + flags over-receipt no sembrado (E2E_OVER_RECEIPT_CON!=1).')

  test('recibir 11 con pedido 10 y tope +10% → acepta, stock 0→11, OC recibida', async ({ page }) => {
    await goto(page, `/recepciones?oc_id=${OC_ID}`)
    await waitForApp(page)

    const cantInput = page.getByRole('spinbutton').first()
    if (!(await cantInput.isVisible().catch(() => false))) {
      test.skip(true, 'Form de recepción no cargó el ítem de la OC fixture (re-sembrar SQL).')
    }
    await expect(cantInput).toHaveValue('10', { timeout: 10000 })

    // Recibir 11 (= pedido 10 + 10%, dentro del tope)
    await setReactNumber(cantInput, '11')
    await expect(cantInput).toHaveValue('11')

    await page.getByRole('button', { name: /Confirmar recepción/i }).click()

    // POSITIVO: la recepción se registró (no aparece el toast de exceso). El stock 0→11 y la OC recibida
    // se verifican con execute_sql.
    await expect(page.getByRole('heading', { name: /Recepción #?\d* ?confirmada/i }).first())
      .toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/supera lo permitido sobre lo pedido/i)).not.toBeVisible()
  })
})
