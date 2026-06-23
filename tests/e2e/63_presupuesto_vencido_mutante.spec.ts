/**
 * 63_presupuesto_vencido_mutante.spec.ts
 * E2E — Presupuesto vencido bloquea convertir hasta actualizar precios (REGLA #0, plata).
 *
 * L44 (`VentasPage.isPresupuestoVencido` ~57 + botones ~5818/5841): un presupuesto cuya antigüedad
 * (`updated_at`) supera `presupuesto_validez_dias` se marca vencido → los CTA "Reservar stock" y
 * "Finalizar (rebaja stock)" quedan DISABLED y aparece el banner "Presupuesto vencido. Actualizá los
 * precios antes de convertirlo a venta". Convertir con precios viejos facturaría/cobraría a un precio
 * desactualizado → plata mal.
 *
 * Fixture SQL (DEV, Almacén Jorgito): presupuesto `pendiente` (total $7.777, cliente Fede Messina) con
 * `created_at`/`updated_at` = hace 40 días (> 30 de validez). Read-only: el test NO convierte → NO muta.
 * Skip-guard si la fila no está (re-sembrar el SQL). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('Presupuesto vencido bloquea convertir', () => {
  test('presupuesto de 40 días (validez 30) → vencido: banner + "Finalizar" deshabilitado', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    // Historial → filtrar presupuestos (pendiente)
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(600)
    await page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los estados/ }) }).first()
      .selectOption('pendiente')
    await page.waitForTimeout(700)

    // Abrir el presupuesto fixture (total distintivo $7.777)
    const fila = page.locator('div.divide-y > div').filter({ hasText: /7\.777/ }).first()
    if (!(await fila.isVisible().catch(() => false))) {
      test.skip(true, 'Presupuesto fixture $7.777 no encontrado (re-sembrar el SQL).')
    }
    await fila.click()
    await page.waitForTimeout(800)

    // POSITIVO: banner de vencido visible
    await expect(page.getByText(/Presupuesto vencido/i).first()).toBeVisible({ timeout: 6000 })
    await expect(page.getByText(/Actualizá los precios antes de convertirlo/i)).toBeVisible()

    // El CTA de conversión queda DESHABILITADO (no se puede convertir con precios viejos)
    await expect(page.getByRole('button', { name: /Finalizar \(rebaja stock\)/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Reservar stock$/ })).toBeDisabled()
  })
})
