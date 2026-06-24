/**
 * 79_under_receipt_motivo_obligatorio_mutante.spec.ts
 * E2E — Under-receipt (recibir MENOS que lo pedido) exige motivo del faltante (REGLA #0, stock/trazabilidad).
 *
 * B4 (`recepcionLogic.tieneFaltante` + `RecepcionesPage` L493): al confirmar una recepción vinculada a una
 * OC donde el recibido acumulado queda por debajo de lo pedido, el form EXIGE `motivo_faltante` o BLOQUEA
 * ("Indicá el motivo del faltante…"), sin crear la recepción ni mover stock. Complementa el over-receipt
 * (specs 52 SIN-tope / 74 CON-tope). Corre como OWNER=DUEÑO → el guard de rol (L466, over/under requiere
 * SUPERVISOR+) NO aplica, así que aísla el guard del MOTIVO.
 *
 * NO-MUTANTE: la aserción es el BLOQUEO (no se confirma ninguna recepción). Aserción POSITIVA del toast de
 * error + el form sigue abierto. GATE: E2E_UNDER_RECEIPT=1 (requiere OC fixture confirmada).
 *
 * Fixture SQL (DEV, Almacén Jorgito) — OC confirmada con pedido 10 (Bebida Sprite 2.5L):
 *   UPDATE ordenes_compra SET estado='confirmada', estado_pago='pendiente_pago'
 *     WHERE id='0c110011-0000-4000-8000-000000000011';
 *   UPDATE orden_compra_items SET cantidad=10 WHERE oc_id='0c110011-0000-4000-8000-000000000011';
 *   -- y limpiar recepciones previas de esa OC si las hubiera, para que el acumulado parta de 0.
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

test.describe('Under-receipt exige motivo del faltante', () => {
  test.skip(process.env.E2E_UNDER_RECEIPT !== '1', 'Fixture OC confirmada no sembrado (E2E_UNDER_RECEIPT!=1).')

  test('recibir 5 vs pedido 10 sin motivo → bloquea (no crea recepción)', async ({ page }) => {
    await goto(page, `/recepciones?oc_id=${OC_ID}`)
    await waitForApp(page)

    const cantInput = page.getByRole('spinbutton').first()
    if (!(await cantInput.isVisible().catch(() => false))) {
      test.skip(true, 'Form de recepción no cargó el ítem de la OC fixture (re-sembrar SQL).')
    }
    await expect(cantInput).toHaveValue('10', { timeout: 10000 })

    // Recibir 5 (< pedido 10) y dejar el motivo del faltante vacío
    await setReactNumber(cantInput, '5')
    await expect(cantInput).toHaveValue('5')

    await page.getByRole('button', { name: /Confirmar recepción/i }).click()

    // POSITIVO: el guard bloquea pidiendo el motivo + NO aparece el modal de "Recepción #N confirmada"
    await expect(page.getByText(/Indicá el motivo del faltante/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: /Recepción #?\d* ?confirmada/i })).not.toBeVisible()
  })
})
