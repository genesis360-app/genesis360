/**
 * 65_caja_cierre_ajeno_clave_mutante.spec.ts
 * E2E MUTANTE — Cerrar caja AJENA exige clave maestra del negocio (REGLA #0, contable).
 *
 * B5 (`CajaPage.cerrarCaja` ~662-672): si la caja la abrió OTRO usuario y el tenant tiene `clave_maestra`
 * configurada, el cierre exige la clave; se verifica server-side con `verificar_clave_maestra` (hash) →
 * clave incorrecta BLOQUEA ("Clave maestra incorrecta"), clave correcta cierra. Cerrar una caja ajena sin
 * el 2º factor permitiría manipular el arqueo de otro cajero sin control → cero error tolerado.
 *
 * Fixture SQL (DEV, Almacén Jorgito — tiene clave 12345678): sesión ABIERTA en Caja2 a nombre de
 * "cajero1" (≠ el OWNER del harness) + un arqueo (requisito para cerrar). El OWNER intenta cerrarla.
 *
 * Aserciones: (NEGATIVO) clave incorrecta → toast "Clave maestra incorrecta", modal sigue abierto, sesión
 * NO cerrada; (POSITIVO/override) clave correcta → "Caja cerrada". El estado en DB se verifica aparte.
 *
 * MUTANTE: cierra una caja real (se limpia por SQL). GATE: requiere E2E_CAJA_AJENA=1 (no corre en el
 * full-suite). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const CLAVE_OK = '12345678'
const CLAVE_MALA = '00000000'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Cerrar caja ajena exige clave maestra (mutante)', () => {
  test.skip(process.env.E2E_CAJA_AJENA !== '1', 'Spec mutante (cierra caja ajena): correr con E2E_CAJA_AJENA=1 + fixture sembrado.')

  test('clave incorrecta bloquea el cierre ajeno; clave correcta lo autoriza', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/caja')
    await waitForApp(page)

    // Seleccionar la caja abierta por otro usuario (Caja2)
    const pill = page.locator('button', { hasText: /^\s*Caja2/ }).first()
    if (!(await pill.isVisible().catch(() => false))) {
      test.skip(true, 'Caja2 no visible en el selector (re-sembrar fixture / revisar sucursal).')
    }
    await pill.click()
    await page.waitForTimeout(700)

    // Abrir el modal de cierre
    const btnCerrar = page.getByRole('button', { name: /Cerrar caja/i }).first()
    if (!(await btnCerrar.isVisible().catch(() => false))) {
      test.skip(true, 'Botón "Cerrar caja" no visible (la sesión ajena no cargó — re-sembrar fixture).')
    }
    await btnCerrar.click()
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible({ timeout: 5000 })

    // El gate de clave maestra (caja ajena + clave configurada) está presente
    await expect(page.getByText(/Clave maestra requerida/i)).toBeVisible({ timeout: 4000 })

    // Efectivo contado = saldo ($1.000) → sin diferencia
    const contadoInput = page.locator('.fixed.inset-0').getByRole('spinbutton').first()
    await setReactNumber(contadoInput, '1000')

    // NEGATIVO: clave incorrecta → rechazo server-side, no cierra
    const claveInput = page.locator('.fixed.inset-0 input[type="password"]').first()
    await claveInput.fill(CLAVE_MALA)
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()
    await expect(page.getByText(/Clave maestra incorrecta/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible()

    // OVERRIDE: clave correcta → cierra
    await claveInput.fill(CLAVE_OK)
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()
    await expect(page.getByRole('status').filter({ hasText: /Caja cerrada/i })).toBeVisible({ timeout: 12000 })
  })
})
