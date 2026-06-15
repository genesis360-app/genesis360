/**
 * 22_devolucion_mutante.spec.ts
 * E2E del flujo de DEVOLUCIÓN (auditoría básico, pilar B).
 *
 * La devolución reintegra stock + (opcional) egreso de caja + NC. El happy-path
 * monetario exige que los medios de devolución cubran EXACTAMENTE el monto de los
 * ítems (validación ±0.5), lo que lo hace frágil de automatizar a ciegas; este test
 * valida que el flujo es ALCANZABLE de punta a punta (CTA "Devolver" → modal
 * "Procesar devolución" con destino del stock + medios), que es donde vivía el bug
 * de modo básico (la config es_devolucion bloqueaba el flujo). El happy-path con
 * mutación real se cubre en el click-through manual (ver tests/specs/auditoria-basico.plan.md).
 *
 * Defensivo: se omite si no hay una venta con CTA de devolución (p.ej. solo presupuestos).
 * Corre con el usuario OWNER contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Ventas — devolución (alcanzabilidad)', () => {
  test('abre una venta cobrada y llega al modal de devolución', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Tab Historial
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(800)

    // 2) Buscar una venta con CTA "Devolver": abrir filas hasta encontrarla
    const filas = page.locator('div.divide-y > div').filter({ hasText: /\$/ })
    const total = await filas.count()
    test.skip(total === 0, 'No hay ventas en el historial del tenant de prueba')

    let abrioDevolucion = false
    for (let i = 0; i < Math.min(total, 6); i++) {
      await filas.nth(i).click()
      await page.waitForTimeout(500)
      const devolver = page.getByRole('button', { name: /^Devolver$/ }).first()
      if (await devolver.isVisible().catch(() => false)) {
        await devolver.click()
        abrioDevolucion = true
        break
      }
      // Cerrar el detalle si no era devolvible (ESC) y probar la siguiente
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
    }
    test.skip(!abrioDevolucion, 'Ninguna venta visible es devolvible (cobrada/despachada con stock)')

    // 3) El modal de devolución se renderiza con sus controles clave
    await expect(page.getByRole('heading', { name: /Procesar devolución/ })).toBeVisible({ timeout: 6000 })
    await expect(page.getByText(/Destino del stock devuelto/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Confirmar devolución/ })).toBeVisible()

    // 4) El flujo es alcanzable — cerrar sin mutar (el happy-path monetario es manual)
    await page.getByRole('button', { name: /^Cancelar$/ }).first().click()
    await expect(page.getByRole('heading', { name: /Procesar devolución/ })).not.toBeVisible({ timeout: 5000 })
  })
})
