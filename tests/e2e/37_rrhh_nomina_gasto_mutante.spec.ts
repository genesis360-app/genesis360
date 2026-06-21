/**
 * 37_rrhh_nomina_gasto_mutante.spec.ts
 * E2E MUTANTE — Nómina RRHH → genera el gasto del sueldo (REGLA #0, contable).
 *
 * El pago de sueldos se contabiliza en el módulo Gastos (RH3/B7, `RrhhPage.generarGastoNomina`):
 * por cada liquidación, "Generar gasto" inserta una fila en `gastos` ("Sueldo {empleado} — período",
 * categoría Sueldos, monto = neto, estado_pago 'pendiente') y vincula `rrhh_salarios.gasto_id`.
 *
 * Flujo: tab Nómina → "Generar nómina del mes" (crea las liquidaciones faltantes, idempotente) →
 * "Generar gasto" en una liquidación. Aserción POSITIVA (toast "Gasto generado en Gastos");
 * la fila en `gastos` + el link `gasto_id` se verifican aparte con execute_sql.
 *
 * Corre con OWNER=DUEÑO (chromium) contra el tenant DEV (Almacén Jorgito; 5 empleados con salario).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Nómina RRHH → gasto (mutante)', () => {
  test('generar nómina del mes y su gasto → aparece en Gastos como pendiente', async ({ page }) => {
    await goto(page, '/rrhh')
    await waitForApp(page)

    // Tab Nómina
    await page.getByRole('button', { name: /Nómina/i }).first().click()
    await page.waitForTimeout(600)

    // Generar nómina del mes (crea las liquidaciones faltantes del período actual)
    await page.getByRole('button', { name: /Generar nómina del mes/i }).click()
    await page.waitForTimeout(1500)

    // Debe haber al menos una liquidación con acción "Generar gasto"
    const generarGasto = page.getByRole('button', { name: /Generar gasto/i }).first()
    await expect(generarGasto).toBeVisible({ timeout: 10000 })
    await generarGasto.click()

    // POSITIVO: el gasto del sueldo quedó registrado en Gastos (pendiente)
    await expect(page.getByText(/Gasto generado en Gastos/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Requiere aprobación|Ya tiene un gasto generado/i)).not.toBeVisible()
  })
})
