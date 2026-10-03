/**
 * 75_kit_desarmar_mutante.spec.ts
 * E2E MUTANTE — Desarmar un KIT devuelve los componentes al stock (REGLA #0, stock).
 *
 * Desde la mig 459 el desarmado es la RPC atómica `desarmar_kit` (antes: escrituras sueltas desde el navegador, con el
 * stock_antes del KIT leído DESPUÉS del rebaje). El spec siembra su propio KIT (receta: componente ×3) en Almacén
 * Jorgito (avanzado), desarma 2 por la UI eligiendo la ubicación y verifica en la base:
 *   · KIT 5 → 3 y componente 10 → 16; los componentes entran en la ubicación elegida;
 *   · movimiento `des_kitting` con antes/después correctos (5 → 3) e `ingreso` del componente (10 → 16);
 *   · un `kitting_log` tipo 'desarmado'.
 * Y por la RPC: una cantidad que da componentes fraccionarios se RECHAZA sin tocar nada (la columna es entera).
 * Limpieza en `finally`: desactiva las líneas y los productos sembrados.
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

async function get(page: Page, headers: H, path: string): Promise<any[]> {
  const r = await page.request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers })
  expect(r.ok(), `[75] GET ${path}: ${await r.text()}`).toBe(true)
  return r.json()
}

async function post(page: Page, headers: H, tabla: string, data: Record<string, unknown>): Promise<any> {
  const r = await page.request.post(`${SUPABASE_URL}/rest/v1/${tabla}`, { headers: { ...headers, Prefer: 'return=representation' }, data })
  expect(r.ok(), `[75] POST ${tabla}: ${await r.text()}`).toBe(true)
  return ((await r.json()) as any[])[0]
}

const stockEn = async (page: Page, headers: H, prodId: string, sucId: string) =>
  (await get(page, headers, `inventario_lineas?select=cantidad&producto_id=eq.${prodId}&sucursal_id=eq.${sucId}&activo=eq.true`))
    .reduce((s, l) => s + Number(l.cantidad), 0)

test.describe('Desarmar KIT — RPC atómica (mig 459)', () => {
  test('desarmar 2 KITs → KIT −2, componente +6, movimientos y log correctos', async ({ page }) => {
    test.setTimeout(120_000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))

    const sucs = await get(page, headers, 'sucursales?select=id,nombre,tenant_id&activo=eq.true')
    const suc = sucs.find(s => /norte/i.test(s.nombre)) ?? sucs[0]
    const tid = suc.tenant_id as string
    const [tenant] = await get(page, headers, `tenants?select=modo_operacion&id=eq.${tid}`)
    expect(tenant.modo_operacion, '[75] el tenant de prueba debería ser avanzado').toBe('avanzado')
    const ubis = await get(page, headers, `ubicaciones?select=id&activo=eq.true&sucursal_id=eq.${suc.id}&limit=2`)
    expect(ubis.length, '[75] la sucursal no tiene ubicaciones').toBeGreaterThan(0)
    const ubiKit = ubis[0].id as string
    const ubiComp = (ubis[1] ?? ubis[0]).id as string

    const ts = Date.now()
    const comp = await post(page, headers, 'productos', { tenant_id: tid, nombre: `E2E75 componente ${ts}`, sku: `E2E75C-${ts}`, precio_venta: 100, precio_costo: 50, activo: true })
    const kit = await post(page, headers, 'productos', { tenant_id: tid, nombre: `E2E75 KIT ${ts}`, sku: `E2E75K-${ts}`, precio_venta: 300, precio_costo: 150, activo: true, es_kit: true })
    try {
      await post(page, headers, 'kit_recetas', { tenant_id: tid, kit_producto_id: kit.id, comp_producto_id: comp.id, cantidad: 3 })
      await post(page, headers, 'inventario_lineas', { tenant_id: tid, producto_id: kit.id, cantidad: 5, sucursal_id: suc.id, ubicacion_id: ubiKit, activo: true })
      await post(page, headers, 'inventario_lineas', { tenant_id: tid, producto_id: comp.id, cantidad: 10, sucursal_id: suc.id, ubicacion_id: ubiKit, activo: true })

      // ── RPC: 1 KIT con receta 0,5 → 0,5 unidades → rechazo sin tocar nada ──
      const rec = await get(page, headers, `kit_recetas?select=id&kit_producto_id=eq.${kit.id}`)
      await page.request.patch(`${SUPABASE_URL}/rest/v1/kit_recetas?id=eq.${rec[0].id}`, { headers, data: { cantidad: 0.5 } })
      const fr = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/desarmar_kit`, {
        headers, data: { p_kit_producto_id: kit.id, p_cantidad: 1, p_ubicacion_id: ubiComp, p_sucursal_id: suc.id, p_notas: null },
      })
      expect(fr.ok(), '[75] la RPC aceptó un componente fraccionario').toBe(false)
      expect(await fr.text()).toMatch(/unidades enteras/)
      expect(await stockEn(page, headers, kit.id, suc.id), '[75] el rechazo tocó el stock del KIT').toBe(5)
      await page.request.patch(`${SUPABASE_URL}/rest/v1/kit_recetas?id=eq.${rec[0].id}`, { headers, data: { cantidad: 3 } })

      // ── UI: desarmar 2 eligiendo la ubicación de los componentes ──
      await page.evaluate(id => localStorage.setItem('sucursal-id', id), suc.id)
      await goto(page, '/inventario')
      await waitForApp(page)
      await page.getByRole('button', { name: /^Kits$/ }).first().click()
      await page.getByPlaceholder('Buscar KIT por nombre o SKU...').fill(`E2E75K-${ts}`)
      const row = page.locator('div').filter({ hasText: `E2E75 KIT ${ts}` }).filter({ has: page.getByRole('button', { name: /^Desarmar$/ }) }).last()
      await expect(row, '[75] el KIT sembrado no aparece en la tab Kits').toBeVisible({ timeout: 15000 })
      await row.getByRole('button', { name: /^Desarmar$/ }).click()
      await expect(page.getByRole('heading', { name: /Desarmar KIT/i })).toBeVisible({ timeout: 5000 })
      const modal = page.locator('.fixed.inset-0')
      await modal.locator('input').first().fill('2')
      await page.getByLabel('Ubicación de los componentes').selectOption(ubiComp)
      await modal.getByRole('button', { name: /^Desarmar$/ }).click()
      await expect(page.getByRole('heading', { name: /Desarmar KIT/i })).not.toBeVisible({ timeout: 15000 })

      // ── Base ──
      expect(await stockEn(page, headers, kit.id, suc.id), '[75] stock del KIT').toBe(3)
      expect(await stockEn(page, headers, comp.id, suc.id), '[75] stock del componente').toBe(16)
      const enUbi = await get(page, headers, `inventario_lineas?select=cantidad&producto_id=eq.${comp.id}&ubicacion_id=eq.${ubiComp}&activo=eq.true`)
      expect(enUbi.reduce((s, l) => s + Number(l.cantidad), 0), '[75] los componentes no entraron en la ubicación elegida')
        .toBeGreaterThanOrEqual(6)

      const [mk] = await get(page, headers, `movimientos_stock?select=tipo,cantidad,stock_antes,stock_despues&producto_id=eq.${kit.id}&tipo=eq.des_kitting`)
      expect(mk, '[75] falta el movimiento des_kitting').toBeTruthy()
      expect([Number(mk.cantidad), Number(mk.stock_antes), Number(mk.stock_despues)], '[75] des_kitting: cantidad/antes/después').toEqual([2, 5, 3])
      const [mc] = await get(page, headers, `movimientos_stock?select=cantidad,stock_antes,stock_despues&producto_id=eq.${comp.id}&tipo=eq.ingreso`)
      expect([Number(mc.cantidad), Number(mc.stock_antes), Number(mc.stock_despues)], '[75] ingreso del componente').toEqual([6, 10, 16])
      const logs = await get(page, headers, `kitting_log?select=tipo,cantidad_kits&kit_producto_id=eq.${kit.id}`)
      expect(logs.map(l => [l.tipo, Number(l.cantidad_kits)]), '[75] kitting_log').toEqual([['desarmado', 2]])
    } finally {
      for (const id of [kit.id, comp.id]) {
        await page.request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${id}`, { headers, data: { activo: false } })
        await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}`, { headers, data: { activo: false } })
      }
    }
  })
})
