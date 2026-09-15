/**
 * 150_precio_programado_mutante.spec.ts
 * E2E MUTANTE — precio de venta con fecha/hora de vigencia, Fase 1 (mig 422, relevamiento de Fede respondido
 * por GO el 2026-09-14).
 *
 * A · Desde la ficha: cambiar el precio y elegir "Programar" NO cambia el precio que rige hoy y deja el cambio
 *     pendiente. Mutación: sin el modal, "Guardar cambios" aplicaba el precio nuevo en el acto.
 * B · El servidor lo aplica solo (pg_cron cada minuto): pasada la hora, `productos.precio_venta` cambia, el
 *     programado queda "aplicado" con el precio anterior y el historial lo registra.
 * C · Desde Productos → Programados se cancela un cambio pendiente.
 * D · Guards del servidor: no se puede escribir la tabla directo por REST, no se programa al pasado y un CAJERO
 *     no puede programar.
 *
 * Productos NUEVOS en cada test (nombre con timestamp): no están vinculados a ML/TN, así que el cambio de
 * precio no se publica en ningún canal real. Corre con el DUEÑO (chromium) contra DEV.
 */
import { test, expect, Page, APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, loginToken, SUPABASE_URL } from './helpers/fixtures'

async function crearProductoConPrecio(
  page: Page, request: APIRequestContext, headers: Record<string, string>, nombre: string, precio: number,
): Promise<string> {
  await goto(page, '/productos/nuevo')
  await waitForApp(page)
  const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
  await expect(nombreInput).toBeVisible({ timeout: 8000 })
  await nombreInput.fill(nombre)
  await page.getByRole('button', { name: /^Crear producto$/ }).click()
  await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
  const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombre)}&select=id`, { headers })
  const [prod] = (await res.json()) as Array<{ id: string }>
  expect(prod, `[150] no se encontró el producto "${nombre}" recién creado`).toBeTruthy()
  const patch = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
    headers, data: { precio_venta: precio },
  })
  expect(patch.ok(), `[150] no se pudo fijar el precio: ${await patch.text()}`).toBe(true)
  return prod.id
}

async function leerProducto(request: APIRequestContext, headers: Record<string, string>, id: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=precio_venta`, { headers })
  const [p] = (await res.json()) as Array<{ precio_venta: number | string }>
  return Number(p.precio_venta)
}

