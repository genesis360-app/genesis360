/**
 * 162_precio_programado_c3_caminos_mutante.spec.ts
 * E2E MUTANTE — C-3 de Precio programado (respuestas de GO del 25/09) en los caminos que NO son la ficha (la ficha la
 * cubre el 161), más dos casos que el UAT tenía sin test:
 *
 * A · edición masiva de precio (Productos → seleccionar → Precio): pregunta; "Cancelar los programados" los cancela.
 * B · aprobación de un cambio de precio en Supervisión (Productos → Autorizaciones): pregunta; "Mantener" lo deja.
 * C · importador (actualizar precio por archivo): pregunta; "Volver" no importa nada.
 * D · UAT 72.14: si cancelar el programado FALLA, el precio NO se guarda (si no, el programado lo pisaría a su hora).
 *     Se fuerza la falla interceptando la RPC.
 * E · UAT 71.5 (D-3): la plantilla del importador NO ofrece una categoría desactivada; sí una activa (anti-vacío).
 *
 * Productos nuevos por test (prefijo), programados a mañana: el cron nunca los aplica mientras corre.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const PREFIJO = 'E2E PP162'
type H = Record<string, string>
const manana = () => new Date(Date.now() + 24 * 3600 * 1000)

async function ctx(page: Page) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  return { headers }
}

async function tenantId(request: APIRequestContext, headers: H): Promise<string> {
  const [s] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  return s.tenant_id
}

async function crearProducto(request: APIRequestContext, headers: H, tid: string, sufijo: string, precio: number) {
  const nombre = `${PREFIJO} ${sufijo} ${Date.now()}`
  const sku = nombre.replace(/\W+/g, '-').toUpperCase()
  const r = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: { ...headers, Prefer: 'return=representation' },
    data: { tenant_id: tid, nombre, sku, precio_venta: precio, precio_costo: precio / 2, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
  })
  expect(r.ok(), `[162] no se pudo crear el producto: ${await r.text()}`).toBe(true)
  return { id: ((await r.json()) as any[])[0].id as string, nombre, sku }
}

async function programar(request: APIRequestContext, headers: H, productoId: string, precio: number) {
  const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_programar_precio`, {
    headers, data: { p_producto_id: productoId, p_precio_venta: precio, p_vigente_desde: manana().toISOString() },
  })
  expect(r.ok(), `[162] no se pudo programar: ${await r.text()}`).toBe(true)
  return (await r.json()) as string
}

const precio = async (request: APIRequestContext, headers: H, id: string) =>
  Number(((await (await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=precio_venta`, { headers })).json()) as any[])[0].precio_venta)
const estadoPP = async (request: APIRequestContext, headers: H, id: string) =>
  ((await (await request.get(`${SUPABASE_URL}/rest/v1/precios_programados?id=eq.${id}&select=estado`, { headers })).json()) as any[])[0]?.estado as string

async function limpiar(request: APIRequestContext, headers: H, ids: string[]) {
  for (const id of ids) {
    const pps = (await (await request.get(`${SUPABASE_URL}/rest/v1/precios_programados?producto_id=eq.${id}&estado=eq.pendiente&select=id`, { headers })).json()) as any[]
    for (const pp of pps) await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: pp.id } })
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}`, { headers, data: { activo: false } })
  }
}

const avisoC3 = (page: Page) => page.getByText(/Hay (un precio programado|precios programados)/).first()

test.describe('C-3 en los caminos que no son la ficha + casos sin test (mutante)', () => {
  test('A · edición masiva: pregunta y "Cancelar los programados" los cancela', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { headers } = await ctx(page)
    const tid = await tenantId(request, headers)
    const p1 = await crearProducto(request, headers, tid, 'A1', 1000)
    const p2 = await crearProducto(request, headers, tid, 'A2', 1000)
    try {
      const pp1 = await programar(request, headers, p1.id, 1500)
      const pp2 = await programar(request, headers, p2.id, 1600)
      await goto(page, '/productos')
      await waitForApp(page)
      await page.getByPlaceholder(/Buscar por nombre, SKU o código/).fill(`${PREFIJO} A`)
      for (const p of [p1, p2]) {
        const fila = page.locator('div.px-4.py-3', { hasText: p.nombre }).first()
        await expect(fila).toBeVisible({ timeout: 15000 })
        await fila.locator('> div').first().click()
      }
      await page.getByRole('button', { name: /^Precio$/ }).click()
      await page.getByRole('button', { name: /Precio fijo/ }).click()
      await page.getByPlaceholder('Precio exacto').fill('1234')
      await page.getByRole('button', { name: /^Aplicar$/ }).click()
      await expect(avisoC3(page), '[162A] el aviso de programados no apareció').toBeVisible({ timeout: 8000 })
      await expect(page.getByText(/2 de estos productos/)).toBeVisible()
      await page.getByRole('button', { name: /Cancelar los programados y guardar/ }).click()
      await expect.poll(() => precio(request, headers, p1.id), { timeout: 10000 }).toBe(1234)
      expect(await precio(request, headers, p2.id)).toBe(1234)
      expect(await estadoPP(request, headers, pp1)).toBe('cancelado')
      expect(await estadoPP(request, headers, pp2)).toBe('cancelado')
    } finally { await limpiar(request, headers, [p1.id, p2.id]) }
  })

  test('B · Supervisión: aprobar un cambio de precio pregunta; "Mantener" deja el programado', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { headers } = await ctx(page)
    const tid = await tenantId(request, headers)
    const p = await crearProducto(request, headers, tid, 'B', 1000)
    let autId = ''
    try {
      const pp = await programar(request, headers, p.id, 1500)
      const aut = await request.post(`${SUPABASE_URL}/rest/v1/autorizaciones`, {
        headers: { ...headers, Prefer: 'return=representation' },
        data: {
          tenant_id: tid, modulo: 'productos', tipo: 'repricing_margen', estado: 'pendiente',
          datos_cambio: { producto_id: p.id, producto_nombre: p.nombre, precio_anterior: 1000, precio_nuevo: 1111, margen_objetivo: 30 },
          notas: 'E2E 162',
        },
      })
      expect(aut.ok(), `[162B] no se pudo crear la autorización: ${await aut.text()}`).toBe(true)
      autId = ((await aut.json()) as any[])[0].id
      await goto(page, '/productos')
      await waitForApp(page)
      await page.getByRole('button', { name: /Autorizaciones/ }).first().click()
      const card = page.locator('div.p-4', { hasText: p.nombre }).first()
      await expect(card).toBeVisible({ timeout: 15000 })
      await card.getByRole('button', { name: /Aprobar/ }).click()
      await page.getByRole('button', { name: /^Confirmar$/ }).click()
      await expect(avisoC3(page), '[162B] el aviso no apareció al aprobar').toBeVisible({ timeout: 8000 })
      await page.getByRole('button', { name: /Guardar y mantener el programado/ }).click()
      await expect.poll(() => precio(request, headers, p.id), { timeout: 10000 }).toBe(1111)
      expect(await estadoPP(request, headers, pp), '[162B] "Mantener" no tenía que tocar el programado').toBe('pendiente')
    } finally {
      if (autId) await request.delete(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${autId}`, { headers })
      await limpiar(request, headers, [p.id])
    }
  })

  test('C · importador: pregunta antes de importar; "Volver" no importa nada', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { headers } = await ctx(page)
    const tid = await tenantId(request, headers)
    const p = await crearProducto(request, headers, tid, 'C', 1000)
    const archivo = path.join(os.tmpdir(), `e2e162_${Date.now()}.xlsx`)
    try {
      const pp = await programar(request, headers, p.id, 1500)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['sku', 'precio_venta'], [p.sku, 1999]]), 'Productos')
      fs.writeFileSync(archivo, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
      await goto(page, '/productos/importar')
      await waitForApp(page)
      await page.locator('input[type=file][accept*=".xlsx"]').first().setInputFiles(archivo)
      await expect(page.getByText(p.sku).first()).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: /^Confirmar/ }).first().click()
      await expect(avisoC3(page), '[162C] el importador no preguntó').toBeVisible({ timeout: 8000 })
      await page.getByRole('button', { name: /^Volver$/ }).last().click()
      await page.waitForTimeout(1500)
      expect(await precio(request, headers, p.id), '[162C] "Volver" no tenía que importar').toBe(1000)
      expect(await estadoPP(request, headers, pp)).toBe('pendiente')
    } finally {
      fs.rmSync(archivo, { force: true })
      await limpiar(request, headers, [p.id])
    }
  })

  test('D · UAT 72.14: si cancelar el programado falla, el precio NO se guarda', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { headers } = await ctx(page)
    const tid = await tenantId(request, headers)
    const p = await crearProducto(request, headers, tid, 'D', 1000)
    try {
      const pp = await programar(request, headers, p.id, 1500)
      await page.route('**/rest/v1/rpc/fn_cancelar_precio_programado', r => r.fulfill({ status: 500, json: { message: 'falla simulada E2E' } }))
      await goto(page, `/productos/${p.id}/editar`)
      await waitForApp(page)
      const input = page.locator('label', { hasText: /^Precio de venta/ }).first().locator('xpath=../..').locator('input[type=number]').first()
      await expect(input).toBeVisible({ timeout: 15000 })
      await input.fill('1200')
      await page.getByRole('button', { name: /^Guardar cambios$/ }).click()
      await page.getByRole('dialog', { name: /Desde cuándo rige/i }).getByRole('button', { name: /^Guardar$/ }).click()
      await expect(avisoC3(page)).toBeVisible({ timeout: 8000 })
      await page.getByRole('button', { name: /Cancelar el programado y guardar/ }).click()
      await expect(page.getByText(/No se pudo cancelar el precio programado/).first(), '[162D] el error no se mostró').toBeVisible({ timeout: 8000 })
      await page.waitForTimeout(1500)
      expect(await precio(request, headers, p.id), '[162D] con la cancelación fallida NO se tenía que guardar el precio').toBe(1000)
      expect(await estadoPP(request, headers, pp)).toBe('pendiente')
    } finally {
      await page.unroute('**/rest/v1/rpc/fn_cancelar_precio_programado')
      await limpiar(request, headers, [p.id])
    }
  })

  test('E · UAT 71.5: la plantilla no ofrece categorías desactivadas', async ({ page, request }) => {
    test.setTimeout(120_000)
    const { headers } = await ctx(page)
    const tid = await tenantId(request, headers)
    const ts = Date.now()
    const h = { ...headers, Prefer: 'return=representation' }
    const act = await request.post(`${SUPABASE_URL}/rest/v1/categorias`, { headers: h, data: { tenant_id: tid, nombre: `ZZ162 Activa ${ts}` } })
    const ina = await request.post(`${SUPABASE_URL}/rest/v1/categorias`, { headers: h, data: { tenant_id: tid, nombre: `ZZ162 Inactiva ${ts}`, activo: false } })
    expect(act.ok() && ina.ok(), '[162E] no se pudieron crear las categorías').toBe(true)
    const ids = [((await act.json()) as any[])[0].id, ((await ina.json()) as any[])[0].id]
    const archivo = path.join(os.tmpdir(), `e2e162_plantilla_${ts}.xlsx`)
    try {
      await goto(page, '/productos/importar')
      await waitForApp(page)
      const btn = page.getByRole('button', { name: /Descargar plantilla/i }).first()
      await expect(btn).toBeVisible({ timeout: 15000 })
      const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()])
      await dl.saveAs(archivo)
      const wb = XLSX.read(fs.readFileSync(archivo))
      const cats = (XLSX.utils.sheet_to_json(wb.Sheets.Listas, { header: 1 }) as any[][]).map(r => r[0])
      expect(cats, '[162E] anti-vacío: la activa tenía que estar').toContain(`ZZ162 Activa ${ts}`)
      expect(cats, '[162E] la desactivada NO tenía que ofrecerse').not.toContain(`ZZ162 Inactiva ${ts}`)
    } finally {
      fs.rmSync(archivo, { force: true })
      for (const id of ids) await request.delete(`${SUPABASE_URL}/rest/v1/categorias?id=eq.${id}`, { headers })
    }
  })
})
