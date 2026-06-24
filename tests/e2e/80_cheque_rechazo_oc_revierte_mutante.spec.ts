/**
 * 80_cheque_rechazo_oc_revierte_mutante.spec.ts
 * E2E MUTANTE — Cheque propio que pagó una OC se RECHAZA → revierte el pago + reaparece la deuda (REGLA #0, plata).
 *
 * Brazo OC de la Auditoría #5 (`ChequesPanel.cambiarEstado`, L143-168, usa `comprasCheques.reversionPagoOC`).
 * Complementa la spec 31 (brazo GASTO, mismo flujo de UI). Al pasar un cheque 'propio' a 'rechazado' con
 * `oc_id`: baja `monto_pagado` de la OC, recalcula `estado_pago`, y reinserta la deuda del proveedor en
 * `proveedor_cc_movimientos` tipo 'ajuste' (+monto). Riesgo cubierto: un cobro fallido que quedaba como pagado.
 *
 * Fixture SQL (DEV, Almacén Jorgito) — cheque propio 'entregado' que pagó una OC:
 *   -- OC #7 (Mayorista MAX, total 1000) marcada pago_parcial por un cheque de $200:
 *   UPDATE ordenes_compra SET monto_pagado=200, estado_pago='pago_parcial'
 *     WHERE id='1283cda1-0da9-4b7f-b30d-a2d14a635343';   -- (numero 14) ver project_pendientes
 *   INSERT INTO cheques(id, tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro,
 *     proveedor_id, oc_id, created_by)
 *   VALUES ('<fixed-uuid>','3769b1db-...','propio','entregado',200,'E2E-OC-REV','Galicia',CURRENT_DATE,
 *     CURRENT_DATE+30,'6089be10-d5ae-4652-afe9-4c8681d55bab','1283cda1-...','<owner>');
 *
 * Aserción POSITIVA: toast "Cheque → Rechazado" + "Pago de la OC #N revertido". El monto_pagado→0,
 * estado_pago→pendiente_pago y el ajuste +200 en proveedor_cc se verifican aparte con execute_sql.
 * MUTANTE + terminal (el cheque queda rechazado) → re-sembrar el fixture para re-correr.
 * GATE: E2E_RECHAZO_CHEQUE_OC=1. OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NRO_CHEQUE = 'E2E-OC-REV'

test.describe('Rechazo de cheque que pagó una OC (mutante)', () => {
  test.skip(process.env.E2E_RECHAZO_CHEQUE_OC !== '1', 'Fixture cheque+OC no sembrado (E2E_RECHAZO_CHEQUE_OC!=1).')

  test('rechazar el cheque propio → revierte el pago de la OC + reaparece la deuda', async ({ page }) => {
    await goto(page, '/gastos')
    await waitForApp(page)

    // Tab Cheques
    await page.getByRole('button', { name: /Cheques/i }).first().click()
    await page.waitForTimeout(800)

    // Fila del cheque fixture
    const fila = page.locator('div,tr').filter({ hasText: NRO_CHEQUE }).first()
    if (!(await fila.isVisible().catch(() => false))) {
      test.skip(true, `Cheque fixture "${NRO_CHEQUE}" no sembrado (re-correr el SQL de fixture).`)
    }
    await expect(fila).toBeVisible({ timeout: 8000 })

    // Botón de transición "Rechazado" (estadosSiguientes de un propio entregado)
    await fila.getByRole('button', { name: /^Rechazado$/ }).click()

    // POSITIVO: el cheque pasa a Rechazado + el toast de reversión de la OC
    await expect(page.getByText(/Cheque → Rechazado/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Pago de la OC #\d+ revertido/i)).toBeVisible({ timeout: 10000 })
  })
})
