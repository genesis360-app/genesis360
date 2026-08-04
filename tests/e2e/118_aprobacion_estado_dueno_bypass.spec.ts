/**
 * 118_aprobacion_estado_dueno_bypass_spec.ts
 * E2E — APROB-03: el DUEÑO queda EXENTO del gate de aprobación de cambio de estado (Fase B,
 * backlog Comercial de Fede). Comportamiento CONFIRMADO como intencional con GO (hallazgo H2,
 * 2026-08-03) — el DUEÑO no se autoaprueba a sí mismo un control que él mismo configuró, mismo
 * criterio que ya rige el gate de CANTIDAD (mig 228). `estadoCambioRequiereAprobacion` ya lo cubre
 * a nivel unitario (`tests/unit/aprobacionEstado.test.ts`); este spec verifica el flujo real de
 * punta a punta en el navegador, con la sesión DUEÑO normal (proyecto `chromium` default).
 *
 * Given un estado con `requiere_aprobacion=true` y la config default del tenant (sin entrada
 * explícita para DUEÑO en `ajuste_autorizacion_roles`), When el propio DUEÑO cambia un LPN a ese
 * estado, Then el cambio se aplica DIRECTO — sin pedir foto, sin crear ninguna fila en
 * `autorizaciones_inventario` — y `inventario_lineas.estado_id` queda actualizado de inmediato.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Aprobación de cambio de estado — bypass del DUEÑO (H2, comportamiento intencional)', () => {
  test('el DUEÑO aplica el cambio DIRECTO, sin foto ni autorización (APROB-03)', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const nombreEstado = `E2E Aprob118 Estado ${ts}`
    const nombreProducto = `E2E Aprob118 Prod ${ts}`
    // SKU distinto del LPN a propósito: si coincidieran, el texto del LPN quedaría AMBIGUO en la UI
    // (la fila del producto también muestra su SKU) y `getByText(lpn, { exact: true })` rompería en
    // "strict mode violation" por resolver a 2 elementos.
    const lpn = `E2E-LPN118-${ts}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // Sucursal más antigua — coincide con la que el DUEÑO tiene activa por default (sin haber
    // tocado nunca el selector de sucursal), así el LPN queda visible sin pisar el filtro global.
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&order=created_at.asc&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[118] no se pudo resolver una sucursal').toBeTruthy()
    const tenantId = suc.tenant_id

    // Config default: sin override explícito para DUEÑO — si un spec previo lo dejó configurado,
    // este test asume el comportamiento default y hay que frenar antes de sacar una conclusión falsa.
    const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=ajuste_autorizacion_roles`, { headers })
    const [{ ajuste_autorizacion_roles: configPrevia }] = (await tenantRes.json()) as Array<{ ajuste_autorizacion_roles: any }>
    const tieneOverrideDueno = !!(configPrevia && typeof configPrevia === 'object' && 'DUEÑO' in configPrevia)
    expect(tieneOverrideDueno, '[118] el tenant tiene un override explícito para DUEÑO en ajuste_autorizacion_roles — este spec asume la config default (sin entrada DUEÑO) para documentar H2').toBe(false)

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tenantId, nombre: nombreEstado, requiere_aprobacion: true, es_disponible_venta: false },
    })
    expect(estadoRes.ok(), `[118] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estado] = (await estadoRes.json()) as Array<{ id: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: { tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-SKU118-${ts}`, precio_costo: 60, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
    })
    expect(prodRes.ok(), `[118] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, lpn, cantidad: 10, activo: true, sucursal_id: suc.id },
    })
    expect(lineaRes.ok(), `[118] no se pudo crear el LPN: ${await lineaRes.text()}`).toBe(true)
    const [linea] = (await lineaRes.json()) as Array<{ id: string; estado_id: string | null }>

    await goto(page, '/inventario')
    await waitForApp(page)
    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i)
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(nombreProducto)
    const filaProducto = page.getByText(nombreProducto, { exact: true }).first()
    await expect(filaProducto, `[118] "${nombreProducto}" no apareció en el buscador de Inventario`).toBeVisible({ timeout: 8000 })
    await filaProducto.click()

    const lpnSpan = page.getByText(lpn, { exact: true })
    await expect(lpnSpan).toBeVisible({ timeout: 8000 })
    const fila = lpnSpan.locator('xpath=ancestor::div[contains(@class,"grid-cols-9")][1]')
    await fila.locator('button[title="Acciones sobre este LPN"]').click()

    const modal = page.locator('div.fixed.inset-0.bg-black\\/50').first()
    await expect(modal.getByText(lpn, { exact: true }).first()).toBeVisible({ timeout: 8000 })

    const estadoSelect = modal.locator('xpath=.//label[text()="Estado"]/following::select[1]')
    await expect(estadoSelect).toBeVisible({ timeout: 5000 })
    await estadoSelect.selectOption({ label: nombreEstado })

    // POSITIVO: NO aparece el bloque de foto/aprobación — el DUEÑO no está sujeto al gate (H2)
    await expect(modal.getByText(/requiere una foto tomada en el momento/i)).not.toBeVisible()
    const guardarBtn = modal.getByRole('button', { name: 'Guardar cambios' })
    await expect(guardarBtn).toBeVisible()
    await expect(guardarBtn).toBeEnabled()
    await guardarBtn.click()

    // Sin confirm dialog de aprobación — se aplica directo
    await expect(page.getByText(/LPN actualizado/i)).toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: estado_id cambió YA, sin pasar por autorizaciones_inventario
    const lineaPostRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers })
    const [lineaPost] = (await lineaPostRes.json()) as Array<{ estado_id: string | null }>
    expect(lineaPost.estado_id, '[118] APROB-03: el DUEÑO aplica el cambio DIRECTO').toBe(estado.id)

    const autRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones_inventario?linea_id=eq.${linea.id}&tipo=eq.cambio_estado&select=id`, { headers })
    const auts = (await autRes.json()) as any[]
    expect(auts, '[118] no debe crearse ninguna autorización pendiente para el DUEÑO').toHaveLength(0)
  })
})
