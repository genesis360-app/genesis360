/**
 * 161_precio_programado_c1_c3_mutante.spec.ts
 * E2E MUTANTE — Precio programado, respuestas de GO del 25/09:
 *
 * C-1 (mig 441) — con "el precio cambia recién cuando el repositor confirma la etiqueta", pasada la hora el cron NO
 *     aplica el precio mientras la etiqueta siga abierta; Repositores lo explica ("empieza a regir cuando confirmes") y
 *     al confirmar desde la pantalla el precio rige EN EL ACTO, sin pedir otra etiqueta. Anti-vacío: se espera un
 *     minuto de cron completo pasada la hora y el precio tiene que seguir siendo el viejo.
 *     (El caso "lo confirma un rol que NO puede cambiar precios" y los intentos de abuso del guard se probaron por SQL
 *     con impersonación — UAT §72.)
 * C-3 — cambiar el precio "ahora" en la ficha de un producto con un programado pendiente pregunta qué hacer:
 *     "Cancelar el programado" (por defecto) lo cancela; "Mantener" lo deja; "Volver" no guarda nada.
 *
 * ⚠️ C-1 prende el modo en el negocio de prueba (Almacén Jorgito) mientras corre y lo restaura en `finally`: no correr
 * en paralelo con el spec 151, que espera la aplicación a la hora exacta.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const PREFIJO = 'E2E PP161'
type H = Record<string, string>

async function tenantId(request: APIRequestContext, headers: H): Promise<string> {
  const [suc] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
  expect(suc?.tenant_id).toBeTruthy()
  return suc.tenant_id
}

async function crearProducto(request: APIRequestContext, headers: H, tid: string, nombre: string, precio: number): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: { ...headers, Prefer: 'return=representation' },
    data: { tenant_id: tid, nombre, sku: `${nombre.replace(/\W+/g, '-').toUpperCase()}`, precio_venta: precio, precio_costo: precio / 2, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
  })
  expect(res.ok(), `[161] no se pudo crear el producto: ${await res.text()}`).toBe(true)
  return ((await res.json()) as Array<{ id: string }>)[0].id
}

async function asignarGondolaNorte(request: APIRequestContext, headers: H, tid: string, productoId: string) {
  const [g] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ubicaciones?select=id&tipo_logico=eq.exhibicion&sucursal_id=eq.${NORTE}&activo=eq.true&limit=1`, { headers })).json()) as Array<{ id: string }>
  expect(g, '[161] Sucursal Norte sin góndola').toBeTruthy()
  const r = await request.post(`${SUPABASE_URL}/rest/v1/producto_ubicacion_sucursal?on_conflict=producto_id,sucursal_id`, {
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    data: { tenant_id: tid, producto_id: productoId, sucursal_id: NORTE, ubicacion_exhibicion_id: g.id },
  })
  expect(r.ok(), `[161] no se pudo asignar la góndola: ${await r.text()}`).toBe(true)
}

async function programar(request: APIRequestContext, headers: H, productoId: string, precio: number, desde: Date): Promise<string> {
  const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_programar_precio`, {
    headers, data: { p_producto_id: productoId, p_precio_venta: precio, p_vigente_desde: desde.toISOString() },
  })
  expect(r.ok(), `[161] no se pudo programar: ${await r.text()}`).toBe(true)
  return (await r.json()) as string
}

const precio = async (request: APIRequestContext, headers: H, id: string) =>
  Number(((await (await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=precio_venta`, { headers })).json()) as any[])[0].precio_venta)
const estadoPP = async (request: APIRequestContext, headers: H, id: string) =>
  ((await (await request.get(`${SUPABASE_URL}/rest/v1/precios_programados?id=eq.${id}&select=estado`, { headers })).json()) as any[])[0]?.estado as string

async function limpiarViejos(request: APIRequestContext, headers: H) {
  const pps = (await (await request.get(`${SUPABASE_URL}/rest/v1/precios_programados?select=id,productos!inner(nombre)&estado=eq.pendiente&productos.nombre=like.${encodeURIComponent(PREFIJO)}*`, { headers })).json()) as Array<{ id: string }>
  for (const pp of pps) await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: pp.id } })
  const ts = (await (await request.get(`${SUPABASE_URL}/rest/v1/tareas_repositor?select=id,productos!inner(nombre)&estado=in.(pendiente,en_curso)&productos.nombre=like.${encodeURIComponent(PREFIJO)}*`, { headers })).json()) as Array<{ id: string }>
  for (const t of ts) await request.patch(`${SUPABASE_URL}/rest/v1/tareas_repositor?id=eq.${t.id}`, { headers, data: { estado: 'cancelada', cancelled_at: new Date().toISOString(), motivo_cancelacion: 'E2E 161 — limpieza' } })
}

/** Abre la ficha, pone un precio nuevo y guarda con "Ahora". Devuelve cuando aparece el aviso de C-3. */
async function cambiarPrecioAhora(page: Page, productoId: string, nuevo: number) {
  await goto(page, `/productos/${productoId}/editar`)
  await waitForApp(page)
  const input = page.locator('label', { hasText: /^Precio de venta/ }).first().locator('xpath=../..').locator('input[type=number]').first()
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill(String(nuevo))
  await page.getByRole('button', { name: /^Guardar cambios$/ }).click()
  await expect(page.getByRole('dialog', { name: /Desde cuándo rige/i })).toBeVisible({ timeout: 8000 })
  await page.getByRole('dialog', { name: /Desde cuándo rige/i }).getByRole('button', { name: /^Guardar$/ }).click()
  await expect(page.getByText('Hay un precio programado').first(), '[161] C-3: el aviso de programado pendiente no apareció').toBeVisible({ timeout: 8000 })
}

