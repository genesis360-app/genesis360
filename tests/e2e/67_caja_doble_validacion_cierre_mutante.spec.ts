/**
 * 67_caja_doble_validacion_cierre_mutante.spec.ts
 * E2E MUTANTE — Doble validación de cierre (B7) exige un 2º usuario válido (REGLA #0, contable).
 *
 * B7 (`CajaPage.cerrarCaja` ~674-705 + `config_caja.doble_validacion_cierre`): con la doble validación
 * activada, cerrar caja exige email+password de un 2º usuario (DUEÑO/SUPERVISOR/ADMIN, distinto del que
 * cierra), autenticado contra Supabase. Sin las credenciales / con credenciales inválidas el cierre se
 * BLOQUEA. Es un control de 4 ojos sobre el arqueo → cero error tolerado.
 *
 * Fixture SQL (DEV, Almacén Jorgito): `config_caja.doble_validacion_cierre=true` + sesión ABIERTA propia
 * del OWNER en Caja3 + un arqueo. Reversible (restaurar config + borrar sesión).
 *
 * Aserciones (NEGATIVO, no muta): (a) sin 2º usuario → "Doble validación activada: ingresá email y
 * contraseña del 2do usuario."; (b) credenciales inválidas → "Credenciales del 2do usuario inválidas".
 * El cierre nunca se completa. GATE: requiere E2E_CAJA_B7=1. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Doble validación de cierre B7 (mutante)', () => {
  test.skip(process.env.E2E_CAJA_B7 !== '1', 'Spec con fixture (config_caja.doble_validacion_cierre + sesión): correr con E2E_CAJA_B7=1.')

  test('cierre con B7 activo: sin 2º usuario bloquea; credenciales inválidas bloquean', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/caja')
    await waitForApp(page)

    // Seleccionar la caja con la sesión propia abierta (Caja3)
    const pill = page.locator('button', { hasText: /^\s*Caja3/ }).first()
    if (!(await pill.isVisible().catch(() => false))) {
      test.skip(true, 'Caja3 no visible en el selector (re-sembrar fixture).')
    }
    await pill.click()
    await page.waitForTimeout(700)

    const btnCerrar = page.getByRole('button', { name: /Cerrar caja/i }).first()
    if (!(await btnCerrar.isVisible().catch(() => false))) {
      test.skip(true, 'Botón "Cerrar caja" no visible (sesión propia no cargó).')
    }
    await btnCerrar.click()
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible({ timeout: 5000 })

    // El bloque de doble validación está presente
    await expect(page.getByText(/Doble validación del cierre/i)).toBeVisible({ timeout: 4000 })

    // Efectivo contado = saldo ($1.000)
    await setReactNumber(page.locator('.fixed.inset-0').getByRole('spinbutton').first(), '1000')

    // (a) NEGATIVO: sin credenciales del 2º usuario → bloquea
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()
    await expect(page.getByText(/Doble validación activada: ingresá email y contraseña/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible()

    // (b) NEGATIVO: credenciales inválidas → bloquea
    await page.getByPlaceholder(/Email del 2do usuario/i).fill('inexistente@local.com')
    await page.locator('.fixed.inset-0 input[type="password"]').first().fill('claveMala123')
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()
    await expect(page.getByText(/Credenciales del 2do usuario inválidas/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible()
  })
})
