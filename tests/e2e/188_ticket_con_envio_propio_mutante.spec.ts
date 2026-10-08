/**
 * 188_ticket_con_envio_propio_mutante.spec.ts
 * E2E MUTANTE — Venta con envío PROPIO: el costo del envío sale en el ticket y suma al TOTAL (REGLA #0).
 *
 * Reporte de GO 2026-10-07 (El Tilo, PROD, reserva #50 con envío propio de $45.000): "en el ticket no vimos la línea del
 * costo del envío". El dato estaba bien guardado (`ventas.costo_envio` = 45000, `monto_pagado` = productos + envío).
 *
 * Verifica, en el ticket que aparece al cobrar (el que se imprime):
 *   - el renglón "Envío" con el costo, y
 *   - TOTAL = productos + envío (no el texto concatenado ni solo los productos),
 * y en la base: `ventas.costo_envio` y `monto_pagado` = total + envío.
 *
 * Corre con OWNER (chromium) contra DEV (Almacén Jorgito, modo avanzado).
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { agregarPrimerProductoAlCarrito, visible } from './helpers/fixtures'

const COSTO_ENVIO = 4500
const aNumero = (t: string | null) =>
  parseFloat((t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0

async function cobrarEnEfectivo(page: Page) {
  const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent()
  const totalNum = aNumero(totalTxt)
  expect(totalNum).toBeGreaterThan(COSTO_ENVIO)   // el total del POS ya suma el envío
  const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
  await expect(medioSelect).toBeVisible({ timeout: 5000 })
  await medioSelect.selectOption('Efectivo')
  const montoInput = page.getByPlaceholder(/^Monto$/i).first()
  if (await montoInput.isVisible().catch(() => false)) { await montoInput.fill(String(totalNum)); await montoInput.blur() }
  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const vals = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (vals.length) await cajaSelect.selectOption(vals[0])
  }
  return totalNum
}

test.describe('Ticket con envío propio (mutante)', () => {
  test('venta despachada con envío propio: el ticket muestra el envío y el TOTAL lo suma', async ({ page }) => {
    test.setTimeout(90000)
    await goto(page, '/ventas')
    await waitForApp(page)
    await agregarPrimerProductoAlCarrito(page)

    await page.getByText('Incluir envío', { exact: true }).click()
    const propioBtn = page.getByRole('button', { name: /Envío propio/i })
    if (await visible(propioBtn, 3000)) await propioBtn.click()
    const montoFijo = page.getByRole('button', { name: /Monto fijo/i })
    if (await visible(montoFijo, 2000)) await montoFijo.click()
    const costoInput = page.locator('xpath=//label[normalize-space()="Costo de envío ($)"]/following::input[1]')
    await expect(costoInput).toBeVisible({ timeout: 5000 })
    await costoInput.fill(String(COSTO_ENVIO))

    const totalPOS = await cobrarEnEfectivo(page)

    const finalizar = page.getByRole('button', { name: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/Venta finalizada/i)).toBeVisible({ timeout: 10000 })

    // El ticket (modal) — renglón "Envío" con el costo
    const ticket = page.locator('#ticket-print')
    await expect(ticket, 'no apareció el ticket').toBeVisible({ timeout: 15000 })
    const filaEnvio = ticket.locator('div.flex.justify-between:has(> span:text-is("Envío"))')
    await expect(filaEnvio, 'el ticket no muestra el renglón del envío').toBeVisible({ timeout: 8000 })
    expect(aNumero(await filaEnvio.locator('span').last().textContent())).toBe(COSTO_ENVIO)

    // TOTAL = productos + envío (lo mismo que cobró el POS)
    const filaTotal = ticket.locator('div.flex.justify-between:has(> span:text-is("TOTAL"))')
    await expect(filaTotal).toBeVisible()
    const totalTicket = aNumero(await filaTotal.locator('span').last().textContent())
    expect(Math.abs(totalTicket - totalPOS), `TOTAL del ticket ${totalTicket} ≠ cobrado ${totalPOS}`).toBeLessThan(1)

    await ticket.screenshot({ path: 'test-results/188-ticket-envio.png' })
  })
  // El caso de El Tilo: RESERVA (con cliente) + envío propio, cobrada entera en efectivo.
  test('reserva con envío propio: el ticket muestra el envío y el TOTAL lo suma', async ({ page }) => {
    test.setTimeout(90000)
    await goto(page, '/ventas')
    await waitForApp(page)
    await agregarPrimerProductoAlCarrito(page)

    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    await page.getByPlaceholder(/Buscar por nombre o DNI/i).first().fill('a')
    const primerCliente = page.locator('div.absolute.z-20 button').first()
    await expect(primerCliente).toBeVisible({ timeout: 5000 })
    await primerCliente.click()

    await page.getByText('Incluir envío', { exact: true }).click()
    const propioBtn = page.getByRole('button', { name: /Envío propio/i })
    if (await visible(propioBtn, 3000)) await propioBtn.click()
    const montoFijo = page.getByRole('button', { name: /Monto fijo/i })
    if (await visible(montoFijo, 2000)) await montoFijo.click()
    const costoInput = page.locator('xpath=//label[normalize-space()="Costo de envío ($)"]/following::input[1]')
    await expect(costoInput).toBeVisible({ timeout: 5000 })
    await costoInput.fill(String(COSTO_ENVIO))

    // Fecha de entrega (mañana) → el ticket la muestra junto con el transporte y el n° de envío
    const manana = new Date(Date.now() + 86400000)
    const fechaISO = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`
    await page.locator('xpath=//label[normalize-space()="Fecha de entrega"]/following::input[1]').fill(fechaISO)

    await page.getByRole('button', { name: 'Reservar', exact: true }).first().click()
    const totalPOS = await cobrarEnEfectivo(page)
    await page.getByRole('button', { name: /Reservar stock/i }).click()

    const ticket = page.locator('#ticket-print')
    await expect(ticket, 'no apareció el ticket').toBeVisible({ timeout: 15000 })
    const filaEnvio = ticket.locator('div.flex.justify-between:has(> span:text-is("Envío"))')
    await expect(filaEnvio, 'el ticket de la reserva no muestra el renglón del envío').toBeVisible({ timeout: 15000 })
    // 🚚 Datos de la entrega (pedido de GO 07/10): transporte + n° de envío y la fecha
    const entrega = ticket.getByTestId('ticket-entrega')
    await expect(entrega).toContainText(/Envío propio · Envío #\d+/, { timeout: 10000 })
    const ddmm = `${String(manana.getDate()).padStart(2, '0')}/${String(manana.getMonth() + 1).padStart(2, '0')}`
    await expect(entrega).toContainText(`Entrega:`)
    await expect(entrega).toContainText(ddmm)
    await ticket.screenshot({ path: 'test-results/188-ticket-reserva-envio.png' })
    expect(aNumero(await filaEnvio.locator('span').last().textContent())).toBe(COSTO_ENVIO)
    const totalTicket = aNumero(await ticket.locator('div.flex.justify-between:has(> span:text-is("TOTAL"))').locator('span').last().textContent())
    expect(Math.abs(totalTicket - totalPOS), `TOTAL del ticket ${totalTicket} ≠ cobrado ${totalPOS}`).toBeLessThan(1)
  })
})
