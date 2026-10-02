/**
 * 172_importador_maestro_mutante.spec.ts
 * E2E MUTANTE — Importar datos maestros (/configuracion/importar, mig 452 `fn_importar_maestro`, D3-a).
 *
 *  A · combo de dos productos (dos filas con el mismo nombre) → UN combo con sus dos `combo_items`
 *      (antes se creaba sin productos y el POS lo ignoraba).
 *  B · motivo con tipo "egreso" (el de la plantilla vieja) → se guarda como `rebaje` (antes lo rechazaba el CHECK).
 *  C · grupo con un estado inexistente → error con motivo y sin botón de carga (antes se salteaba en silencio).
 *  D · todo o nada: una categoría del archivo aparece en la base entre la vista previa y la carga → no se crea ninguna.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

async function abrir(page: Page, tipo: RegExp) {
  await goto(page, '/configuracion/importar')
  await waitForApp(page)
  await expect(page.getByRole('heading', { name: /Importar datos maestros/ })).toBeVisible()
  await page.getByRole('radio', { name: tipo }).check()
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [s] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  return { headers, tid: s.tenant_id as string }
}

async function subir(page: Page, rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Hoja')
  await page.locator('input[type="file"][accept*=".xlsx"]').first().setInputFiles({
    name: `e2e172_${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
}

const get = async (request: APIRequestContext, headers: H, path: string) =>
  (await (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers })).json()) as any[]

test.describe('Importar datos maestros (D3-a, mig 452)', () => {
  test('A · combo de dos productos → un combo con sus dos combo_items', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers } = await abrir(page, /^Combos$/)
    const prods = await get(request, headers, 'productos?activo=eq.true&sku=not.is.null&select=id,sku&order=created_at.asc&limit=2')
    expect(prods.length, 'el tenant de prueba necesita 2 productos activos con SKU').toBe(2)
    const nombre = `E2E 172A ${Date.now()}`
    try {
      await subir(page, [
        { nombre, sku: prods[0].sku, cantidad: 1, descuento_tipo: 'pct', descuento_valor: 10 },
        { nombre, sku: prods[1].sku, cantidad: 2 },
      ])
      await page.getByRole('button', { name: /^Cargar 1 combos/ }).click({ timeout: 15000 })
      await expect(page.getByText(/1 combos creados/).first()).toBeVisible({ timeout: 15000 })
      const [c] = await get(request, headers, `combos?nombre=eq.${encodeURIComponent(nombre)}&select=id,descuento_tipo,descuento_pct,combo_items(producto_id,cantidad)`)
      expect(c).toMatchObject({ descuento_tipo: 'pct', descuento_pct: 10 })
      expect(c.combo_items, '[172A] el combo se creó sin productos: el POS lo ignoraría').toHaveLength(2)
      expect(c.combo_items).toEqual(expect.arrayContaining([
        { producto_id: prods[0].id, cantidad: 1 }, { producto_id: prods[1].id, cantidad: 2 },
      ]))
    } finally {
      const cs = await get(request, headers, `combos?nombre=eq.${encodeURIComponent(nombre)}&select=id`)
      for (const c of cs) {
        await request.delete(`${SUPABASE_URL}/rest/v1/combo_items?combo_id=eq.${c.id}`, { headers })
        await request.delete(`${SUPABASE_URL}/rest/v1/combos?id=eq.${c.id}`, { headers })
      }
    }
  })

  test('B · motivo "egreso" se guarda como rebaje', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers } = await abrir(page, /^Motivos$/)
    const nombre = `E2E 172B ${Date.now()}`
    try {
      await subir(page, [{ nombre, tipo: 'egreso' }])
      await page.getByRole('button', { name: /^Cargar 1 motivos/ }).click({ timeout: 15000 })
      await expect(page.getByText(/1 motivos creados/).first()).toBeVisible({ timeout: 15000 })
      const [m] = await get(request, headers, `motivos_movimiento?nombre=eq.${encodeURIComponent(nombre)}&select=tipo`)
      expect(m.tipo).toBe('rebaje')
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/motivos_movimiento?nombre=eq.${encodeURIComponent(nombre)}`, { headers })
    }
  })

  test('C · grupo con un estado inexistente: error con motivo, sin carga', async ({ page }) => {
    await abrir(page, /^Grupos de estados$/)
    await subir(page, [{ nombre: `E2E 172C ${Date.now()}`, estados: 'Estado Fantasma 172' }])
    await expect(page.getByText(/Estado "Estado Fantasma 172" no existe/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Hay 1 fila con error/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cargar \d+ grupos/ })).toHaveCount(0)
  })

  test('D · todo o nada: si una categoría aparece antes de cargar, no se crea ninguna', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page, /^Categorías$/)
    const ts = Date.now()
    try {
      await subir(page, [{ nombre: `E2E 172D uno ${ts}` }, { nombre: `E2E 172D dos ${ts}` }])
      await expect(page.getByRole('button', { name: /^Cargar 2 categorías/ })).toBeVisible({ timeout: 15000 })
      const r = await request.post(`${SUPABASE_URL}/rest/v1/categorias`, { headers, data: { tenant_id: tid, nombre: `E2E 172D dos ${ts}` } })
      expect(r.ok(), await r.text()).toBe(true)
      await page.getByRole('button', { name: /^Cargar 2 categorías/ }).click()
      await expect(page.getByRole('alert')).toContainText('ya existe', { timeout: 15000 })
      expect(await get(request, headers, `categorias?nombre=eq.${encodeURIComponent(`E2E 172D uno ${ts}`)}&select=id`),
        '[172D] no tenía que crearse la otra categoría').toHaveLength(0)
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/categorias?nombre=like.${encodeURIComponent(`E2E 172D*${ts}`)}`, { headers })
    }
  })
})
