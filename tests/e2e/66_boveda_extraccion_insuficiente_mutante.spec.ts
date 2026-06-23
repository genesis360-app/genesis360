/**
 * 66_boveda_extraccion_insuficiente_mutante.spec.ts
 * E2E MUTANTE — Extracción de Bóveda no puede dejar la cuenta en negativo (REGLA #0, contable).
 *
 * `CajaPage.extraerDeBoveda` (~316-317): antes de asentar el egreso + `boveda_retiros`, valida que el
 * monto no supere el saldo de la cuenta elegida; si lo supera → "Saldo insuficiente…", NO inserta nada.
 * Extraer más de lo que hay descuadraría la bóveda (capital negativo) → cero error tolerado.
 *
 * Datos reales del tenant (Almacén Jorgito, NO fixture): la bóveda tiene cuentas con saldo. Se intenta
 * extraer un monto enorme ($999.999.999) de la 1ª cuenta disponible → el guard bloquea. Read-only: el
 * bloqueo ocurre ANTES de cualquier insert → NO muta (no se crea retiro ni movimiento).
 *
 * Skip-guards si no hay acceso a Bóveda / sin cuentas con saldo. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Extracción de Bóveda no deja negativo (mutante)', () => {
  test('extraer $999.999.999 (> saldo) → "Saldo insuficiente", no muta', async ({ page }) => {
    await goto(page, '/caja')
    await waitForApp(page)

    // Ir a la pestaña Caja Fuerte / Bóveda (solo roles con acceso)
    const tabFuerte = page.getByRole('button', { name: /^Caja Fuerte$/ }).first()
    if (!(await tabFuerte.isVisible().catch(() => false))) {
      test.skip(true, 'Sin acceso a la pestaña Caja Fuerte con este rol/config.')
    }
    await tabFuerte.click()
    await page.waitForTimeout(700)

    // Abrir el modal de extracción
    const btnExtraer = page.getByRole('button', { name: /Extraer dinero/i }).first()
    if (!(await btnExtraer.isVisible().catch(() => false))) {
      test.skip(true, 'Botón "Extraer dinero" no disponible (permiso/saldo).')
    }
    await btnExtraer.click()
    await expect(page.getByRole('heading', { name: /Extraer dinero de la bóveda/i })).toBeVisible({ timeout: 5000 })

    // Elegir la 1ª cuenta disponible (el select solo lista cuentas con saldo > 0)
    const cuentaSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná una cuenta/ }) }).first()
    const opciones = await cuentaSelect.locator('option').count()
    if (opciones <= 1) {
      test.skip(true, 'No hay cuentas con saldo en la bóveda para probar.')
    }
    await cuentaSelect.selectOption({ index: 1 })

    // Monto enorme (excede cualquier saldo) + motivo
    await setReactNumber(page.locator('.fixed.inset-0 input[type="number"]').first(), '999999999')
    await page.getByPlaceholder(/Sueldo del dueño/i).fill('E2E over-extraction (no debe pasar)')

    // Confirmar → guard de saldo insuficiente
    await page.getByRole('button', { name: /Confirmar extracción/ }).click()
    await expect(page.getByText(/Saldo insuficiente/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el modal sigue abierto (la extracción no se registró)
    await expect(page.getByRole('heading', { name: /Extraer dinero de la bóveda/i })).toBeVisible()
  })
})
