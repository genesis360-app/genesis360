/**
 * 35_recepcion_oc_vinculada_mutante.spec.ts
 * E2E MUTANTE — Recepción VINCULADA a una OC → sube stock + la OC pasa a recibida (REGLA #0).
 *
 * Diferencia con la 29 (recepción sin OC): acá la recepción está ligada a una OC confirmada;
 * al confirmar, además de subir el stock, `RecepcionesPage` recalcula el estado de la OC con el
 * acumulado recibido (`estadoOCdesdeRecibido`, B5) → la OC pasa a 'recibida'/'recibida_parcial'.
 *
 * Usa el botón real "Recibir mercadería" (solo visible en OC 'confirmada' → navega a
 * /recepciones?oc_id=…, que auto-abre el form pre-poblado). Producto simple (Elite Pañuelos).
 * Aserción POSITIVA (modal "Recepción #N confirmada"); el efecto (stock ↑ + OC recibida) se
 * verifica aparte con execute_sql.
 *
 * Requiere una OC confirmada del proveedor "Mayorista MAX" (fixture). Corre con OWNER (chromium)
 * contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'Mayorista MAX'

test.describe('Recepción vinculada a OC (mutante)', () => {
  test('recibir una OC confirmada → sube el stock y la OC pasa a recibida', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)

    // Tab Órdenes de compra + filtrar por el proveedor
    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.waitForTimeout(500)
    const provFilter = page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los proveedores/i }) }).first()
    await provFilter.selectOption({ label: PROVEEDOR })
    await page.waitForTimeout(600)

    // "Recibir mercadería" solo aparece en la OC confirmada → navega a /recepciones?oc_id=…
    const recibir = page.getByRole('button', { name: /Recibir mercadería/i }).first()
    test.skip(!(await recibir.isVisible().catch(() => false)), `Sin OC confirmada de ${PROVEEDOR} para recibir`)
    await recibir.click()

    // El form de recepción auto-abre (oc_id en la URL) pre-poblado con el ítem de la OC
    await page.waitForTimeout(800)
    await waitForApp(page)

    // Por si pide sucursal destino (select con "Sin sucursal"), elegir la primera válida
    const sucSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Sin sucursal/i }) }).first()
    if (await sucSelect.isVisible().catch(() => false)) {
      const sv = await sucSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (sv.length) await sucSelect.selectOption(sv[0]).catch(() => {})
    }

    // Confirmar recepción (cantidad ya pre-cargada = lo pedido en la OC)
    const confirmar = page.getByRole('button', { name: /Confirmar recepción/i }).first()
    await expect(confirmar).toBeVisible({ timeout: 8000 })
    await confirmar.click()

    // POSITIVO: modal de resultado "Recepción #N confirmada"
    await expect(page.getByText(/Recepción #\d+ confirmada/i)).toBeVisible({ timeout: 15000 })
  })
})
