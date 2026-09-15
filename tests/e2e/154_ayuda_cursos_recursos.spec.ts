/**
 * 154_ayuda_cursos_recursos.spec.ts
 * Ayuda, fase 2 — "Cursos y recursos" (mig 429). Decisión de GO (2026-09-15): la sección existe ya y muestra solo los
 * videos que el equipo publique; mientras no haya ninguno, dice "Próximamente".
 *
 * A · Desde el Centro de Soporte la tarjeta "Cursos y recursos" lleva a /ayuda/recursos, que muestra lo mismo que la
 *     base devuelve para el usuario: la lista de videos publicados, o "Próximamente" si no hay.
 * B · La tabla no se escribe desde la app (ni el DUEÑO): los videos se publican desde el dashboard.
 *
 * El filtro "solo publicados" (RLS) se verifica por SQL con filas de prueba revertidas (UAT §64): acá no hay forma de
 * sembrar un borrador sin service_role, y es a propósito.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Ayuda — Cursos y recursos (mig 429)', () => {
  test('A · la tarjeta del Centro de Soporte lleva a los recursos publicados', async ({ page, request }) => {
    await goto(page, '/ayuda')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const res = await request.get(`${SUPABASE_URL}/rest/v1/ayuda_recursos?select=id,titulo`, { headers })
    expect(res.status(), `[154A] el usuario lee los recursos: ${await res.text()}`).toBe(200)
    const publicados = (await res.json()) as { id: string; titulo: string }[]

    await page.getByRole('link', { name: /Cursos y recursos/ }).click()
    await expect(page, '[154A] la tarjeta lleva a /ayuda/recursos').toHaveURL(/\/ayuda\/recursos$/)
    await expect(page.getByRole('heading', { name: 'Cursos y recursos' })).toBeVisible()

    if (publicados.length === 0) {
      await expect(page.locator('[data-recursos-vacio]'), '[154A] sin videos publicados dice "Próximamente"').toContainText('Próximamente')
      await expect(page.locator('[data-recurso]')).toHaveCount(0)
    } else {
      await expect(page.locator('[data-recurso]'), '[154A] una tarjeta por video publicado').toHaveCount(publicados.length)
      await page.locator(`[data-recurso="${publicados[0].id}"]`).click()
      await expect(page).toHaveURL(new RegExp(`video=${publicados[0].id}`))
      await expect(page.locator(`[data-recurso-video="${publicados[0].id}"]`), '[154A] se abre el reproductor').toBeVisible()
    }
  })

  test('B · los recursos no se escriben desde la app', async ({ page, request }) => {
    await goto(page, '/ayuda')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const alta = await request.post(`${SUPABASE_URL}/rest/v1/ayuda_recursos`, {
      headers, data: { titulo: 'E2E-154 intruso', video_path: 'e2e/intruso.mp4', publicado: true },
    })
    expect(alta.ok(), `[154B] el DUEÑO NO publica videos por REST (${alta.status()})`).toBeFalsy()
  })
})
