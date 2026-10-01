/**
 * 167_importador_todo_o_nada_mutante.spec.ts
 * E2E MUTANTE — Importador de productos en dos pasos y TODO O NADA (D3-a, mig 447 `fn_importar_productos`).
 *
 *  A · categoría DESACTIVADA → la fila se rechaza con "reactivala o elegí otra"; no hay botón de carga; "Bajar las
 *      filas con error" baja un Excel con el número de fila y el motivo.
 *  B · SKU repetido dentro del archivo → error en las dos filas.
 *  C · todo o nada de verdad: la vista previa da limpio, pero antes de cargar alguien crea uno de esos SKU → la base
 *      rechaza la carga, se informa la fila y NO queda cargado ninguno de los demás.
 *  D · precio programado: "Cancelar los programados" los cancela DENTRO de la misma carga (y el precio se aplica).
 *
 * Genera su propia precondición (nombres con timestamp) y limpia al final (desactiva lo que creó).
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

async function ctx(page: Page) {
  await goto(page, '/productos/importar')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [s] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  return { headers, tid: s.tenant_id as string }
}

function xlsx(rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Productos')
  return {
    name: `e2e167_${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  }
}

async function subir(page: Page, rows: Record<string, unknown>[]) {
  await page.locator('input[type="file"]').setInputFiles(xlsx(rows))
}

const productosPorSku = async (request: APIRequestContext, headers: H, skus: string[]) =>
  (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=in.(${skus.join(',')})&select=id,sku,precio_venta`, { headers })).json()) as any[]

async function desactivar(request: APIRequestContext, headers: H, skus: string[]) {
  const ps = await productosPorSku(request, headers, skus)
  for (const p of ps) await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${p.id}`, { headers, data: { activo: false } })
}

test.describe('Importador de productos — dos pasos, todo o nada (D3-a)', () => {
  test('A · categoría desactivada: rechazo con motivo, sin carga, Excel con las filas con error', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await ctx(page)
    const ts = Date.now()
    const cat = await request.post(`${SUPABASE_URL}/rest/v1/categorias`, {
      headers: { ...headers, Prefer: 'return=representation' }, data: { tenant_id: tid, nombre: `ZZ167 Desactivada ${ts}`, activo: false },
    })
    expect(cat.ok(), await cat.text()).toBe(true)
    const catId = ((await cat.json()) as any[])[0].id
    try {
      await subir(page, [
        { nombre: `E2E 167A ok ${ts}`, sku: `E2E-167A-OK-${ts}`, precio_venta: 100 },
        { nombre: `E2E 167A cat ${ts}`, sku: `E2E-167A-CAT-${ts}`, precio_venta: 100, categoria: `ZZ167 Desactivada ${ts}` },
      ])
      const fila = page.locator('tr', { hasText: `E2E-167A-CAT-${ts}` })
      await expect(fila).toContainText(/está desactivada: reactivala o elegí otra/, { timeout: 15000 })
      await expect(page.getByText(/Hay 1 fila con error/)).toBeVisible()
      await expect(page.getByRole('button', { name: /^Cargar \d+ productos/ })).toHaveCount(0)

      const [descarga] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Bajar las 1 filas con error/ }).click(),
      ])
      const wb = XLSX.read(new Uint8Array(readFileSync((await descarga.path())!)), { type: 'array' })
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
      expect(filas).toHaveLength(1)
      expect(filas[0].fila).toBe(3)
      expect(String(filas[0].motivo)).toMatch(/desactivada/)
      expect(filas[0].sku).toBe(`E2E-167A-CAT-${ts}`)

      expect(await productosPorSku(request, headers, [`E2E-167A-OK-${ts}`]), '[167A] no tenía que cargarse nada').toHaveLength(0)
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/categorias?id=eq.${catId}`, { headers })
    }
  })

  test('B · SKU repetido en el archivo: error en las dos filas', async ({ page }) => {
    const ts = Date.now()
    await ctx(page)
    await subir(page, [
      { nombre: 'Uno', sku: `E2E-167B-${ts}`, precio_venta: 10 },
      { nombre: 'Dos', sku: `e2e-167b-${ts}`, precio_venta: 20 },
    ])
    await expect(page.getByText(/SKU repetido en el archivo \(filas 2, 3\)/).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Hay 2 filas con error/)).toBeVisible()
  })

  test('C · todo o nada: si la base rechaza una fila, no queda cargada ninguna', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await ctx(page)
    const ts = Date.now()
    const skus = [1, 2, 3].map(n => `E2E-167C-${n}-${ts}`)
    try {
      await subir(page, skus.map((sku, i) => ({ nombre: `E2E 167C ${i} ${ts}`, sku, precio_venta: 100 + i })))
      await expect(page.getByRole('button', { name: /^Cargar 3 productos/ })).toBeVisible({ timeout: 15000 })

      // Entre la vista previa y la carga, alguien crea el 2º SKU.
      const r = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
        headers, data: { tenant_id: tid, nombre: `E2E 167C intruso ${ts}`, sku: skus[1], precio_venta: 1, unidad_medida: 'unidad' },
      })
      expect(r.ok(), await r.text()).toBe(true)

      await page.getByRole('button', { name: /^Cargar 3 productos/ }).click()
      const alerta = page.getByRole('alert')
      await expect(alerta).toContainText('No se cargó nada', { timeout: 15000 })
      await expect(alerta).toContainText(`Fila 3 (SKU ${skus[1]}): ya existe un producto con ese SKU`)

      const quedaron = await productosPorSku(request, headers, skus)
      expect(quedaron.map(p => p.sku), '[167C] solo tiene que existir el que creó el "intruso"').toEqual([skus[1]])
      expect(Number(quedaron[0].precio_venta), '[167C] el intruso no se tocó').toBe(1)
    } finally {
      await desactivar(request, headers, skus)
    }
  })

  test('D · precio programado: "Cancelar los programados" los cancela dentro de la misma carga', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await ctx(page)
    const ts = Date.now()
    const sku = `E2E-167D-${ts}`
    const p = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tid, nombre: `E2E 167D ${ts}`, sku, precio_venta: 1000, precio_costo: 500, unidad_medida: 'unidad' },
    })
    expect(p.ok(), await p.text()).toBe(true)
    const id = ((await p.json()) as any[])[0].id
    try {
      const pr = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_programar_precio`, {
        headers, data: { p_producto_id: id, p_precio_venta: 1500, p_vigente_desde: new Date(Date.now() + 86_400_000).toISOString() },
      })
      expect(pr.ok(), await pr.text()).toBe(true)
      const ppId = (await pr.json()) as string

      await subir(page, [{ sku, precio_venta: 1234 }])
      await page.getByRole('button', { name: /^Cargar 1 productos/ }).click({ timeout: 15000 })
      await page.getByRole('button', { name: /Cancelar el programado y guardar/ }).click({ timeout: 8000 })
      await expect(page.getByText(/0 creados · 1 actualizados · 1 precios programados cancelados/)).toBeVisible({ timeout: 15000 })

      const [prod] = await productosPorSku(request, headers, [sku])
      expect(Number(prod.precio_venta)).toBe(1234)
      const [pp] = (await (await request.get(`${SUPABASE_URL}/rest/v1/precios_programados?id=eq.${ppId}&select=estado`, { headers })).json()) as any[]
      expect(pp.estado).toBe('cancelado')
    } finally {
      await desactivar(request, headers, [sku])
    }
  })
})
