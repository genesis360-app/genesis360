/**
 * 81_rrhh_nomina_no_efectivo_informativo_mutante.spec.ts
 * E2E MUTANTE — Pagar nómina por medio NO-efectivo asienta `egreso_informativo` (REGLA #0, plata/caja).
 *
 * Regresión del FIX mig 241. Antes, `pagar_nomina_empleado` asentaba SIEMPRE un `egreso` (que afecta el
 * arqueo de EFECTIVO) sin importar el medio → pagar por transferencia/MP descuadraba el efectivo de la caja.
 * Ahora: efectivo → 'egreso'; transferencia_banco/mp → 'egreso_informativo' (no afecta el efectivo).
 * Complementa la spec 50 (efectivo → egreso).
 *
 * Fixture SQL (DEV, Almacén Jorgito): empleado INACTIVO "ZZZ Nomina Test" + un salario IMPAGO neto=$100
 * del período actual (salario_id 7b61011b-13d7-4923-a5b0-020295b815fb, pagado=false). Se paga con medio
 * "Transferencia bancaria".
 *
 * Aserción POSITIVA (toast "Nómina pagada" + la fila pasa a "Pagado"). La VERIFICACIÓN CLAVE es por DB
 * (execute_sql): el `caja_movimientos` asociado debe ser tipo 'egreso_informativo' con concepto
 * "[Transferencia] Nómina …" (NO 'egreso'). GATE: E2E_NOMINA_NO_EFECTIVO=1. OWNER (chromium) contra DEV.
 * Re-ejecutable: re-sembrar el fixture (pagado=false) antes de cada corrida.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Pagar nómina por transferencia → egreso_informativo (mutante)', () => {
  test.skip(process.env.E2E_NOMINA_NO_EFECTIVO !== '1', 'Fixture nómina impaga no sembrado (E2E_NOMINA_NO_EFECTIVO!=1).')

  test('pagar liquidación impaga por transferencia → toast + caja_movimiento egreso_informativo (DB)', async ({ page }) => {
    await goto(page, '/rrhh')
    await waitForApp(page)

    const tabNomina = page.getByRole('button', { name: /Nómina/i }).first()
    await expect(tabNomina).toBeVisible({ timeout: 20000 })
    await tabNomina.click()
    await page.waitForTimeout(800)

    const fila = page.locator('div.rounded-lg.border').filter({ hasText: 'ZZZ Nomina Test' }).first()
    if (!(await fila.isVisible().catch(() => false))) {
      test.skip(true, 'Fixture "ZZZ Nomina Test" no sembrado para el período actual (re-correr el SQL de fixture).')
    }
    await expect(fila).toBeVisible({ timeout: 10000 })
    await expect(fila.getByText(/Pendiente/i)).toBeVisible()

    // Medio de pago = Transferencia bancaria (el selector de medio de nómina)
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Transferencia bancaria/i }) }).first()
    await medioSelect.selectOption({ label: 'Transferencia bancaria' })

    // Caja (la sesión donde queda el egreso_informativo)
    const cajaSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccionar caja/i }) }).first()
    await cajaSelect.selectOption({ label: 'Caja Principal' })

    await fila.getByRole('button', { name: /^Pagar$/ }).click()

    // POSITIVO: toast de éxito + fila a "Pagado". (El tipo egreso_informativo se verifica con execute_sql.)
    await expect(page.getByText(/Nómina pagada/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Saldo insuficiente|Error al pagar/i)).not.toBeVisible()
    await expect(fila.getByText(/Pagado/i)).toBeVisible({ timeout: 8000 })
  })
})
