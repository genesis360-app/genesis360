/**
 * 124_comercial_combo_scoping_sucursal_mutante.spec.ts
 * E2E MUTANTE — COM-07: regresión de un bug real ya encontrado y corregido en `ComercialPage.tsx`.
 *
 * El `addCombo` original (portado desde `ConfigPage.tsx` al mover Combos+Cupones a Comercial, Fase
 * D del backlog de Fede) se olvidaba `sucursal_id` al insertar — un combo creado con una sucursal
 * ACTIVA seleccionada quedaba igual con `sucursal_id: null` (global), ofreciéndose en TODAS las
 * sucursales del tenant sin que nadie lo pidiera. Ya está corregido en el código actual
 * (`addCombo` inserta `sucursal_id: sucursalId || null`) — este spec es la red de regresión.
 *
 * Fija la sucursal activa en `localStorage` ANTES de un `goto` (navegación dura, re-ejecuta el
 * bundle) para que el store de Zustand la lea al inicializar — mismo patrón que usa el spec 93
 * (`browser.newContext()`/`localStorage` + goto duro, no un click en un selector de UI).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Comercial → Combos — scoping por sucursal (mutante)', () => {
  test('combo creado con una sucursal activa queda con sucursal_id = esa sucursal, no global (COM-07)', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const nombreCombo = `E2E Combo124 Scoping ${ts}`
    const nombreProducto = `E2E Combo124 Prod ${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // Cualquier sucursal REAL del tenant sirve — lo que importa es que NO sea null/global.
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,nombre,tenant_id&order=nombre&limit=5`, { headers })
    expect(sucRes.ok(), `[124] no se pudo leer sucursales: ${await sucRes.text()}`).toBe(true)
    const sucursales = (await sucRes.json()) as Array<{ id: string; nombre: string; tenant_id: string }>
    expect(sucursales.length, '[124] el tenant e2e no tiene ninguna sucursal — precondición de infraestructura').toBeGreaterThan(0)
    const sucursalActiva = sucursales[0]
    const tenantId = sucursalActiva.tenant_id

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-124-${ts}`,
        precio_costo: 60, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[124] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)

    // Fijar la sucursal ACTIVA en localStorage antes del próximo goto (navegación dura → el store
    // de Zustand la lee recién al re-inicializar el bundle, no en caliente).
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), sucursalActiva.id)

    await goto(page, '/comercial')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible({ timeout: 8000 })

    // Tab "Combos" es la default — no hace falta clickearla, pero lo hacemos explícito por si
    // otro spec de la corrida masiva dejó otra tab activa en algún estado compartido (no debería,
    // cada test arranca con su propio contexto, pero es gratis y más robusto).
    await page.getByRole('button', { name: 'Combos' }).click()

    const nombreInput = page.getByPlaceholder(/Nombre del combo/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreCombo)

    const productoSelect = page.locator('xpath=//p[contains(.,"Productos del combo")]/following::select[1]')
    await expect(productoSelect).toBeVisible({ timeout: 5000 })
    const opcionProducto = productoSelect.locator('option', { hasText: nombreProducto })
    await expect
      .poll(() => opcionProducto.count(), {
        timeout: 8000,
        message: `[124] el producto "${nombreProducto}" no apareció en el selector del combo`,
      })
      .toBeGreaterThan(0)
    // El label real incluye "(SKU)" — resolver el value por texto en vez de adivinar el label exacto.
    const valorProducto = await opcionProducto.first().getAttribute('value')
    expect(valorProducto, `[124] no se pudo resolver el value del <option> de "${nombreProducto}"`).toBeTruthy()
    await productoSelect.selectOption(valorProducto!)

    await page.getByRole('button', { name: /Crear combo/ }).click()
    await expect(page.getByText(/Combo creado/i)).toBeVisible({ timeout: 12000 })

    // POSITIVO en DB: el combo quedó scopeado a la sucursal ACTIVA, no global.
    const comboRes = await request.get(
      `${SUPABASE_URL}/rest/v1/combos?nombre=eq.${encodeURIComponent(nombreCombo)}&select=id,sucursal_id`, { headers })
    expect(comboRes.ok(), `[124] no se pudo leer el combo recién creado: ${await comboRes.text()}`).toBe(true)
    const [combo] = (await comboRes.json()) as Array<{ id: string; sucursal_id: string | null }>
    expect(combo, '[124] no se encontró el combo recién creado').toBeTruthy()
    expect(
      combo.sucursal_id,
      `🛑 [124] COM-07: el combo debía quedar con sucursal_id="${sucursalActiva.id}" (la sucursal activa), no null/global`,
    ).toBe(sucursalActiva.id)
  })
})
