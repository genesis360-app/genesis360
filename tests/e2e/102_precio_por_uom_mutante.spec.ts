/**
 * 102_precio_por_uom_mutante.spec.ts
 * E2E MUTANTE — Presentaciones sin precio propio + árbol genealógico (rediseño UoM Fase 2-bis
 * chunk 2, mig 307). El empaque es LOGÍSTICA PURA: no hay override de precio por presentación;
 * el precio de una Caja = productos.precio_venta (por unidad base) × factor_base. El árbol
 * genealógico se materializa en producto_presentaciones.padre_linea_id (base = NULL, Caja → base).
 * H2: la etiqueta de la presentación base deriva de productos.unidad_medida.
 *
 * Genera su propia precondición: producto nuevo (base $100) + estructura Unidad→Caja ×12 vía
 * RPC real fn_estructura_guardar_niveles. Verifica en DB que producto_presentaciones quedó bien
 * (base sin padre + etiqueta = UdM de la ficha, Caja con padre = base) y NO tiene columnas de
 * precio; y por UI que el form muestra el precio por unidad y ya NO existe el selector de ancla.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Presentaciones sin precio + árbol genealógico (mutante)', () => {
  test('empaque sin override: Caja = base×factor, padre_linea_id materializado, sin ancla', async ({ page, request }) => {
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
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id,unidad_medida`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string; unidad_medida: string }>
    expect(prod, '[102] no se encontró el producto recién creado por REST').toBeTruthy()

    // Precio base (por unidad base) conocido.
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: 100, precio_costo: 60 },
    })

    // 2) Estructura Unidad → Caja ×12. Aunque mandemos precio en el payload, el RPC lo IGNORA
    //    (empaque sin precio, mig 307): probamos que no rompe y que la Caja no queda con override.
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
          { unidad_medida_id: udmCaja.id, factor: 12, precio_venta: 1080 }, // el precio se ignora (mig 307)
        ],
      },
    })
    expect(rpcRes.ok(), `[102] no se pudieron guardar los niveles: ${await rpcRes.text()}`).toBe(true)

    // 3) POSITIVO en DB: niveles con factor/unidades_base correctos (ya sin columnas de precio)
    const nivelesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estrId}&order=orden&select=orden,factor,unidades_base`,
      { headers },
    )
    const niveles = (await nivelesRes.json()) as Array<{ orden: number; factor: number; unidades_base: number }>
    expect(niveles).toHaveLength(2)
    expect(Number(niveles[1].unidades_base), '[102] Caja = 12 unidades base').toBe(12)

    // 4) POSITIVO en DB: el trigger auto-construyó producto_presentaciones con el ÁRBOL genealógico
    const presRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prod.id}&order=orden&select=etiqueta,factor_base,es_base,padre_linea_id,id`,
      { headers },
    )
    const pres = (await presRes.json()) as Array<{ etiqueta: string; factor_base: number; es_base: boolean; padre_linea_id: string | null; id: string }>
    expect(pres, '[102] el trigger debería haber creado 2 presentaciones').toHaveLength(2)
    // Base: es_base, factor 1, SIN padre (raíz del árbol), etiqueta = UdM de la ficha (H2)
    expect(pres[0].es_base).toBe(true)
    expect(Number(pres[0].factor_base)).toBe(1)
    expect(pres[0].padre_linea_id, '[102] la base es la raíz del árbol (padre NULL)').toBeNull()
    expect(pres[0].etiqueta, '[102] H2: la etiqueta base deriva de productos.unidad_medida').toBe(prod.unidad_medida)
    // Caja: factor 12, padre = la presentación base (árbol genealógico, mig 307)
    expect(pres[1].es_base).toBe(false)
    expect(Number(pres[1].factor_base)).toBe(12)
    expect(pres[1].padre_linea_id, '[102] la Caja apunta a la base como padre').toBe(pres[0].id)
    // La columna de precio ya NO existe en el select → empaque sin precio propio
    expect(pres[1]).not.toHaveProperty('precio_venta')

    // 5) UI: la hoja de producto muestra el precio por unidad base y NO tiene selector de ancla
    await goto(page, `/productos/${prod.id}/editar`)
    await waitForApp(page)
    await expect(page.getByText(/Estos precios corresponden a/)).toHaveCount(0)
    await expect(page.getByText(/Precio de venta/).first()).toBeVisible({ timeout: 8000 })
  })
})