async function programados(request: APIRequestContext, headers: Record<string, string>, productoId: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/precios_programados?producto_id=eq.${productoId}` +
      '&select=id,estado,precio_venta,precio_anterior,vigente_desde,aplicado_at,cancelado_at,cancelado_por&order=created_at.asc',
    { headers },
  )
  expect(res.ok(), `[150] no se pudo leer precios_programados: ${await res.text()}`).toBe(true)
  return (await res.json()) as Array<{
    id: string; estado: string; precio_venta: number | string; precio_anterior: number | string | null
    vigente_desde: string; aplicado_at: string | null; cancelado_at: string | null; cancelado_por: string | null
  }>
}

async function rpcProgramar(request: APIRequestContext, headers: Record<string, string>, productoId: string, precio: number, vigenteDesde: Date) {
  return request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_programar_precio`, {
    headers,
    data: { p_producto_id: productoId, p_precio_venta: precio, p_vigente_desde: vigenteDesde.toISOString() },
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

test.describe('Precio de venta programado (mig 422, mutante)', () => {
  test('A · desde la ficha: programar no cambia el precio que rige y deja el cambio pendiente', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const productoId = await crearProductoConPrecio(page, request, headers, `E2E PrecioProg A ${Date.now()}`, 1000)

    await goto(page, `/productos/${productoId}/editar`)
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Editar producto/i })).toBeVisible({ timeout: 8000 })

    const precioInput = page.locator("xpath=//label[starts-with(normalize-space(.), 'Precio de venta')]/ancestor::div[2]//input[@type='number']").first()
    await expect(precioInput).toBeVisible({ timeout: 8000 })
    await precioInput.fill('1250')
    await page.getByRole('button', { name: /^Guardar cambios$/ }).click()

    const modal = page.getByRole('dialog', { name: /¿Desde cuándo rige el nuevo precio\?/ })
    await expect(modal, '[150A] al cambiar el precio de venta tenía que preguntar desde cuándo rige').toBeVisible({ timeout: 8000 })
    await modal.getByText('Programar fecha y hora').click()

    const vigencia = new Date(Date.now() + 10 * 60 * 1000)
    const fecha = `${vigencia.getFullYear()}-${pad(vigencia.getMonth() + 1)}-${pad(vigencia.getDate())}`
    const hora = `${pad(vigencia.getHours())}:${pad(vigencia.getMinutes())}`
    await modal.getByLabel('Fecha de vigencia').fill(fecha)
    await modal.getByLabel('Hora de vigencia').fill(hora)
    await modal.getByRole('button', { name: /Guardar y programar/ }).click()
    await expect(page.getByText(/Precio de venta programado/i)).toBeVisible({ timeout: 10000 })

    expect(await leerProducto(request, headers, productoId), '[150A] el precio que rige hoy NO tenía que cambiar').toBe(1000)
    const pps = await programados(request, headers, productoId)
    const pendiente = pps.filter(p => p.estado === 'pendiente')
    expect(pendiente, `[150A] tenía que quedar UN cambio pendiente. Filas: ${JSON.stringify(pps)}`).toHaveLength(1)
    expect(Number(pendiente[0].precio_venta)).toBe(1250)
    const diffMs = Math.abs(new Date(pendiente[0].vigente_desde).getTime() - new Date(`${fecha}T${hora}:00`).getTime())
    expect(diffMs, '[150A] la vigencia guardada tenía que ser la elegida en la pantalla').toBeLessThan(1000)

    // Limpieza: que el cron no lo aplique después.
    const cancel = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: pendiente[0].id } })
    expect(cancel.ok(), `[150A] no se pudo cancelar al limpiar: ${await cancel.text()}`).toBe(true)
  })

  test('B · el servidor lo aplica solo pasada la hora y lo deja en el historial', async ({ page, request }) => {
    test.setTimeout(300000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const productoId = await crearProductoConPrecio(page, request, headers, `E2E PrecioProg B ${Date.now()}`, 2000)

    const prog = await rpcProgramar(request, headers, productoId, 2600, new Date(Date.now() + 70 * 1000))
    expect(prog.ok(), `[150B] no se pudo programar: ${await prog.text()}`).toBe(true)
    expect(await leerProducto(request, headers, productoId), '[150B] antes de la hora rige el precio viejo').toBe(2000)

    // pg_cron corre cada minuto: la hora + hasta un minuto de cron + margen.
    await expect
      .poll(async () => leerProducto(request, headers, productoId), {
        timeout: 200000, intervals: [5000],
        message: '[150B] pasada la hora, el servidor tenía que aplicar el precio programado',
      })
      .toBe(2600)

    const [pp] = await programados(request, headers, productoId)
    expect(pp.estado).toBe('aplicado')
    expect(Number(pp.precio_anterior), '[150B] tenía que guardar el precio que regía al aplicarse').toBe(2000)
    expect(pp.aplicado_at).toBeTruthy()

    const logRes = await request.get(
      `${SUPABASE_URL}/rest/v1/actividad_log?producto_id=eq.${productoId}&select=accion,campo,valor_anterior,valor_nuevo`,
      { headers },
    )
    const log = (await logRes.json()) as Array<{ accion: string; campo: string | null; valor_anterior: string | null; valor_nuevo: string | null }>
    expect(log.some(l => l.accion === 'programar_precio'), `[150B] faltó el registro de quién lo programó. Log: ${JSON.stringify(log)}`).toBe(true)
    const aplicado = log.find(l => l.accion === 'editar' && l.campo === 'precio de venta (programado)')
    expect(aplicado, `[150B] faltó el registro de la aplicación. Log: ${JSON.stringify(log)}`).toBeTruthy()
    expect(Number(aplicado!.valor_anterior)).toBe(2000)
    expect(Number(aplicado!.valor_nuevo)).toBe(2600)
  })

  test('C · desde Productos → Programados se cancela un cambio pendiente', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const productoId = await crearProductoConPrecio(page, request, headers, `E2E PrecioProg C ${Date.now()}`, 3000)
    const prog = await rpcProgramar(request, headers, productoId, 3500, new Date(Date.now() + 24 * 3600 * 1000))
    expect(prog.ok(), `[150C] no se pudo programar: ${await prog.text()}`).toBe(true)
    const [pp] = await programados(request, headers, productoId)

    await goto(page, '/productos?tab=programados')
    await waitForApp(page)
    const fila = page.locator(`tr[data-precio-programado="${pp.id}"]`)
    await expect(fila, '[150C] el cambio pendiente tenía que aparecer en Programados').toBeVisible({ timeout: 10000 })
    await fila.getByRole('button', { name: /^Cancelar$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^(Confirmar|Sí|Aceptar|Cancelar cambio)/i }).click()
    await expect(page.getByText(/Cambio de precio cancelado/i)).toBeVisible({ timeout: 10000 })

    const [tras] = await programados(request, headers, productoId)
    expect(tras.estado).toBe('cancelado')
    expect(tras.cancelado_at).toBeTruthy()
    expect(tras.cancelado_por).toBeTruthy()
    expect(await leerProducto(request, headers, productoId), '[150C] cancelar no toca el precio vigente').toBe(3000)
  })

  test('D · guards del servidor: sin escritura directa, sin fechas pasadas y sin CAJERO', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const productoId = await crearProductoConPrecio(page, request, headers, `E2E PrecioProg D ${Date.now()}`, 4000)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ tenant_id: string }>

    // 1) INSERT directo por PostgREST, con el DUEÑO: rechazado (solo se escribe por la función).
    const directo = await request.post(`${SUPABASE_URL}/rest/v1/precios_programados`, {
      headers,
      data: { tenant_id: suc.tenant_id, producto_id: productoId, precio_venta: 1, vigente_desde: new Date(Date.now() + 3600 * 1000).toISOString() },
    })
    expect(directo.ok(), '[150D] la tabla no se tenía que poder escribir directo por REST').toBe(false)

    // 2) Fecha pasada: rechazada con un mensaje entendible.
    const pasado = await rpcProgramar(request, headers, productoId, 4100, new Date(Date.now() - 60 * 1000))
    expect(pasado.ok(), '[150D] programar al pasado tenía que fallar').toBe(false)
    expect(await pasado.text()).toMatch(/futuras/)

    // 3) CAJERO: no puede cambiar precios, tampoco programarlos.
    test.skip(!process.env.E2E_CAJERO_EMAIL, 'sin credenciales de CAJERO en tests/e2e/.env.test.local')
    const tokenCajero = await loginToken(request, process.env.E2E_CAJERO_EMAIL, process.env.E2E_CAJERO_PASSWORD)
    const cajero = await rpcProgramar(request, restHeaders(tokenCajero), productoId, 4200, new Date(Date.now() + 3600 * 1000))
    expect(cajero.ok(), '[150D] un CAJERO no tenía que poder programar un precio').toBe(false)
    expect(await cajero.text()).toMatch(/No autorizado/)

    expect(await programados(request, headers, productoId), '[150D] ningún intento tenía que dejar filas').toHaveLength(0)
  })
})
