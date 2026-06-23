/**
 * 69_cc_revertir_condonacion_mutante.spec.ts
 * E2E MUTANTE — Revertir condonación restaura la deuda CC (REGLA #0, contable/patrimonial).
 *
 * ISS-151 (`ClientesPage.revertirDeudaCC` ~532-554): deshacer una condonación (write-off) quita las
 * entradas "Condonación CC" del `medio_pago` y recomputa `monto_pagado` con los pagos reales → la deuda
 * vuelve a estar viva ("falta pagar"). Es plata patrimonial (un receivable que se restaura) → debe
 * recomputar exacto.
 *
 * Fixture SQL (DEV, Almacén Jorgito): cliente "ZZZ Revertir CC Test" (CC habilitada) con venta condonada
 * #247 (total $5.000, monto_pagado=5.000, medio "Condonación CC") + venta pendiente #248 (deuda $3.000,
 * para que el cliente aparezca en el tab CC). Esperado al revertir #247: `monto_pagado=0` y el medio
 * "Condonación CC" removido → deuda $5.000 restaurada.
 *
 * Flujo UI: Clientes → tab "Cuenta Corriente" → fila de la venta #247 (badge "Condonada") → "Revertir"
 * (confirm nativo). Aserción POSITIVA del toast; el efecto en DB se verifica aparte con execute_sql.
 * MUTANTE: re-sembrar el SQL para re-correr. GATE: E2E_CC_REVERTIR=1. Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Revertir condonación CC (mutante)', () => {
  test.skip(process.env.E2E_CC_REVERTIR !== '1', 'Fixture cliente+ventas CC no sembrado (E2E_CC_REVERTIR!=1).')

  test('revertir la venta condonada #247 → restaura la deuda ("falta pagar")', async ({ page }) => {
    page.on('dialog', d => d.accept())  // confirm() de revertir
    await goto(page, '/clientes')
    await waitForApp(page)

    // Tab "Cuenta Corriente"
    await page.getByRole('button', { name: /Cuenta Corriente/i }).first().click()
    await page.waitForTimeout(900)

    // Fila de la venta condonada #247 → botón "Revertir"
    const row247 = page.locator('div').filter({ hasText: /Venta #247 ·/ }).filter({ has: page.getByRole('button', { name: /^Revertir$/ }) }).last()
    if (!(await row247.isVisible().catch(() => false))) {
      test.skip(true, 'Fila de la venta condonada #247 no visible (re-sembrar fixture).')
    }
    await row247.getByRole('button', { name: /^Revertir$/ }).click()

    // POSITIVO: la venta se revirtió a "falta pagar"
    await expect(page.getByText(/revertida a "falta pagar"/i)).toBeVisible({ timeout: 10000 })
  })
})
