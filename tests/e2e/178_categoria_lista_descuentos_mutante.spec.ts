/**
 * 178_categoria_lista_descuentos_mutante.spec.ts
 * E2E MUTANTE — Lista de descuentos por categoría de clientes (mig 466, Fase 4 parte A; GO 2026-10-02).
 *
 * Todavía no se aplica al vender (parte B2). Acá: agregar un producto con "12,5", editarlo a 0 (0 explícito ≠ sin
 * cargar), sacarlo (queda sin cargar); importar un Excel con una fila mala → no carga NADA; corregido → carga.
 * Siembra su categoría y 2 productos; borra la categoría (y en cascada su lista) en `finally`.
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const xlsxBuffer = (filas: (string | number)[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Descuentos')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

test('lista de descuentos: agregar, 0 explícito, sacar, importar todo o nada', async ({ page }) => {
  test.setTimeout(150_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const tenantId = ((await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[])[0].tenant_id
  const ts = Date.now()
  const post = async (tabla: string, data: Record<string, unknown>) => {
    const r = await page.request.post(`${SUPABASE_URL}/rest/v1/${tabla}`, { headers: { ...headers, Prefer: 'return=representation' }, data })
    expect(r.ok(), `[178] ${tabla}: ${await r.text()}`).toBe(true)
    return ((await r.json()) as any[])[0]
  }
  const lista = async (catId: string) =>
    (await (await page.request.get(`${SUPABASE_URL}/rest/v1/categoria_cliente_descuentos?select=producto_id,descuento_pct&categoria_id=eq.${catId}`, { headers })).json()) as any[]

  const cat = await post('categorias_cliente', { tenant_id: tenantId, nombre: `E2E178 ${ts}` })
  const p1 = await post('productos', { tenant_id: tenantId, nombre: `E2E178 uno ${ts}`, sku: `E2E178A-${ts}`, precio_venta: 100, precio_costo: 50, activo: true })
  const p2 = await post('productos', { tenant_id: tenantId, nombre: `E2E178 dos ${ts}`, sku: `E2E178B-${ts}`, precio_venta: 200, precio_costo: 90, activo: true })
  try {
    await goto(page, `/clientes/categorias/${cat.id}/descuentos`)
    await waitForApp(page)
    await expect(page.getByText('Todavía no se aplica en las ventas.')).toBeVisible({ timeout: 15000 })

    // Agregar con coma decimal
    await page.getByLabel('Producto a agregar').fill(`E2E178A-${ts}`)
    await page.getByRole('button', { name: new RegExp(`E2E178 uno ${ts}`) }).click()
    await page.getByLabel('Porcentaje de descuento').fill('12,5')
    await page.getByRole('button', { name: 'Agregar' }).click()
    await expect.poll(async () => (await lista(cat.id)).map(r => [r.producto_id, Number(r.descuento_pct)])).toEqual([[p1.id, 12.5]])

    // Editar a 0: queda en la lista con 0 (no "sin cargar")
    const input = page.getByLabel(`Descuento de E2E178 uno ${ts}`)
    await input.fill('0')
    await input.press('Enter')
    await expect.poll(async () => (await lista(cat.id)).map(r => Number(r.descuento_pct))).toEqual([0])

    // Sacar: queda sin cargar
    await page.getByTitle('Sacar de la lista (queda sin cargar)').click()
    await page.getByRole('button', { name: /^(Confirmar|Aceptar)$/ }).click()
    await expect.poll(async () => (await lista(cat.id)).length).toBe(0)

    // Importar con una fila mala → no carga nada
    await page.getByRole('button', { name: 'Importar Excel' }).click()
    await expect(page).toHaveURL(/descuentos\/importar/)
    const inputArchivo = page.locator('input[type="file"]').first()
    await inputArchivo.setInputFiles({ name: 'malo.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer([['sku', 'nombre', 'descuento_pct'], [`E2E178A-${ts}`, '', 10], [`E2E178B-${ts}`, '', 150]]) })
    await expect(page.getByText(/Descuento "150" no válido/)).toBeVisible({ timeout: 15000 })
    const btnCargar = page.getByRole('button', { name: /^Cargar/ })
    if (await btnCargar.count()) await expect(btnCargar.first()).toBeDisabled()
    expect((await lista(cat.id)).length, '[178] con una fila mala no debía cargar nada').toBe(0)

    // Corregido → carga los dos
    await inputArchivo.setInputFiles({ name: 'bien.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer([['sku', 'nombre', 'descuento_pct'], [`E2E178A-${ts}`, '', 10], [`E2E178B-${ts}`, '', '7,5'], ['', 'sin sku y vacía', '']]) })
    await page.getByRole('button', { name: /^Cargar/ }).first().click()
    await expect(page.getByText(/2 agregados/)).toBeVisible({ timeout: 15000 })
    const final = (await lista(cat.id)).map(r => [r.producto_id, Number(r.descuento_pct)]).sort((a, b) => Number(a[1]) - Number(b[1]))
    expect(final).toEqual([[p2.id, 7.5], [p1.id, 10]])
  } finally {
    await page.request.delete(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${cat.id}`, { headers })
    for (const p of [p1, p2]) await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${p.id}`, { headers, data: { activo: false } })
  }
})
