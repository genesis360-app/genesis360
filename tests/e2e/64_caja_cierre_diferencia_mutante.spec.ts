/**
 * 64_caja_cierre_diferencia_mutante.spec.ts
 * E2E MUTANTE — Cierre de caja con diferencia → ajuste contable en DB (REGLA #0, contable).
 *
 * B4 (`CajaPage.cerrarCaja` ~759-771 + `cajaArqueo.clasificarAjusteDiferencia`): al cerrar una caja
 * cuyo efectivo contado ≠ saldo del sistema, además de guardar `diferencia_cierre` en la sesión se
 * inserta un `caja_movimientos` de AJUSTE: sobrante (dif>0) → `ingreso`; faltante (dif<0) → `egreso`,
 * monto = |dif|, concepto "[Diferencia caja] Sobrante/Faltante en cierre". Un sobrante/faltante que no
 * deje su asiento descuadra el arqueo y la caja → cero error tolerado.
 *
 * Flujo (OWNER, que puede abrir 2ª caja): selecciona una caja libre (Caja2, Norte) → abre con $1.000 →
 * arqueo parcial $1.000 → cierra contando $1.100 → "Sobran $100" → Confirmar cierre. La sesión arranca
 * sin movimientos ⇒ saldo del sistema = $1.000, así la diferencia es determinística (+$100).
 *
 * Aserción POSITIVA: toast "Caja cerrada"; el `diferencia_cierre=100` y el `caja_movimientos` de ajuste
 * (`ingreso`, $100, "[Diferencia caja] Sobrante…") se verifican aparte con execute_sql.
 *
 * MUTANTE: abre y cierra una caja real (se limpia por SQL tras verificar) + dispara email de cierre al
 * DUEÑO. GATE: requiere E2E_CAJA_CIERRE_DIF=1 (no corre en el full-suite). Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const CAJA_LIBRE = 'Caja2'

async function setReactNumber(input: Locator, value: string) {
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('Cierre de caja con diferencia (mutante)', () => {
  test.skip(process.env.E2E_CAJA_CIERRE_DIF !== '1', 'Spec mutante (abre/cierra caja + email): correr con E2E_CAJA_CIERRE_DIF=1.')

  test('contar $1.100 sobre saldo $1.000 → sobrante $100 + ajuste ingreso en DB', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/caja')
    await waitForApp(page)

    // 1) Seleccionar la caja libre (píldora con el nombre)
    const pill = page.locator('button', { hasText: new RegExp(`^\\s*${CAJA_LIBRE}`) }).first()
    if (!(await pill.isVisible().catch(() => false))) {
      test.skip(true, `Caja "${CAJA_LIBRE}" no visible en el selector (¿sucursal/estado?).`)
    }
    await pill.click()
    await page.waitForTimeout(600)

    // Debe estar cerrada → botón "Abrir caja"
    const btnAbrir = page.getByRole('button', { name: /^Abrir caja$/ })
    if (!(await btnAbrir.isVisible().catch(() => false))) {
      test.skip(true, `"${CAJA_LIBRE}" no está cerrada/disponible para abrir (re-correr cuando esté libre).`)
    }
    await btnAbrir.click()
    await page.waitForTimeout(400)

    // 2) Apertura con $1.000 (sobrescribe el sugerido si lo hubiera)
    const aperturaInput = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(aperturaInput).toBeVisible({ timeout: 5000 })
    await setReactNumber(aperturaInput, '1000')
    await page.getByRole('button', { name: /Confirmar apertura/ }).click()
    // Si el monto difiere del sugerido, pide confirmar la diferencia
    const difBtn = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
    if (await difBtn.isVisible({ timeout: 1500 }).catch(() => false)) await difBtn.click()
    await expect(page.getByText(/Caja abierta|Saldo|Efectivo/i).first()).toBeVisible({ timeout: 8000 })

    // 3) Arqueo parcial (obligatorio antes de cerrar) — conteo $1.000
    await page.getByRole('button', { name: /^Arqueo$/ }).click()
    await expect(page.getByRole('heading', { name: /Arqueo parcial/i })).toBeVisible({ timeout: 5000 })
    await setReactNumber(page.locator('input[type="number"][step="0.01"]').first(), '1000')
    await page.getByRole('button', { name: /Registrar arqueo/ }).click()
    await expect(page.getByRole('heading', { name: /Arqueo parcial/i })).not.toBeVisible({ timeout: 6000 })

    // 4) Cerrar caja contando $1.100 (sobrante $100)
    await page.getByRole('button', { name: /Cerrar caja/i }).first().click()
    await expect(page.getByRole('heading', { name: /^Cerrar caja$/ })).toBeVisible({ timeout: 5000 })
    const contadoInput = page.locator('.fixed.inset-0').getByRole('spinbutton').first()
    await setReactNumber(contadoInput, '1100')
    await expect(page.getByText(/Sobran\s*\$?\s*100/i)).toBeVisible({ timeout: 4000 })
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()

    // 5) POSITIVO: cierre exitoso (toast role=status; "Caja cerrada" también es el heading de
    //    caja-cerrada que aparece después → desambiguar con el rol del toast)
    await expect(page.getByRole('status').filter({ hasText: /Caja cerrada/i })).toBeVisible({ timeout: 12000 })
  })
})
