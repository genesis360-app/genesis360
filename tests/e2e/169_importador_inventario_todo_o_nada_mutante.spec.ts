/**
 * 169_importador_inventario_todo_o_nada_mutante.spec.ts
 * E2E MUTANTE — Importador de inventario (ingreso de stock), dos pasos y TODO O NADA (D3-a, mig 449
 * `fn_importar_inventario`). REGLA #0: tiene que dejar lo mismo que el ingreso normal.
 *
 *  A · dos filas del mismo producto → 2 líneas EN LA SUCURSAL elegida, movimientos encadenados 0→5→8, stock 8.
 *  B · cantidad decimal y ubicación inexistente → error con motivo (antes: truncaba / ignoraba en silencio), sin carga.
 *  C · todo o nada: la vista previa da limpio, pero antes de cargar alguien usa uno de los LPN → no se carga ninguna.
 *
 * Producto propio por test (timestamp). El ledger de movimientos es inmutable (queda); líneas y producto se desactivan.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarUbicacionSiembra, UBICACION_SIEMBRA } from './helpers/fixtures'

type H = Record<string, string>

async function abrir(page: Page) {
  await goto(page, '/inventario')
  await waitForApp(page)
  if (await garantizarUbicacionSiembra(page)) await page.reload()
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [s] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  await goto(page, '/inventario/importar')
  await waitForApp(page)
  // Si no hay sucursal activa en el filtro, la pantalla pide elegirla.
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Elegí la sucursal…' }) })
  let sucursalId: string | null = null
  if (await sel.count()) {
    await sel.selectOption({ index: 1 })
    sucursalId = await sel.inputValue()
  }
  return { headers, tid: s.tenant_id as string, sucursalId }
}

async function subir(page: Page, rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Inventario')
  await page.locator('input[type="file"]').setInputFiles({
    name: `e2e169_${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
}

async function crearProducto(request: APIRequestContext, headers: H, tid: string, sufijo: string) {
  const sku = `E2E-169${sufijo}-${Date.now()}`
  const r = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: { ...headers, Prefer: 'return=representation' },
    data: { tenant_id: tid, nombre: `E2E 169${sufijo} ${Date.now()}`, sku, precio_costo: 10, precio_venta: 20, unidad_medida: 'unidad' },
  })
  expect(r.ok(), await r.text()).toBe(true)
  return { id: ((await r.json()) as any[])[0].id as string, sku }
}

async function limpiar(request: APIRequestContext, headers: H, productoId: string) {
  await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${productoId}`, { headers, data: { activo: false } })
  await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${productoId}`, { headers, data: { activo: false } })
}

test.describe('Importador de inventario — dos pasos, todo o nada (D3-a, REGLA #0)', () => {
  test('A · línea en la sucursal, movimientos encadenados y stock exacto', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page)
    const p = await crearProducto(request, headers, tid, 'A')
    try {
      await subir(page, [
        { sku: p.sku, cantidad: 5, ubicacion: UBICACION_SIEMBRA, motivo: 'Carga inicial E2E' },
        { sku: p.sku, cantidad: 3, ubicacion: UBICACION_SIEMBRA },
      ])
      await page.getByRole('button', { name: /^Cargar 2 líneas al inventario/ }).click({ timeout: 15000 })
      await expect(page.getByText(/2 líneas cargadas · 8 unidades/).first()).toBeVisible({ timeout: 15000 })

      const lineas = (await (await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${p.id}&select=cantidad,sucursal_id,ubicacion_id,lpn`, { headers })).json()) as any[]
      expect(lineas.map(l => l.cantidad).sort()).toEqual([3, 5])
      expect(lineas.every(l => l.sucursal_id), '[169A] las líneas tienen que quedar en la sucursal').toBe(true)
      expect(lineas.every(l => l.ubicacion_id && l.lpn)).toBe(true)
      const movs = (await (await request.get(`${SUPABASE_URL}/rest/v1/movimientos_stock?producto_id=eq.${p.id}&select=tipo,cantidad,stock_antes,stock_despues,sucursal_id&order=stock_antes`, { headers })).json()) as any[]
      expect(movs.map(m => `${m.tipo}:${m.stock_antes}→${m.stock_despues}`)).toEqual(['ingreso:0→5', 'ingreso:5→8'])
      expect(movs.every(m => m.sucursal_id)).toBe(true)
      const [prod] = (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${p.id}&select=stock_actual`, { headers })).json()) as any[]
      expect(prod.stock_actual).toBe(8)
    } finally {
      await limpiar(request, headers, p.id)
    }
  })

  test('B · cantidad decimal y ubicación inexistente: error con motivo, sin carga', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page)
    const p = await crearProducto(request, headers, tid, 'B')
    try {
      await subir(page, [
        { sku: p.sku, cantidad: '1,5' },
        { sku: p.sku, cantidad: 2, ubicacion: `No existe ${Date.now()}` },
      ])
      await expect(page.getByText(/Cantidad "1,5": tiene que ser un número entero/)).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(/Ubicación "No existe \d+" no existe — tiene que existir en esta sucursal/)).toBeVisible()
      await expect(page.getByText(/Hay 2 filas con error/)).toBeVisible()
      await expect(page.getByRole('button', { name: /^Cargar \d+ líneas/ })).toHaveCount(0)
    } finally {
      await limpiar(request, headers, p.id)
    }
  })

  test('C · todo o nada: si la base rechaza una fila, no se carga ninguna', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page)
    const p = await crearProducto(request, headers, tid, 'C')
    const ts = Date.now()
    try {
      await subir(page, [
        { sku: p.sku, cantidad: 4, ubicacion: UBICACION_SIEMBRA, lpn: `E2E169-L1-${ts}` },
        { sku: p.sku, cantidad: 6, ubicacion: UBICACION_SIEMBRA, lpn: `E2E169-L2-${ts}` },
      ])
      await expect(page.getByRole('button', { name: /^Cargar 2 líneas/ })).toBeVisible({ timeout: 15000 })
      // Entre la vista previa y la carga, alguien crea una línea con el 2º LPN.
      const [suc] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id&limit=1`, { headers })).json()) as any[]
      // Con ubicación: desde la mig 455 la base no acepta stock sin ubicación en avanzado.
      const [ubic] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ubicaciones?select=id&nombre=eq.${encodeURIComponent(UBICACION_SIEMBRA)}&limit=1`, { headers })).json()) as any[]
      const otra = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
        headers, data: { tenant_id: tid, producto_id: p.id, lpn: `E2E169-L2-${ts}`, cantidad: 1, sucursal_id: suc.id, ubicacion_id: ubic.id },
      })
      expect(otra.ok(), await otra.text()).toBe(true)

      await page.getByRole('button', { name: /^Cargar 2 líneas/ }).click()
      const alerta = page.getByRole('alert')
      await expect(alerta).toContainText('No se cargó nada', { timeout: 15000 })
      await expect(alerta).toContainText(`Fila 3: el LPN "E2E169-L2-${ts}" ya existe`)
      const lineas = (await (await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${p.id}&select=lpn`, { headers })).json()) as any[]
      expect(lineas.map(l => l.lpn), '[169C] solo tiene que existir la línea del "intruso"').toEqual([`E2E169-L2-${ts}`])
    } finally {
      await limpiar(request, headers, p.id)
    }
  })
})
