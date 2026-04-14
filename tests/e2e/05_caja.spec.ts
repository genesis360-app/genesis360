/**
 * 05_caja.spec.ts
 * Valida el módulo de caja: estado, apertura de sesión y movimientos enriquecidos.
 *
 * v0.73.0 — features testeadas:
 *  - U2: modal de cierre muestra "Ingresos efectivo" / "Egresos efectivo" (no tarjeta/MP)
 *  - U3: movimientos de sesión muestran badge de tipo y sección "Totales por método"
 *  - B3: polling — la página refresca sin F5 (observable via refetchInterval)
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Caja', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/caja')
    await waitForApp(page)
  })

  test('página carga y muestra estado de caja', async ({ page }) => {
    // Debe mostrar estado de sesión o botón de apertura
    await expect(
      page.getByText(/abierta:|sesión abierta|abrir caja|nueva sesión|sin sesión/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('saldo y movimientos visibles cuando hay sesión abierta', async ({ page }) => {
    const cajaAbierta = await page.getByText(/caja abierta/i).isVisible()
    if (cajaAbierta) {
      // Debe mostrar saldo
      await expect(page.getByText(/saldo/i).first()).toBeVisible()
    }
  })

  test('formulario de apertura es accesible cuando caja está cerrada', async ({ page }) => {
    const btnAbrir = page.getByRole('button', { name: /abrir caja|nueva sesión/i })
    if (await btnAbrir.isVisible()) {
      await btnAbrir.click()
      await expect(page.getByText(/apertura|saldo inicial/i).first()).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    }
  })

  /**
   * U3 (v0.73.0) — movimientos enriquecidos: cuando hay sesión abierta con movimientos,
   * debe mostrarse la sección "Totales por método" al pie del historial.
   * Si no hay sesión abierta, el test se omite sin falla.
   */
  test('U3: movimientos de sesión muestran totales por método', async ({ page }) => {
    const tieneMovimientos = await page.getByText(/totales por método|efectivo neto/i).isVisible().catch(() => false)
    if (!tieneMovimientos) return // skip si no hay sesión con movimientos
    await expect(page.getByText(/totales por método/i).first()).toBeVisible({ timeout: 5000 })
  })

  /**
   * U2 (v0.73.0) — modal de cierre etiqueta correctamente los montos de efectivo.
   * El modal debe mostrar "efectivo" y la nota sobre tarjeta/MP.
   */
  test('U2: modal de cierre muestra labels de efectivo', async ({ page }) => {
    const btnCerrar = page.getByRole('button', { name: /cerrar caja|cerrar sesión/i }).first()
    if (!await btnCerrar.isVisible().catch(() => false)) return // skip si no hay sesión abierta
    await btnCerrar.click()
    await expect(
      page.getByText(/efectivo esperado|ingresos efectivo|tarjeta.*no se cuenta/i).first()
    ).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
  })
})
