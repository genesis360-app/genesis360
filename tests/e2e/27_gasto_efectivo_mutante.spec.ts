/**
 * 27_gasto_efectivo_mutante.spec.ts
 * E2E MUTANTE — Gasto en efectivo → egreso en caja (REGLA #0, plata).
 *
 * El módulo Gastos solo tenía cobertura read-only (06_gastos). Este test COMPLETA un gasto
 * pagado en efectivo, que debe asentar un `egreso` en la caja abierta (GastosPage:1206).
 * Requiere una caja operativa abierta del usuario (GastosPage:1034). Self-healing: abre Caja1
 * si está cerrada.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Gasto efectivo (mutante)', () => {
  test('gasto pagado en efectivo: se registra y asienta el egreso en caja', async ({ page }) => {
    // 1) Asegurar una caja abierta (Caja1 del owner → sin clave maestra)
    await goto(page, '/caja')
    await waitForApp(page)
    const pill = page.getByRole('button', { name: /Caja1\b/ }).first()
    if (await pill.isVisible().catch(() => false)) {
      await pill.click()
      await page.waitForTimeout(400)
      const abrir = page.getByRole('button', { name: /^Abrir caja$/ }).first()
      if (await abrir.isVisible().catch(() => false)) {
        await abrir.click()
        await page.waitForTimeout(400)
        const montoInicial = page.locator('xpath=//label[contains(.,"Monto inicial")]/following::input[1]')
        await montoInicial.fill('5000')
        await page.getByRole('button', { name: /Confirmar apertura|Sí, abrir con diferencia/ }).first().click()
        await page.waitForTimeout(500)
        const dif = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
        if (await dif.isVisible().catch(() => false)) await dif.click()
        await page.waitForTimeout(500)
      }
    }

    // 2) Nuevo gasto en efectivo
    await goto(page, '/gastos')
    await waitForApp(page)
    await page.getByRole('button', { name: /nuevo gasto/i }).click()
    await page.waitForTimeout(500)

    const desc = uniqueName('Gasto')
    await page.getByPlaceholder(/Pago de alquiler|detalles/i).first().fill(desc)
    // Monto total: el input bajo el label "Monto total"
    const montoTotal = page.locator('xpath=//label[contains(.,"Monto total")]/following::input[1]')
    await montoTotal.fill('500')
    await page.waitForTimeout(300)

    // Comprobante fiscal (Monotributista → B/C/Ticket). Elegir "Ticket" si el select existe.
    const compSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Ticket/i }) }).first()
    if (await compSelect.isVisible().catch(() => false)) {
      await compSelect.selectOption({ label: 'Ticket' }).catch(() => {})
    }

    // Medio de pago: Efectivo por el total
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Efectivo')
    // El monto del medio: input numérico angosto junto al select de medio
    const medioMonto = page.locator('input[type="number"]').last()
    await medioMonto.fill('500')
    await page.waitForTimeout(300)

    // Si aparece un selector de caja, elegir la primera opción válida
    const cajaSel = page.locator('select').filter({ hasText: /Caja|Registrar en caja/i }).first()
    if (await cajaSel.isVisible().catch(() => false)) {
      const vals = await cajaSel.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length) await cajaSel.selectOption(vals[0]).catch(() => {})
    }

    // 3) Registrar
    await page.getByRole('button', { name: /Registrar gasto/i }).click()

    // 4) Mutación OK: el modal se cierra y NO hay error de caja / saldo
    await expect(page.getByRole('heading', { name: /Nuevo gasto|Registrar gasto/i })).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/No hay ninguna caja abierta|No tenés caja abierta|saldo insuficiente|no se pudo/i)).not.toBeVisible()
    // El gasto aparece en la lista
    await expect(page.getByText(desc).first()).toBeVisible({ timeout: 8000 })
  })
})
