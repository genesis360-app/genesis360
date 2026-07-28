/**
 * 111_unidades_fisicas_enable_disable_mutante.spec.ts
 * E2E MUTANTE — Fase 1-bis del rediseño UoM (mig 308): Config → Inventario → "Unidades" es el
 * catálogo COMPLETO de unidades físicas con enable/disable por tenant + presets por rubro, y los
 * nombres de empaque se movieron a su propia pestaña "Empaque".
 *
 * Verifica contra DB real:
 *  A) la familia nueva "Área / Superficie" se muestra (mig 308).
 *  B) desactivar una unidad no-base (Tonelada) persiste activo=false; reactivarla, activo=true.
 *  C) aplicar el preset "Corralón / Materiales" activa "Metro cúbico" (m³, inactiva por default).
 *  D) la pestaña "Empaque" muestra el editor de nombres de empaque personalizados.
 * Restaura el estado de DEV al final (Tonelada→activa, Metro cúbico→inactiva).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const activoDe = async (request: any, headers: any, tenantId: string, nombre: string): Promise<boolean | null> => {
  const r = await request.get(
    `${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&nombre=eq.${encodeURIComponent(nombre)}&select=activo`,
    { headers },
  )
  const rows = (await r.json()) as Array<{ activo: boolean }>
  return rows.length ? rows[0].activo : null
}

test.describe('Unidades físicas — enable/disable + presets (mutante)', () => {
  test('familia Área, toggle de Tonelada, preset Corralón (m³) y pestaña Empaque', async ({ page, request }) => {
    test.setTimeout(90000)

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })
    const [{ tenant_id: tenantId }] = (await sucRes.json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[111] no se pudo resolver el tenant').toBeTruthy()

    // Precondición: catálogo completo sembrado (mig 308) — familia area presente
    const areaRes = await request.get(
      `${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&familia=eq.area&select=nombre`, { headers },
    )
    expect((await areaRes.json() as unknown[]).length, '[111] falta el seed de la familia area (mig 308)').toBeGreaterThan(0)

    // Estado inicial conocido (idempotente ante corridas previas que hayan mutado DEV):
    // Tonelada activa, Metro cúbico inactivo — los defaults del seed.
    await request.patch(`${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&nombre=eq.Tonelada`, { headers, data: { activo: true } })
    await request.patch(`${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&nombre=eq.${encodeURIComponent('Metro cúbico')}`, { headers, data: { activo: false } })

    // Navegar a Config → Inventario → Unidades
    await goto(page, '/configuracion')
    await waitForApp(page)
    await page.getByRole('button', { name: /^Inventario$/ }).first().click()
    await page.getByRole('button', { name: /^Unidades$/ }).first().click()

    // A) la familia "Área / Superficie" se muestra
    await expect(page.getByText(/Área \/ Superficie/).first()).toBeVisible({ timeout: 8000 })

    // B) desactivar Tonelada (no-base, activa por default) → persiste activo=false
    const labelTonelada = page.locator('label', { hasText: 'Tonelada' }).first()
    await expect(labelTonelada).toBeVisible({ timeout: 8000 })
    const chkTonelada = labelTonelada.locator('input[type="checkbox"]')
    await expect(chkTonelada).toBeChecked()
    // El checkbox es controlado (activo llega tras el update + refetch async), así que usamos
    // click() y confirmamos contra la DB (no uncheck/check, que asertan el estado sincrónico).
    await chkTonelada.click()
    await expect.poll(async () => activoDe(request, headers, tenantId, 'Tonelada'), { timeout: 8000 }).toBe(false)
    // reactivar → activo=true (restaura)
    await chkTonelada.click()
    await expect.poll(async () => activoDe(request, headers, tenantId, 'Tonelada'), { timeout: 8000 }).toBe(true)

    // C) preset "Corralón / Materiales" activa "Metro cúbico" (m³, inactivo por default)
    expect(await activoDe(request, headers, tenantId, 'Metro cúbico'), '[111] m³ debería arrancar inactivo').toBe(false)
    await page.getByRole('button', { name: /Corralón/ }).first().click()
    await expect.poll(async () => activoDe(request, headers, tenantId, 'Metro cúbico'), { timeout: 8000 }).toBe(true)

    // D) la pestaña "Empaque" muestra el editor de nombres de empaque personalizados
    await page.getByRole('button', { name: /^Empaque$/ }).first().click()
    await expect(page.getByText(/Nombres de empaque personalizados/).first()).toBeVisible({ timeout: 8000 })

    // Restaurar el estado de DEV: Metro cúbico vuelve a inactivo (Tonelada ya quedó activa arriba)
    await request.patch(
      `${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&nombre=eq.${encodeURIComponent('Metro cúbico')}`,
      { headers, data: { activo: false } },
    )
  })
})
