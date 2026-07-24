/**
 * 102_precio_por_uom_mutante.spec.ts
 * E2E MUTANTE — Precio por presentación (rediseño UoM Fase 2, mig 304). Reemplaza el modelo de
 * "ancla por posición" (nivel_precio_orden, eliminado — bug F3). Ahora productos.precio_venta es
 * SIEMPRE el precio por unidad BASE, cada presentación deriva base × factor salvo override propio,
 * y el trigger trg_pp_sync_niveles auto-construye producto_presentaciones desde la estructura.
 *
 * Genera su propia precondición: producto nuevo (base $100) + estructura Unidad→Caja ×12 con
 * override $1080 en la Caja, vía RPC real fn_estructura_guardar_niveles. Verifica en DB que
 * (a) el override del nivel persiste, (b) producto_presentaciones quedó bien: base sin override
 * (deriva del precio base), Caja con override 1080; y por UI que el form muestra el precio "por
 * Unidad" y ya NO existe el selector de ancla "Estos precios corresponden a".
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Precio por presentación (mutante)', () => {
  test('override de nivel persiste + producto_presentaciones auto-construido, sin ancla', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E PrecioUoM ${Date.now()}`

    // 1) Producto nuevo
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(prod, '[102] no se encontró el producto recién creado por REST').toBeTruthy()

    // Precio base (por unidad base) conocido, para verificar el cálculo derivado.
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: 100, precio_costo: 60 },
    })

    // 2) Estructura Unidad → Caja ×12, con override en Caja ($1080, no 100×12=1200)
    const udmRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Unidad&select=id`, { headers })
    const [udmUnidad] = (await udmRes.json()) as Array<{ id: string }>
    expect(udmUnidad, '[102] falta la UdM predefinida Unidad').toBeTruthy()
    const udmCajaRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Caja&select=id`, { headers })
    const [udmCaja] = (await udmCajaRes.json()) as Array<{ id: string }>
    expect(udmCaja, '[102] falta la UdM predefinida Caja').toBeTruthy()

    const estrId = crypto.randomUUID()
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_estructuras`, {
      headers,
      data: { id: estrId, tenant_id: prod.tenant_id, producto_id: prod.id, nombre: 'Precio UoM E2E', is_default: true },
    })
    expect(insRes.ok(), `[102] no se pudo crear la estructura: ${await insRes.text()}`).toBe(true)

    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: {
        p_estructura_id: estrId,
        p_niveles: [
          { unidad_medida_id: udmUnidad.id, factor: 1 },
          { unidad_medida_id: udmCaja.id, factor: 12, precio_venta: 1080, precio_costo: 650 },
        ],
      },
    })
    expect(rpcRes.ok(), `[102] no se pudieron guardar los niveles con precio: ${await rpcRes.text()}`).toBe(true)

    // 3) POSITIVO en DB: el override del nivel Caja persistió tal cual (no se recalculó)
    const nivelesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estrId}&order=orden&select=orden,precio_venta,precio_costo,unidades_base`,
      { headers },
    )
    const niveles = (await nivelesRes.json()) as Array<{ orden: number; precio_venta: number | null; precio_costo: number | null; unidades_base: number }>
    expect(niveles).toHaveLength(2)
    expect(niveles[0].precio_venta, '[102] nivel base no debería tener precio propio (usa el de productos)').toBeNull()
    expect(Number(niveles[1].precio_venta), '[102] el nivel Caja debería guardar su override, no 12×100').toBe(1080)
    expect(Number(niveles[1].precio_costo)).toBe(650)
    expect(niveles[1].unidades_base).toBe(12)

    // 4) POSITIVO en DB: el trigger auto-construyó producto_presentaciones (mig 304)
    const presRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prod.id}&order=orden&select=etiqueta,factor_base,es_base,precio_venta,precio_costo`,
      { headers },
    )
    const pres = (await presRes.json()) as Array<{ etiqueta: string; factor_base: number; es_base: boolean; precio_venta: number | null; precio_costo: number | null }>
    expect(pres, '[102] el trigger debería haber creado 2 presentaciones').toHaveLength(2)
    // Base: es_base, factor 1, SIN override (deriva de productos.precio_venta = 100)
    expect(pres[0].es_base).toBe(true)
    expect(Number(pres[0].factor_base)).toBe(1)
    expect(pres[0].precio_venta, '[102] la presentación base NO lleva override (el precio vive en productos)').toBeNull()
    // Caja: factor 12, override 1080 (el efectivo NO es 100×12=1200)
    expect(pres[1].es_base).toBe(false)
    expect(Number(pres[1].factor_base)).toBe(12)
    expect(Number(pres[1].precio_venta), '[102] la Caja mantiene su override 1080').toBe(1080)
    expect(Number(pres[1].precio_costo)).toBe(650)

    // 5) UI: la hoja de producto muestra el precio por unidad base y NO tiene selector de ancla
    await goto(page, `/productos/${prod.id}/editar`)
    await waitForApp(page)
    await expect(page.getByText(/Estos precios corresponden a/)).toHaveCount(0)
    await expect(page.getByText(/Precio de venta \(por Unidad\)/)).toBeVisible({ timeout: 8000 })
  })
})
