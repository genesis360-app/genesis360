/**
 * 50_rrhh_pagar_nomina_mutante.spec.ts
 * E2E MUTANTE — Pagar nómina RRHH → egreso de caja + marca pagada (REGLA #0, contable/caja).
 *
 * RPC `pagar_nomina_empleado` (mig 145): valida sesión de caja abierta + saldo (si efectivo),
 * inserta un `caja_movimientos` 'egreso' ("Nómina {dni} - {MM/YYYY}") y marca `rrhh_salarios`
 * pagado=true + caja_movimiento_id + medio_pago. Es el complemento de la spec 37 (que valida
 * "generar el gasto del sueldo"); acá se valida el PAGO efectivo desde caja.
 *
 * Fixture SQL (DEV, tenant Almacén Jorgito): empleado INACTIVO "ZZZ Nomina Test" (inactivo para
 * no contaminar "Generar nómina del mes") + un salario IMPAGO neto=$100 del período actual
 * (salario_id 7b61011b-13d7-4923-a5b0-020295b815fb). Se paga en EFECTIVO desde "Caja Principal"
 * (saldo ~$35k ≫ $100, así se ejercita la rama de chequeo de saldo del RPC).
 *
 * Aserción POSITIVA (toast "Nómina pagada" + la fila pasa a "Pagado"); el egreso en
 * `caja_movimientos` y el flag `pagado=true` + `caja_movimiento_id` se verifican aparte con
 * execute_sql. Corre con OWNER=DUEÑO (chromium) contra DEV.
 *
 * Re-ejecutable: el fixture se re-siembra por SQL (pagado=false) antes de cada corrida.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Pagar nómina RRHH (mutante)', () => {
  test('pagar liquidación impaga en efectivo → toast + egreso de caja', async ({ page }) => {
    await goto(page, '/rrhh')
    await waitForApp(page)

    // Tab Nómina (esperar a que renderice — tolera cold-load lento del dev server)
    const tabNomina = page.getByRole('button', { name: /Nómina/i }).first()
    await expect(tabNomina).toBeVisible({ timeout: 20000 })
    await tabNomina.click()
    await page.waitForTimeout(800)

    // La fila del fixture debe estar visible (período actual). Si no aparece, el fixture
    // no fue sembrado para este período → no seguimos (evita falso-rojo / pagar otra liquidación).
    const fila = page.locator('div.rounded-lg.border').filter({ hasText: 'ZZZ Nomina Test' }).first()
    if (!(await fila.isVisible().catch(() => false))) {
      test.skip(true, 'Fixture "ZZZ Nomina Test" no sembrado para el período actual (re-correr el SQL de fixture).')
    }
    await expect(fila).toBeVisible({ timeout: 10000 })
    // La fila arranca en estado Pendiente (no pagada)
    await expect(fila.getByText(/Pendiente/i)).toBeVisible()

    // Seleccionar la caja operativa con saldo (Caja Principal). El medio queda en "Efectivo"
    // (default) → ejercita la validación de saldo del RPC.
    const cajaSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccionar caja/i }) }).first()
    await cajaSelect.selectOption({ label: 'Caja Principal' })

    // Pagar la liquidación del fixture
    await fila.getByRole('button', { name: /^Pagar$/ }).click()

    // POSITIVO: toast de éxito + la fila pasa a "Pagado" con medio "Efectivo"
    await expect(page.getByText(/Nómina pagada/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Saldo insuficiente|Error al pagar/i)).not.toBeVisible()
    await expect(fila.getByText(/Pagado/i)).toBeVisible({ timeout: 8000 })
  })
})
