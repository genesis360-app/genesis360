/**
 * 39_cc_condonacion_mutante.spec.ts
 * E2E MUTANTE — Condonación de deuda CC (write-off) (REGLA #0, contable).
 *
 * Condonar una venta en cuenta corriente (ISS-151, `ClientesPage.condonarDeudaCC`) da la deuda
 * por PERDIDA (incobrable): setea `ventas.monto_pagado = total` + agrega el tag 'Condonación CC'
 * al `medio_pago` (que queda EXCLUIDO de los gráficos de ingresos — no es ingreso real). Solo
 * DUEÑO/SUPERVISOR/ADMIN.
 *
 * Aserción POSITIVA (toast "Deuda Venta #N condonada"); el efecto (monto_pagado=total + tag
 * 'Condonación CC') se verifica aparte con execute_sql.
 *
 * Usa el cliente "Gaston Otranto" (tiene deuda CC en el tenant de prueba DEV). Corre con OWNER
 * (chromium). NOTA: el otro flujo de #9 — "dar de baja incobrable" (B6) — exige la clave maestra
 * del tenant (configurada, desconocida) → no automatizable acá; se valida la condonación per-venta.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLIENTE = 'Gaston Otranto'

test.describe('Condonación de deuda CC (mutante)', () => {
  test('condonar una venta CC → la deuda queda saldada como incobrable (write-off)', async ({ page }) => {
    page.on('dialog', d => d.accept().catch(() => {}))

    await goto(page, '/clientes')
    await waitForApp(page)

    // Tab Cuenta Corriente
    await page.getByRole('button', { name: /Cuenta Corriente/i }).first().click()
    await page.waitForTimeout(800)

    // Card del cliente con su lista de ventas CC + botón "Condonar"
    const card = page.locator('div').filter({ hasText: new RegExp(CLIENTE) })
      .filter({ has: page.getByRole('button', { name: /^Condonar$/ }) }).last()
    test.skip(!(await card.isVisible().catch(() => false)), `${CLIENTE} no tiene deuda CC condonable`)
    await card.getByRole('button', { name: /^Condonar$/ }).first().click()

    // POSITIVO: toast de condonación (el confirm se acepta vía el handler de dialog)
    await expect(page.getByText(/Deuda Venta #\d+ condonada/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Error al condonar/i)).not.toBeVisible()
  })
})
