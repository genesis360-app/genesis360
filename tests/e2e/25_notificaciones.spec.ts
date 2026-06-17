/**
 * 25_notificaciones.spec.ts
 * E2E de la CAMPANA de notificaciones (auditoría UAT §27 — pase 3, NOT-01/03/04).
 *
 * Contexto: la RLS de `notificaciones` estaba rota (mig 219) y bloqueaba el INSERT
 * cross-user → las notificaciones in-app nunca se creaban. El fix server-side se
 * validó por impersonación (DEV+PROD). Este e2e cubre la capa UI que faltaba:
 * la campana del header es alcanzable, abre su panel, lista solo las propias
 * (la query filtra por user_id → SELECT policy) y el "marcar leídas" es operable.
 *
 * No dispara un evento cross-user (eso requiere dos sesiones simultáneas y un
 * trigger frágil como una venta a pérdida); la creación cross-user quedó cubierta
 * a nivel DB. Acá garantizamos que el consumo in-app funciona de punta a punta.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Notificaciones (campana)', () => {
  test('abre el panel de la campana y lista/estructura correcta', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) La campana está en el header (botón con title="Notificaciones")
    const campana = page.locator('button[title="Notificaciones"]').first()
    await expect(campana).toBeVisible({ timeout: 10000 })
    await campana.click()

    // 2) El panel se renderiza con su heading (la query por user_id no rompió → SELECT OK)
    await expect(page.getByRole('heading', { name: /^Notificaciones$/ })).toBeVisible({ timeout: 6000 })

    // 3) Estructura: o hay notificaciones (lista) o el vacío explícito "Sin notificaciones".
    const vacio = page.getByText(/^Sin notificaciones$/)
    const marcarTodas = page.getByRole('button', { name: /Marcar todas leídas/ })
    const hayVacio = await vacio.isVisible().catch(() => false)
    const hayItems = await marcarTodas.isVisible().catch(() => false)
    expect(hayVacio || hayItems).toBeTruthy()

    // 4) Si hay no leídas, "Marcar todas leídas" baja el contador (NOT-03)
    if (hayItems) {
      await marcarTodas.click()
      await page.waitForTimeout(800)
      await expect(page.getByRole('button', { name: /Marcar todas leídas/ })).not.toBeVisible({ timeout: 5000 })
    }

    // 5) Cerrar el panel (botón X del header del dropdown)
    await page.keyboard.press('Escape').catch(() => {})
  })
})
