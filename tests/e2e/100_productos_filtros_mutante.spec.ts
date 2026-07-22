/**
 * 100_productos_filtros_mutante.spec.ts
 * E2E MUTANTE — Botón "Filtros" de ProductosPage (pedido GO 2026-07-19): panel pill+popover
 * (mismo patrón que InventarioPage) con Activos/Inactivos/Todos (reemplaza el toggle "Ver
 * inactivos"), Con/Sin estructura de embalaje, Categoría, Proveedor, Marca y el combobox de
 * "Atributos de inventario" combinables (chips, semántica OR: al menos uno; las opciones NO se
 * listan de entrada — aparecen al enfocar/tipear).
 *
 * Genera su propia precondición: producto vía UI + (por REST) tiene_lote, estructura con nivel
 * base, y al final lo desactiva para validar el filtro de inactivos.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'
import { randomUUID } from 'node:crypto'

test.describe('ProductosPage → botón Filtros (mutante)', () => {
  test('estructura con/sin · atributos OR por combobox · activos/inactivos', async ({ page, request }) => {
    const nombreProducto = `E2E Filtros ${Date.now()}`

    // 1) Precondición: producto nuevo vía UI
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // 2) Por REST: activar tiene_lote + crear estructura con nivel base (RPC real)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(prod, '[100] no se encontró el producto por REST').toBeTruthy()

    const patchRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`,
      { headers, data: { tiene_lote: true } },
    )
    expect(patchRes.ok(), '[100] no se pudo activar tiene_lote').toBe(true)

    const udmRes = await request.get(
      `${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Unidad&select=id`, { headers },
    )
    const [udm] = (await udmRes.json()) as Array<{ id: string }>
    expect(udm, '[100] falta la UdM predefinida Unidad').toBeTruthy()

    const estrId = randomUUID()
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_estructuras`, {
      headers,
      data: { id: estrId, tenant_id: prod.tenant_id, producto_id: prod.id, nombre: 'Filtros E2E', is_default: true },
    })
    expect(insRes.ok(), '[100] no se pudo crear la estructura').toBe(true)
    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: { p_estructura_id: estrId, p_niveles: [{ unidad_medida_id: udm.id, factor: 1 }] },
    })
    expect(rpcRes.ok(), '[100] no se pudieron guardar los niveles').toBe(true)

    // 3) Filtro Con/Sin estructura
    await goto(page, '/productos')
    await waitForApp(page)
    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU o código/i)
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(nombreProducto)
    await page.waitForTimeout(700)
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 8000 })

    await page.getByRole('button', { name: /Filtros/i }).first().click()
    const panel = page.locator('div').filter({ has: page.getByText('Estructura de embalaje') }).last()
    await expect(page.getByText('Estructura de embalaje')).toBeVisible({ timeout: 5000 })

    // "Con" → el producto (tiene estructura) sigue visible
    await panel.getByRole('button', { name: 'Con', exact: true }).click()
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 5000 })
    // "Sin" → desaparece
    await panel.getByRole('button', { name: 'Sin', exact: true }).click()
    await expect(page.getByText(nombreProducto)).not.toBeVisible({ timeout: 5000 })
    // volver a Todos
    await panel.getByRole('button', { name: 'Todos', exact: true }).first().click()

    // 4) Combobox de atributos: las opciones NO están a la vista hasta enfocar
    await expect(page.getByText('Control por lote')).not.toBeVisible()
    const comboInput = page.getByPlaceholder(/Buscar atributo/i)
    await comboInput.click()
    await expect(page.getByText('Control por lote')).toBeVisible({ timeout: 3000 })
    // tipear filtra
    await comboInput.fill('lote')
    await expect(page.getByText('Control por número de serie')).not.toBeVisible()
    await page.getByText('Control por lote').click()
    // chip agregado (la opción elegida sale del dropdown, así que este texto es el chip)
    await expect(page.getByText('Control por lote').first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 5000 })
    // segundo atributo que el producto NO tiene → semántica OR: sigue visible
    await comboInput.click()
    await page.getByText('Fecha de vencimiento', { exact: true }).click()
    await expect(page.getByText(/al menos uno de los atributos/i)).toBeVisible({ timeout: 3000 })
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 5000 })
    // quitar chips
    await page.getByText(/Limpiar todos los filtros/i).click()

    // 5) Activos/Inactivos (reemplaza el toggle "Ver inactivos")
    const offRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`,
      { headers, data: { activo: false } },
    )
    expect(offRes.ok(), '[100] no se pudo desactivar el producto').toBe(true)

    await goto(page, '/productos')
    await waitForApp(page)
    await page.getByPlaceholder(/Buscar por nombre, SKU o código/i).fill(nombreProducto)
    await page.waitForTimeout(700)
    // default = Activos → el inactivo no aparece
    await expect(page.getByText(nombreProducto)).not.toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Filtros/i }).first().click()
    await page.getByRole('button', { name: 'Inactivos', exact: true }).click()
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 5000 })
  })
})
