/**
 * 31_cheque_gasto_rechazo_mutante.spec.ts
 * E2E MUTANTE — Cheque propio de un gasto, RECHAZADO → revierte el pago (REGLA #0, contable).
 *
 * Circuito completo de cheques (Auditoría #5):
 *   1) Se crea un gasto SIN medio de pago → queda 'pendiente' (con botón "Registrar pago").
 *   2) Se paga con medio "Cheque" → crea un cheque propio/'entregado' vinculado (gasto_id) y
 *      deja el gasto 'pagado' (GastosPage.registrarPagoGasto → cheques.insert).
 *   3) En Gastos → Cheques se marca el cheque "Rechazado" → el pago se REVIERTE: el gasto
 *      vuelve a 'pendiente' (ChequesPanel.cambiarEstado → reversionPagoGasto).
 *
 * Aserción POSITIVA del resultado (toast de reversión) — la mutación en DB (gasto vuelve a
 * pendiente + cheque 'rechazado') se verifica aparte con execute_sql.
 *
 * Requiere que el tenant tenga el método de pago "Cheque" (fixture). Corre con el usuario
 * OWNER (proyecto chromium) contra el tenant de prueba DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Cheque de gasto rechazado → reversión (mutante)', () => {
  test('pagar gasto con cheque y rechazarlo revierte el pago a pendiente', async ({ page }) => {
    const stamp = Date.now()
    const desc = `GastoCheque_${stamp}`
    const nroCheque = `CHQ${stamp}` // único → localiza el cheque y permite verificar en DB
    // Fecha de cobro futura (obligatoria al pagar con cheque)
    const fechaCobro = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

    // 1) Nuevo gasto SIN medio de pago → queda pendiente
    await goto(page, '/gastos')
    await waitForApp(page)
    await page.getByRole('button', { name: /nuevo gasto/i }).click()
    await page.waitForTimeout(500)

    await page.getByPlaceholder(/Pago de alquiler|detalles/i).first().fill(desc)
    const montoTotal = page.locator('xpath=//label[contains(.,"Monto total")]/following::input[1]')
    await montoTotal.fill('700')
    await page.waitForTimeout(300)

    // NO se carga medio de pago → estado_pago 'pendiente' (borrador permitido)
    await page.getByRole('button', { name: /Registrar gasto/i }).click()

    // El modal se cierra y el gasto aparece en la lista
    await expect(page.getByRole('heading', { name: /Nuevo gasto|Registrar gasto/i })).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(desc).first()).toBeVisible({ timeout: 8000 })

    // 2) Pagar el gasto con cheque → abre el modal "Registrar pago" de la fila del gasto
    const fila = page.locator('tr, div').filter({ hasText: new RegExp(desc) })
      .filter({ has: page.getByRole('button', { name: /Registrar pago/i }) }).last()
    await fila.getByRole('button', { name: /Registrar pago/i }).first().click()

    // Modal abierto (aserción positiva — evita falso-verde)
    await expect(page.getByRole('heading', { name: /^Registrar pago$/ })).toBeVisible({ timeout: 5000 })

    await page.locator('xpath=//label[contains(.,"Monto a pagar")]/following::input[1]').fill('700')
    // Método de pago = Cheque
    const medioSel = page.locator('xpath=//label[contains(.,"Método de pago")]/following::select[1]')
    await medioSel.selectOption({ label: 'Cheque' })
    await page.waitForTimeout(300)

    // Datos del cheque (la sección aparece al elegir Cheque)
    await page.getByPlaceholder(/N° cheque/i).fill(nroCheque)
    await page.locator('input[type="date"]').last().fill(fechaCobro)
    await page.waitForTimeout(200)

    // Confirmar pago
    await page.getByRole('button', { name: /^Registrar$/ }).click()

    // POSITIVO: el cheque quedó registrado / el gasto se pagó
    await expect(
      page.getByText(/Cheque registrado en Gastos → Cheques|Gasto pagado completamente/i).first(),
    ).toBeVisible({ timeout: 10000 })

    // 3) Ir al tab Cheques y rechazar el cheque recién creado
    await page.getByRole('button', { name: /^Cheques$/ }).first().click()
    await page.waitForTimeout(800)

    // Tarjeta del cheque (por su N° único) con el botón "Rechazado"
    const cardCheque = page.locator('div').filter({ hasText: new RegExp(nroCheque) })
      .filter({ has: page.getByRole('button', { name: /^Rechazado$/ }) }).last()
    await expect(cardCheque).toBeVisible({ timeout: 8000 })
    await cardCheque.getByRole('button', { name: /^Rechazado$/ }).first().click()

    // POSITIVO: el toast de reversión confirma que el pago volvió a pendiente (REGLA #0)
    await expect(page.getByText(/Pago del gasto .* revertido/i)).toBeVisible({ timeout: 10000 })
  })
})
