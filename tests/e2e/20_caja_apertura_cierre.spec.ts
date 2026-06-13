/**
 * 20_caja_apertura_cierre.spec.ts
 * E2E MUTANTE del ciclo de caja (auditoría pre-cliente, pilar B).
 *
 * Abre una caja CERRADA del propio usuario (si hace falta) y la cierra de punta a
 * punta (arqueo parcial obligatorio → cierre con conteo físico). Verifica las
 * mutaciones reales. **Self-healing**: si "Caja1" quedó abierta de una corrida
 * previa, omite la apertura y ejerce solo el cierre → siempre termina CERRADA,
 * dejando el estado listo para la próxima corrida. No toca la caja del test de
 * venta (19), que usa otra caja abierta.
 *
 * Usa "Caja1" (abierta por el owner → sin clave maestra al cerrar).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CAJA = 'Caja1'

test.describe('Caja — apertura + cierre (mutante)', () => {
  test('abre una caja y la cierra con arqueo', async ({ page }) => {
    await goto(page, '/caja')
    await waitForApp(page)

    // 1) Seleccionar la píldora de "Caja1"
    const pill = page.getByRole('button', { name: new RegExp(`${CAJA}\\b`) }).first()
    await expect(pill).toBeVisible({ timeout: 8000 })
    await pill.click()
    await page.waitForTimeout(500)

    // 2) APERTURA — solo si está cerrada (si quedó abierta, se ejerce solo el cierre)
    const abrirBtn = page.getByRole('button', { name: /^Abrir caja$/ }).first()
    if (await abrirBtn.isVisible().catch(() => false)) {
      await abrirBtn.click()
      await page.waitForTimeout(400)
      const montoInicial = page.locator('xpath=//label[contains(.,"Monto inicial")]/following::input[1]')
      await montoInicial.fill('0')
      const confirmar = page.getByRole('button', { name: /Confirmar apertura|Sí, abrir con diferencia/ })
      await confirmar.first().click()
      await page.waitForTimeout(400)
      const difBtn = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
      if (await difBtn.isVisible().catch(() => false)) await difBtn.click()
      await page.waitForTimeout(600)
    }

    // Caja abierta: el botón de arqueo (✓, title "Arqueo parcial") solo existe con caja abierta
    const arqueoBtn = page.getByRole('button', { name: /Arqueo parcial/ }).first()
    await expect(arqueoBtn).toBeVisible({ timeout: 8000 })

    // 3) ARQUEO PARCIAL (obligatorio antes de cerrar)
    await arqueoBtn.click()
    await page.waitForTimeout(400)
    const conteoArqueo = page.locator('xpath=//label[contains(.,"Conteo físico real")]/following::input[1]')
    await expect(conteoArqueo).toBeVisible({ timeout: 5000 })
    await conteoArqueo.fill('0')
    await page.getByRole('button', { name: /Registrar arqueo/ }).click()
    await page.waitForTimeout(1200)

    // 4) CERRAR CAJA — el botón full-width pasa a "Cerrar caja" tras el arqueo
    const cerrarBtn = page.getByRole('button', { name: /^Cerrar caja$/ }).first()
    await expect(cerrarBtn).toBeVisible({ timeout: 8000 })
    await cerrarBtn.click()
    await page.waitForTimeout(400)
    const conteoCierre = page.locator('xpath=//label[contains(.,"Efectivo contado en caja")]/following::input[1]')
    await expect(conteoCierre).toBeVisible({ timeout: 5000 })
    await conteoCierre.fill('0')
    await page.getByRole('button', { name: /Confirmar cierre/ }).click()

    // 5) Verificar CERRADA: el panel vuelve al estado cerrado con el botón "Abrir caja"
    await expect(page.getByRole('button', { name: /^Abrir caja$/ }).first()).toBeVisible({ timeout: 12000 })
  })
})
