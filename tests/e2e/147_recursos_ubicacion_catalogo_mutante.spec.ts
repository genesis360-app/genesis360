/**
 * 147 — La ubicación de un recurso se guarda como id del CATÁLOGO, y solo quien puede gestionar el
 * catálogo crea ubicaciones nuevas (mutante).
 *
 * Contexto: `RecursosPage` guardaba el texto libre `recursos.ubicacion` y nunca `ubicacion_id`, así que
 * el catálogo de la mig 407 no gobernaba nada y editar la ubicación de un recurso con FK dejaba el
 * texto y el id desalineados. Decisión de GO (2026-09-14): crean ubicaciones el dueño, el admin o un
 * rol custom que lo permita (mig 417, `auth_puede_editar_modulo('recursos')`).
 *
 * Mutante: con el código anterior el recurso nace con `ubicacion_id = NULL` → la aserción de la FK
 * falla. El control de permisos se verifica por API con el SUPERVISOR (rol fijo sin permiso), con un
 * control positivo del DUEÑO en la misma forma de request.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Recursos — ubicación desde el catálogo (mutante)', () => {
  test('"+ Nueva ubicación" la crea en el catálogo y el recurso queda con ubicacion_id', async ({ page, request }) => {
    const sello = Date.now()
    const nombreRecurso = `E2E Recurso ${sello}`
    const nombreUbic = `E2E Ubic ${sello}`

    await goto(page, '/recursos')
    await waitForApp(page)
    const owner = await tokenDesdeBrowser(page)
    const creados: { recurso?: string; ubicacion?: string } = {}

    try {
      await page.getByRole('button', { name: /^Agregar$/ }).first().click()
      await expect(page.getByRole('heading', { name: 'Nuevo recurso' })).toBeVisible()
      await page.getByPlaceholder('ej. Notebook Dell, Jabón de tocador...').fill(nombreRecurso)

      const selectUbic = page.locator('label', { hasText: /^Ubicación$/ }).locator('xpath=following::select[1]')
      await selectUbic.selectOption('__nueva__')
      await page.getByPlaceholder('Nombre de la nueva ubicación').fill(nombreUbic)
      await page.getByRole('button', { name: /^Agregar$/ }).last().click()
      await expect(page.getByText('Recurso agregado')).toBeVisible({ timeout: 10000 })

      // El recurso quedó apuntando al catálogo (con el código viejo, ubicacion_id era NULL).
      const resRec = await request.get(
        `${SUPABASE_URL}/rest/v1/recursos?nombre=eq.${encodeURIComponent(nombreRecurso)}&select=id,tenant_id,ubicacion_id`,
        { headers: restHeaders(owner) },
      )
      expect(resRec.ok(), await resRec.text()).toBeTruthy()
      const [rec] = (await resRec.json()) as { id: string; tenant_id: string; ubicacion_id: string | null }[]
      expect(rec, 'el recurso no se creó').toBeTruthy()
      creados.recurso = rec.id
      expect(rec.ubicacion_id, '[147] el recurso tiene que guardar ubicacion_id, no solo texto').toBeTruthy()
      creados.ubicacion = rec.ubicacion_id!

      const resUbic = await request.get(
        `${SUPABASE_URL}/rest/v1/recurso_ubicaciones?id=eq.${rec.ubicacion_id}&select=nombre`,
        { headers: restHeaders(owner) },
      )
      const [ubic] = (await resUbic.json()) as { nombre: string }[]
      expect(ubic?.nombre, '[147] la ubicación nueva tiene que existir en el catálogo').toBe(nombreUbic)

      // La pestaña la cuenta por id.
      await page.getByRole('button', { name: /Ubicaciones/ }).first().click()
      const tarjeta = page.locator('div', { hasText: nombreUbic }).filter({ hasText: /1 recurso\b/ }).last()
      await expect(tarjeta).toBeVisible()

      // ── Permisos del catálogo (mig 417) ──
      const supEmail = process.env.E2E_SUPERVISOR_EMAIL
      const supPass = process.env.E2E_SUPERVISOR_PASSWORD
      test.skip(!supEmail || !supPass, 'Sin credenciales del SUPERVISOR en .env.test.local')
      const supervisor = await loginToken(request, supEmail, supPass)

      // Control positivo: el DUEÑO crea con la misma forma de request.
      const idControl = crypto.randomUUID()
      const okDueno = await request.post(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones`, {
        headers: restHeaders(owner),
        data: { id: idControl, tenant_id: rec.tenant_id, nombre: `E2E Control ${sello}` },
      })
      expect(okDueno.status(), `[147] el DUEÑO tiene que poder crear: ${await okDueno.text()}`).toBe(201)
      await request.delete(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones?id=eq.${idControl}`, { headers: restHeaders(owner) })

      const noSup = await request.post(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones`, {
        headers: restHeaders(supervisor),
        data: { tenant_id: rec.tenant_id, nombre: `E2E Supervisor ${sello}` },
      })
      expect(noSup.status(), `[147] el SUPERVISOR NO crea ubicaciones: ${await noSup.text()}`).toBe(403)
    } finally {
      if (creados.recurso) {
        await request.delete(`${SUPABASE_URL}/rest/v1/recursos?id=eq.${creados.recurso}`, { headers: restHeaders(owner) })
      }
      if (creados.ubicacion) {
        await request.delete(`${SUPABASE_URL}/rest/v1/recurso_ubicaciones?id=eq.${creados.ubicacion}`, { headers: restHeaders(owner) })
      }
    }
  })
})
