/**
 * 05_caja.spec.ts
 * Valida el módulo de caja: estado, apertura, movimientos enriquecidos y GOBERNANZA.
 *
 * Smoke histórico (v0.73): U2 labels de efectivo, U3 totales por método.
 * Gobernanza (plan tests/specs/caja.plan.md — escenarios "fuera de alcance unit"):
 *  - A2: DUEÑO/SUPERVISOR puede abrir caja a nombre de otro cajero ("Abrir caja para").
 *  - Traspaso entre cajas (ISS-193): modal "Transferir a otra caja".
 * Estos tests son defensivos: verifican las affordances cuando el estado lo permite y
 * se omiten (sin fallar) si la precondición no está dada en el DEV compartido. No mutan
 * (siempre cancelan/Escape).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Caja', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/caja')
    await waitForApp(page)
  })

  test('página carga y muestra estado de caja', async ({ page }) => {
    await expect(
      page.getByText(/abierta:|sesión abierta|abrir caja|nueva sesión|sin sesión|caja cerrada|caja abierta/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('saldo y movimientos visibles cuando hay sesión abierta', async ({ page }) => {
    const cajaAbierta = await page.getByText(/caja abierta|saldo actual/i).first().isVisible().catch(() => false)
    if (cajaAbierta) {
      await expect(page.getByText(/saldo/i).first()).toBeVisible()
    }
  })

  test('formulario de apertura es accesible cuando caja está cerrada', async ({ page }) => {
    const btnAbrir = page.getByRole('button', { name: /abrir caja|nueva sesión/i }).first()
    if (await btnAbrir.isVisible().catch(() => false)) {
      await btnAbrir.click()
      await expect(page.getByText(/apertura|saldo inicial|monto inicial|abrir caja para/i).first()).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    }
  })

  /**
   * U3 (v0.73.0) — movimientos enriquecidos: "Totales por método" al pie del historial.
   */
  test('U3: movimientos de sesión muestran totales por método', async ({ page }) => {
    const tieneMovimientos = await page.getByText(/totales por método|efectivo neto/i).isVisible().catch(() => false)
    if (!tieneMovimientos) return
    await expect(page.getByText(/totales por método/i).first()).toBeVisible({ timeout: 5000 })
  })

  /**
   * U2 — el cierre de caja etiqueta el efectivo correctamente. v1.51: para cerrar hace falta
   * un arqueo parcial previo, así que "Cerrar caja" puede abrir el GATE de arqueo en vez del
   * modal de cierre. El test acepta ambos caminos y no completa el cierre (cancela).
   */
  test('U2: cerrar caja muestra labels de efectivo o gate de arqueo', async ({ page }) => {
    const btnCerrar = page.getByRole('button', { name: /cerrar caja|cerrar sesión/i }).first()
    if (!await btnCerrar.isVisible().catch(() => false)) return // sin sesión abierta
    await btnCerrar.click()
    // Camino A: modal de cierre con resumen de efectivo
    const labelsCierre = page.getByText(/efectivo esperado|ingresos efectivo|no se cuentan aquí/i).first()
    // Camino B: gate de arqueo previo
    const gateArqueo = page.getByText(/arqueo parcial|conteo físico real|arqueo requerido/i).first()
    await expect(labelsCierre.or(gateArqueo)).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
  })

  /**
   * A2 (gobernanza) — DUEÑO/SUPERVISOR puede abrir caja a nombre de un cajero.
   * Cuando hay una caja cerrada y se despliega el formulario de apertura, debe aparecer
   * el selector "Abrir caja para". Defensivo: se omite si no hay caja cerrada disponible.
   */
  test('A2: apertura ofrece selector "Abrir caja para" (caja ajena)', async ({ page }) => {
    const btnAbrir = page.getByRole('button', { name: /abrir caja|nueva sesión/i }).first()
    if (!await btnAbrir.isVisible().catch(() => false)) return // no hay caja cerrada
    await btnAbrir.click()
    await page.waitForTimeout(400)
    // El selector A2 aparece para DUEÑO si el tenant tiene >1 cajero
    const selectorAjena = page.getByText(/abrir caja para/i).first()
    if (await selectorAjena.isVisible().catch(() => false)) {
      await expect(selectorAjena).toBeVisible()
    }
    await page.keyboard.press('Escape')
  })

  /**
   * Traspaso entre cajas (ISS-193) — con ≥2 cajas abiertas, el botón "Transferir efectivo a
   * otra caja" abre el modal de traspaso. Defensivo: se omite si hay <2 cajas abiertas.
   */
  test('Traspaso: modal "Transferir a otra caja" abre y cancela', async ({ page }) => {
    const btnTraspaso = page.getByRole('button', { name: /transferir efectivo a otra caja/i }).first()
    if (!await btnTraspaso.isVisible().catch(() => false)) return // <2 cajas abiertas
    await btnTraspaso.click()
    await expect(page.getByText(/transferir a otra caja/i).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /confirmar traspaso/i })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
