/**
 * 85_envio_propio_manual_courier_mutante.spec.ts
 * E2E MUTANTE — Modal manual "Nuevo envío" con tipo "Envío propio" persiste courier correcto
 * (REGLA #0, contable — regresión de bug real de producto).
 *
 * BUG ARREGLADO (`EnviosPage.tsx`): crear un envío desde el modal manual "Nuevo envío" con
 * "Tipo de envío" = "🚗 Envío propio" dejaba `courier: null` en vez de `'Envío propio'` — el
 * <select> de courier queda oculto para ese tipo y `saveEnvio` confiaba en `form.courier`, que
 * nunca se togglea. Eso rompía dos cosas:
 *   1) el botón "Registrar combustible" (gate `courier === 'Envío propio' && recurso_id`) nunca
 *      aparecía en esos envíos;
 *   2) `envioYaSaldado` (usado para `costo_pagado` al crear) también dependía de ese string — con
 *      `courier=null` el envío nacía con `costo_pagado=false` y podía aparecer indebidamente como
 *      pago pendiente en "Pagos Courier" (plata mal clasificada).
 * Fix (3 cambios):
 *   - `saveEnvio` deriva `courier` de `tipoEnvio` (state del toggle) en vez de `form.courier`
 *     (`EnviosPage.tsx` ~562).
 *   - `envioYaSaldado` usa el `payload.courier` ya corregido, no el `form.courier` stale (~613).
 *   - `abrirEdicion` restaura el toggle `tipoEnvio` al abrir "Editar envío" (~1146; antes siempre
 *     abría en "tercero" sin importar el courier guardado).
 *
 * Ruta cubierta específicamente: el modal manual "Nuevo envío" de EnviosPage — NO el camino de
 * venta con "Incluir envío" (ese, `VentasPage.tsx`, nunca tuvo el bug y es el que usa el spec 38
 * para su fixture).
 *
 * Aserción POSITIVA (toast + UI: botón "Registrar combustible" visible) + verificación de la
 * mutación real en DB vía REST directo a PostgREST, con el mismo bearer de la sesión OWNER ya
 * autenticada en el browser (mismo patrón de auth que usa la app, respeta RLS):
 * `envios.courier = 'Envío propio'` y `envios.costo_pagado = true`.
 *
 * Corre con OWNER (chromium) contra DEV. Requiere el vehículo "Moto Reparto Test" activo en el
 * tenant de prueba (mismo fixture que el spec 38) y VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY en
 * el entorno: `npx dotenv -e .env.local -e tests/e2e/.env.test.local -- playwright test 85 ...`.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY

test.describe('Envío propio desde el modal manual "Nuevo envío" (mutante)', () => {
  test.skip(!SUPABASE_URL || !ANON, 'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el entorno.')

  test('crear "Envío propio" a mano persiste courier correcto + nace saldado + habilita combustible', async ({ page, request }) => {
    test.setTimeout(60000)

    await goto(page, '/envios')
    await waitForApp(page)
    const tabEnvios = page.getByRole('button', { name: /^Env[ií]os$/ }).first()
    if (await tabEnvios.isVisible().catch(() => false)) { await tabEnvios.click(); await page.waitForTimeout(300) }

    // 1) Abrir el modal MANUAL "Nuevo envío" — el camino exacto que tenía el bug (no desde una venta)
    await page.getByRole('button', { name: /Nuevo envío/i }).click()
    await expect(page.getByRole('heading', { name: /^Nuevo envío$/i })).toBeVisible({ timeout: 5000 })

    // 2) Domicilio de destino manual (ya viene seleccionado por default al no haber venta asociada)
    const destino = page.getByPlaceholder(/Calle, número, ciudad, provincia, CP/i)
    if (await destino.isVisible().catch(() => false)) await destino.fill('Dirección Test E2E 123, CABA')

    // 3) Tipo de envío = "Envío propio" — la rama exacta donde vivía el bug
    await page.getByRole('button', { name: /Envío propio/i }).click()
    await page.waitForTimeout(300)

    // 4) Vehículo asignado (recurso_id) — condición del gate de "Registrar combustible"
    const vehiculoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Moto Reparto Test/i }) }).first()
    test.skip(!(await vehiculoSelect.isVisible().catch(() => false)), 'No hay vehículo "Moto Reparto Test" activo en el tenant de prueba')
    const vehiculoValue = await vehiculoSelect.locator('option', { hasText: /Moto Reparto Test/i }).first().getAttribute('value')
    await vehiculoSelect.selectOption(vehiculoValue!)

    // 5) Crear
    await page.getByRole('button', { name: /^Crear envío$/i }).click()

    // POSITIVO: toast de creación + modal cerrado
    await expect(page.getByText(/^Envío creado$/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /^Nuevo envío$/i })).not.toBeVisible({ timeout: 5000 })

    // 6) El envío recién creado es el más reciente (orden created_at desc) → primera fila
    const fila = page.locator('tbody tr').first()
    await expect(fila).toBeVisible({ timeout: 8000 })
    // BUG exacto: antes del fix esta columna quedaba "—" (courier null) en vez de "Envío propio"
    await expect(fila.getByText(/Envío propio/i)).toBeVisible({ timeout: 5000 })
    const numeroTxt = await fila.locator('td').nth(1).innerText()
    const numeroMatch = numeroTxt.match(/#(\d+)/)
    expect(numeroMatch, `No se pudo leer el número de envío de "${numeroTxt}"`).not.toBeNull()
    const numero = Number(numeroMatch![1])

    // 7) POSITIVO: el botón "Registrar combustible" aparece (antes, con courier=null, nunca se mostraba)
    await fila.locator('button').first().click() // expandir la fila
    await page.waitForTimeout(400)
    await expect(page.getByRole('button', { name: /Registrar combustible/i })).toBeVisible({ timeout: 5000 })

    // 8) DB real — REST directo (PostgREST) con el bearer de la sesión OWNER ya autenticada en el browser
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))
      if (!key) return null
      try { return JSON.parse(localStorage.getItem(key)!)?.access_token ?? null } catch { return null }
    })
    expect(token, 'No se encontró el access_token de la sesión OWNER en localStorage').toBeTruthy()

    const res = await request.get(`${SUPABASE_URL}/rest/v1/envios?numero=eq.${numero}&select=id,numero,courier,costo_pagado,recurso_id,tipo`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${token}` },
    })
    expect(res.ok()).toBeTruthy()
    const rows = await res.json()
    expect(rows.length, `No se encontró el envío #${numero} vía REST`).toBe(1)
    const envioDB = rows[0]
    // EL BUG EXACTO reportado: antes del fix, courier quedaba `null` acá
    expect(envioDB.courier).toBe('Envío propio')
    // envioYaSaldado: envío propio nace sin courier externo a quien pagar → costo_pagado=true
    expect(envioDB.costo_pagado).toBe(true)
    expect(envioDB.recurso_id).toBeTruthy()

    // 9) BONUS — abrirEdicion restaura el toggle "Envío propio" al editar (antes SIEMPRE abría en
    // "tercero", ocultando el combo Vehículo hasta hacer click manual). Verificamos que el combo
    // Vehículo esté visible DE ENTRADA (sin clickear el toggle) y con el vehículo ya seleccionado.
    await fila.locator('button[title="Editar"]').click()
    await expect(page.getByRole('heading', { name: /^Editar envío$/i })).toBeVisible({ timeout: 5000 })
    const vehiculoSelectEdit = page.locator('select').filter({ has: page.locator('option', { hasText: /Moto Reparto Test/i }) }).first()
    await expect(vehiculoSelectEdit).toBeVisible({ timeout: 5000 })
    await expect(vehiculoSelectEdit).toHaveValue(vehiculoValue!)
  })
})