test.describe('Precio programado — C-1 (espera la etiqueta) y C-3 (cambio "ahora" con programado pendiente)', () => {
  test('C-3 · la ficha pregunta: cancelar (por defecto), mantener o volver', async ({ page, request }) => {
    test.setTimeout(180_000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    await limpiarViejos(request, headers)
    const tid = await tenantId(request, headers)
    const prod = await crearProducto(request, headers, tid, `${PREFIJO} C3 ${Date.now()}`, 1000)
    const manana = new Date(Date.now() + 24 * 3600 * 1000)

    // 1 · Volver: no guarda nada
    const pp1 = await programar(request, headers, prod, 1500, manana)
    await cambiarPrecioAhora(page, prod, 1200)
    await page.getByRole('button', { name: /^Volver$/ }).last().click()
    await expect(page.getByText('Hay un precio programado')).toHaveCount(0)
    expect(await precio(request, headers, prod), '[161] "Volver" no tenía que guardar el precio').toBe(1000)
    expect(await estadoPP(request, headers, pp1)).toBe('pendiente')

    // 2 · Cancelar el programado (opción por defecto) y guardar
    await cambiarPrecioAhora(page, prod, 1200)
    await page.getByRole('button', { name: /Cancelar el programado y guardar/ }).click()
    await expect.poll(() => precio(request, headers, prod), { timeout: 10000 }).toBe(1200)
    expect(await estadoPP(request, headers, pp1), '[161] el programado tenía que quedar cancelado').toBe('cancelado')

    // 3 · Mantener: guarda el precio y el programado sigue en pie
    const pp2 = await programar(request, headers, prod, 1700, manana)
    await cambiarPrecioAhora(page, prod, 1300)
    await page.getByRole('button', { name: /Guardar y mantener el programado/ }).click()
    await expect.poll(() => precio(request, headers, prod), { timeout: 10000 }).toBe(1300)
    expect(await estadoPP(request, headers, pp2), '[161] "Mantener" no tenía que tocar el programado').toBe('pendiente')

    await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: pp2 } })
    await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod}`, { headers, data: { activo: false } })
  })

  test('C-1 · pasada la hora el precio espera la etiqueta; al confirmarla en Repositores rige en el acto', async ({ page, request }) => {
    test.setTimeout(360_000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    await limpiarViejos(request, headers)
    const tid = await tenantId(request, headers)
    const [antes] = (await (await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}&select=precio_programado_requiere_repositor`, { headers })).json()) as any[]
    const modoOriginal = !!antes?.precio_programado_requiere_repositor

    const on = await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, { headers, data: { precio_programado_requiere_repositor: true } })
    expect(on.ok(), `[161] no se pudo prender el modo: ${await on.text()}`).toBe(true)
    let prod = ''
    try {
      prod = await crearProducto(request, headers, tid, `${PREFIJO} C1 ${Date.now()}`, 2000)
      await asignarGondolaNorte(request, headers, tid, prod)
      const hora = new Date(Date.now() + 70 * 1000)
      const pp = await programar(request, headers, prod, 2600, hora)

      // La etiqueta aparece (anticipación del negocio) ligada al programado.
      let tareaId = ''
      await expect.poll(async () => {
        const ts = (await (await request.get(`${SUPABASE_URL}/rest/v1/tareas_repositor?producto_id=eq.${prod}&precio_programado_id=eq.${pp}&estado=in.(pendiente,en_curso)&select=id`, { headers })).json()) as any[]
        tareaId = ts[0]?.id ?? ''
        return !!tareaId
      }, { timeout: 150_000, intervals: [5000], message: '[161] no apareció la etiqueta ligada al programado' }).toBe(true)

      // Anti-vacío: pasó la hora y un minuto entero de cron → el precio sigue siendo el viejo.
      const espera = hora.getTime() + 75_000 - Date.now()
      if (espera > 0) await page.waitForTimeout(espera)
      expect(await precio(request, headers, prod), '[161] C-1: el cron aplicó el precio sin esperar la etiqueta').toBe(2000)
      expect(await estadoPP(request, headers, pp)).toBe('pendiente')

      // Repositores lo explica y se confirma desde la pantalla.
      await page.evaluate(id => localStorage.setItem('sucursal-id', id), NORTE)
      await goto(page, `/repositores?tarea=${tareaId}`)
      await waitForApp(page)
      await expect(page.getByText(/empieza a regir cuando confirmes esta etiqueta/i).first()).toBeVisible({ timeout: 15000 })
      await page.getByTitle(/Confirmar la etiqueta: el precio nuevo empieza a regir ahora/).first().click()
      await expect(page.getByText(/empieza a regir ya en el POS/).first(), '[161] el diálogo tenía que avisar que el precio empieza a regir').toBeVisible({ timeout: 5000 })
      await page.getByRole('button', { name: /^Confirmar$/ }).click()

      // Rige en el acto (sin esperar al cron) y no se pide otra etiqueta.
      await expect.poll(() => precio(request, headers, prod), { timeout: 15000, message: '[161] al confirmar, el precio tenía que regir en el acto' }).toBe(2600)
      expect(await estadoPP(request, headers, pp)).toBe('aplicado')
      const abiertas = (await (await request.get(`${SUPABASE_URL}/rest/v1/tareas_repositor?producto_id=eq.${prod}&tipo=eq.cambio_precio&estado=in.(pendiente,en_curso)&select=id`, { headers })).json()) as any[]
      expect(abiertas, '[161] se volvió a pedir la etiqueta que ya se confirmó').toHaveLength(0)
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, { headers, data: { precio_programado_requiere_repositor: modoOriginal } })
      if (prod) await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod}`, { headers, data: { activo: false } })
    }
  })
})
