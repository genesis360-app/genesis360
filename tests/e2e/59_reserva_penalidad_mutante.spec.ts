/**
 * 59_reserva_penalidad_mutante.spec.ts
 * E2E MUTANTE — Cancelar reserva retiene `reserva_penalidad_pct`% de la seña (REGLA #0, plata).
 *
 * Lógica E2 (`VentasPage.cambiarEstado`, ~4094-4112): al cancelar una reserva con seña cobrada, se
 * retiene `reserva_penalidad_pct`% (no se devuelve) y el resto (`seña × (1 − pct/100)`) va al destino
 * elegido. Con destino="crédito a favor", inserta una fila en `cliente_creditos` por ese resto. La
 * matemática de la penalidad es plata real del cliente → cero error tolerado.
 *
 * Fixture SQL (DEV, Almacén Jorgito): `reserva_penalidad_pct = 20` + reserva #ZZZ con seña $1000
 * (total $5678) del cliente "Fede Messina" y 2u reservadas en stock. Esperado al cancelar (destino
 * crédito): `cliente_creditos = 1000 × (1 − 0.20) = $800` y el stock reservado liberado.
 *
 * Flujo UI: Historial → filtrar 'reservada' → abrir la reserva $5.678 → "Cancelar venta" (OWNER pasa
 * el gate de rol) → modal: motivo + destino "Crédito a favor" → confirmar. Aserción POSITIVA del toast
 * "$800 acreditados al cliente"; el monto en `cliente_creditos` se verifica aparte con execute_sql.
 *
 * MUTANTE: cancela la reserva y crea el crédito (se limpia por SQL tras verificar). Corre con OWNER
 * (chromium) contra DEV. GATE: requiere E2E_PENALIDAD_FIXTURE=1 (solo cuando el fixture está sembrado).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('Cancelar reserva con penalidad (mutante)', () => {
  test.skip(process.env.E2E_PENALIDAD_FIXTURE !== '1', 'Fixture reserva_penalidad_pct=20 + reserva no sembrado (E2E_PENALIDAD_FIXTURE!=1).')

  test('penalidad 20% sobre seña $1000 → acredita $800 al cliente (destino crédito)', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    // Historial → filtrar reservadas
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(600)
    await page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los estados/ }) }).first()
      .selectOption('reservada')
    await page.waitForTimeout(700)

    // Abrir la reserva fixture (total distintivo $5.678)
    const fila = page.locator('div.divide-y > div').filter({ hasText: /5\.678/ }).first()
    await expect(fila).toBeVisible({ timeout: 8000 })
    await fila.click()
    await page.waitForTimeout(800)

    // "Cancelar venta" → abre el modal de cancelación de reserva (con seña)
    await page.getByRole('button', { name: /^Cancelar venta$/ }).click()
    await expect(page.getByRole('heading', { name: /Cancelar reserva/i })).toBeVisible({ timeout: 6000 })

    // El modal muestra la penalidad y el monto a devolver
    await expect(page.getByText(/Penalidad \(20%\)/i)).toBeVisible()

    // Motivo (catálogo) — elegir el primer motivo real (no el placeholder)
    const motivoSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un motivo/ }) }).first()
    const motivos = await motivoSel.locator('option').evaluateAll(
      opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
    )
    await motivoSel.selectOption(motivos[0])

    // Destino = Crédito a favor (habilitado porque la reserva tiene cliente)
    await page.getByRole('radio').nth(1).check()

    // Confirmar cancelación → POSITIVO: acredita $800
    await page.getByRole('button', { name: /Confirmar cancelación/i }).click()
    await expect(page.getByText(/\$?800 acreditados al cliente/i)).toBeVisible({ timeout: 12000 })
  })
})
