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
 * 🌱 SIEMBRA SU PROPIA PRECONDICIÓN (2026-07-16). Antes era ONE-SHOT y se rompía solo: genera la
 * nómina del mes Y su gasto, o sea que **consume su propia precondición** — cuando todas las
 * liquidaciones del período quedan con `gasto_id`, el botón "Generar gasto" desaparece y el spec
 * queda ROJO el resto del mes (determinístico, no flake). Probado con la DB: período 2026-07 → 5
 * liquidaciones, las 5 ya con gasto, 0 pendientes. Es la misma trampa que tenía el spec 42.
 * Ahora `garantizarLiquidacionSinGasto` libera una revirtiendo el efecto de la corrida anterior
 * (borra un gasto PENDIENTE; el FK ON DELETE SET NULL desliga la liquidación de forma atómica →
 * el gasto duplicado es imposible por construcción). Ver el helper para las 3 redes de seguridad.
 *
 * Corre con OWNER=DUEÑO (chromium) contra el tenant DEV (Almacén Jorgito; 5 empleados con salario).
 */
import { test, expect } from '@playwright/test'
import { garantizarLiquidacionSinGasto } from './helpers/fixtures'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Nómina RRHH → gasto (mutante)', () => {
  test('generar nómina del mes y su gasto → aparece en Gastos como pendiente', async ({ page, request }) => {
    await goto(page, '/rrhh')
    await waitForApp(page)

    // 🌱 Precondición GARANTIZADA: al menos una liquidación del mes sin gasto generado.
    // (Necesita la sesión ya cargada en el browser para tomar el token → va después del goto.)
    await garantizarLiquidacionSinGasto(page, request)

    // Tab Nómina
    await page.getByRole('button', { name: /Nómina/i }).first().click()

    // Generar nómina del mes (crea las liquidaciones faltantes del período actual)
    const generarNomina = page.getByRole('button', { name: /Generar nómina del mes/i })
    await expect(generarNomina).toBeVisible({ timeout: 10000 })
    await generarNomina.click()

    // Debe haber al menos una liquidación con acción "Generar gasto" (sin sleep fijo: se espera
    // el botón, no el reloj — los sleeps fijos son la causa raíz de que la suite sea flaky)
    const generarGasto = page.getByRole('button', { name: /Generar gasto/i }).first()
    await expect(generarGasto).toBeVisible({ timeout: 10000 })
    await generarGasto.click()

    // POSITIVO: el gasto del sueldo quedó registrado en Gastos (pendiente)
    await expect(page.getByText(/Gasto generado en Gastos/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Requiere aprobación|Ya tiene un gasto generado/i)).not.toBeVisible()
  })
})
