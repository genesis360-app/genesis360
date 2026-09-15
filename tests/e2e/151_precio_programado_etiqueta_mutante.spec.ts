/**
 * 151_precio_programado_etiqueta_mutante.spec.ts
 * E2E MUTANTE — precio de venta programado, Fases 2-3 (migs 423-424). Respuestas de GO al relevamiento (2026-09-14):
 *
 * A · C1/C2: con la góndola asignada, la tarea de cambiar la etiqueta aparece ANTES de la hora con el precio nuevo,
 *     no se completa mientras rija el precio viejo (servidor y pantalla) ni se destraba reescribiendo la tarea por
 *     REST; un cambio manual en el medio no le pisa la etiqueta, y cancelar el programado la desarma (las 2 ramas).
 *     Mutación: sin la 423 no aparece ninguna tarea antes de la hora.
 * B · C3: pasada la hora, la etiqueta sin hacer es "vencida" y aparece en Alertas; recién ahí se completa y la alerta
 *     se va. Mutación: sin la 423 la tarea no queda ligada al programado y Alertas no la muestra.
 * C · C3: el POS avisa al cajero cuando la etiqueta de un producto del carrito muestra otro precio.
 *     Mutación: sin el cambio de VentasPage el carrito no dice nada.
 * D · D2: un `sync_precio` de ML/TN que queda "failed" avisa al dueño; un `sync_stock` no.
 *     Mutación: sin la 424 no hay aviso.
 *
 * Corre con el DUEÑO (chromium) contra DEV, Almacén Jorgito, Sucursal Norte (tiene góndolas de exhibición).
 * Productos NUEVOS por test y sin vínculo con ML/TN: ningún precio sale a un canal real. Los jobs del test D se
 * crean en "processing" (los workers solo toman "pending") con un ítem inventado.
 */
import { test, expect, Page, APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, ingresoRealPorUI } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const PREFIJO = 'E2E EtiqProg'
type H = Record<string, string>
type Tarea = {
  id: string; estado: string; precio_anterior: number | string | null; precio_nuevo: number | string | null
  precio_programado_id: string | null; vigente_desde: string | null; motivo_cancelacion: string | null
}

async function crearProductoConPrecio(page: Page, request: APIRequestContext, headers: H, nombre: string, precio: number): Promise<string> {
  await goto(page, '/productos/nuevo')
  await waitForApp(page)
  const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
  await expect(nombreInput).toBeVisible({ timeout: 8000 })
  await nombreInput.fill(nombre)
  await page.getByRole('button', { name: /^Crear producto$/ }).click()
  await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
  const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombre)}&select=id`, { headers })
  const [prod] = (await res.json()) as Array<{ id: string }>
  expect(prod, `[151] no se encontró el producto "${nombre}" recién creado`).toBeTruthy()
  const patch = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
    headers, data: { precio_venta: precio, precio_costo: Math.round(precio / 2) },
  })
  expect(patch.ok(), `[151] no se pudo fijar el precio: ${await patch.text()}`).toBe(true)
  return prod.id
}

async function tenantId(request: APIRequestContext, headers: H): Promise<string> {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })
  const [suc] = (await res.json()) as Array<{ tenant_id: string }>
  expect(suc?.tenant_id, '[151] no se pudo resolver el negocio del usuario de prueba').toBeTruthy()
  return suc.tenant_id
}

/** Sin góndola asignada el módulo no genera ninguna tarea (por diseño). */
async function asignarGondolaNorte(request: APIRequestContext, headers: H, productoId: string): Promise<void> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/ubicaciones?select=id&tipo_logico=eq.exhibicion&sucursal_id=eq.${NORTE}&activo=eq.true&limit=1`,
    { headers },
  )
  const [gondola] = (await res.json()) as Array<{ id: string }>
  expect(gondola, '[151] Sucursal Norte no tiene ninguna góndola (ubicación de exhibición) activa').toBeTruthy()
  const alta = await request.post(`${SUPABASE_URL}/rest/v1/producto_ubicacion_sucursal?on_conflict=producto_id,sucursal_id`, {
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    data: { tenant_id: await tenantId(request, headers), producto_id: productoId, sucursal_id: NORTE, ubicacion_exhibicion_id: gondola.id },
  })
  expect(alta.ok(), `[151] no se pudo asignar la góndola: ${await alta.text()}`).toBe(true)
}

async function tareas(request: APIRequestContext, headers: H, productoId: string): Promise<Tarea[]> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/tareas_repositor?producto_id=eq.${productoId}` +
      '&select=id,estado,precio_anterior,precio_nuevo,precio_programado_id,vigente_desde,motivo_cancelacion&order=created_at.asc',
    { headers },
  )
  expect(res.ok(), `[151] no se pudo leer tareas_repositor: ${await res.text()}`).toBe(true)
  return (await res.json()) as Tarea[]
}

async function tarea(request: APIRequestContext, headers: H, productoId: string, id: string): Promise<Tarea> {
  const t = (await tareas(request, headers, productoId)).find(x => x.id === id)
  expect(t, `[151] desapareció la tarea ${id}`).toBeTruthy()
  return t!
}

async function esperarTareaDelProgramado(
  request: APIRequestContext, headers: H, productoId: string, ppId: string, timeout: number, message: string,
): Promise<Tarea> {
  let encontrada: Tarea | undefined
  await expect
    .poll(async () => {
      encontrada = (await tareas(request, headers, productoId)).find(t => t.precio_programado_id === ppId)
      return !!encontrada
    }, { timeout, intervals: [5000], message })
    .toBe(true)
  return encontrada!
}

async function rpcProgramar(request: APIRequestContext, headers: H, productoId: string, precio: number, vigenteDesde: Date): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_programar_precio`, {
    headers, data: { p_producto_id: productoId, p_precio_venta: precio, p_vigente_desde: vigenteDesde.toISOString() },
  })
  expect(res.ok(), `[151] no se pudo programar: ${await res.text()}`).toBe(true)
  return (await res.json()) as string
}

async function leerPrecio(request: APIRequestContext, headers: H, id: string): Promise<number> {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=precio_venta`, { headers })
  const [p] = (await res.json()) as Array<{ precio_venta: number | string }>
  return Number(p.precio_venta)
}

async function cancelarTarea(request: APIRequestContext, headers: H, id: string): Promise<void> {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/tareas_repositor?id=eq.${id}`, {
    headers, data: { estado: 'cancelada', cancelled_at: new Date().toISOString(), motivo_cancelacion: 'E2E 151 — limpieza' },
  })
  expect(res.ok(), `[151] no se pudo cancelar la tarea ${id} al limpiar: ${await res.text()}`).toBe(true)
}

/**
 * Lo que dejó una corrida anterior interrumpida: un programado pendiente que el cron aplicaría después y etiquetas
 * abiertas que taparían la alerta o el aviso de la corrida actual. Solo productos de este spec (prefijo).
 */
async function limpiarEtiquetasDePrueba(request: APIRequestContext, headers: H): Promise<void> {
  const pps = await request.get(
    `${SUPABASE_URL}/rest/v1/precios_programados?select=id,productos!inner(nombre)&estado=eq.pendiente` +
      `&productos.nombre=like.${encodeURIComponent(PREFIJO)}*`,
    { headers },
  )
  expect(pps.ok(), `[151] no se pudieron buscar programados de prueba viejos: ${await pps.text()}`).toBe(true)
  for (const pp of (await pps.json()) as Array<{ id: string }>) {
    const cancel = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: pp.id } })
    expect(cancel.ok(), `[151] no se pudo cancelar el programado de prueba ${pp.id}: ${await cancel.text()}`).toBe(true)
  }
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/tareas_repositor?select=id,productos!inner(nombre)&estado=in.(pendiente,en_curso)` +
      `&productos.nombre=like.${encodeURIComponent(PREFIJO)}*`,
    { headers },
  )
  expect(res.ok(), `[151] no se pudieron buscar etiquetas de prueba viejas: ${await res.text()}`).toBe(true)
  for (const t of (await res.json()) as Array<{ id: string }>) await cancelarTarea(request, headers, t.id)
}

test.describe('Precio programado — la etiqueta de la góndola y el aviso de ML/TN (migs 423-424, mutante)', () => {
  test('A · la etiqueta aparece antes de la hora, no se completa antes y cancelar el programado la desarma', async ({ page, request }) => {
    test.setTimeout(300000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    await limpiarEtiquetasDePrueba(request, headers)

    const tenRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=repositor_anticipacion_min&limit=1`, { headers })
    expect(tenRes.ok(), `[151A] no se pudo leer la anticipación del negocio (¿falta la mig 423?): ${await tenRes.text()}`).toBe(true)
    const [ten] = (await tenRes.json()) as Array<{ repositor_anticipacion_min: number }>
    expect(ten.repositor_anticipacion_min, '[151A] la prueba necesita una anticipación de al menos 10 minutos en Almacén Jorgito').toBeGreaterThanOrEqual(10)

    const productoId = await crearProductoConPrecio(page, request, headers, `${PREFIJO} A ${Date.now()}`, 1000)
    await asignarGondolaNorte(request, headers, productoId)

    // 8 minutos: dentro de la anticipación y lejos de que el cron lo aplique mientras corre la prueba.
    const vigencia = new Date(Date.now() + 8 * 60 * 1000)
    const ppId = await rpcProgramar(request, headers, productoId, 1250, vigencia)

    const t = await esperarTareaDelProgramado(request, headers, productoId, ppId, 110000,
      '[151A] la tarea de cambiar la etiqueta tenía que aparecer ANTES de la hora (el cron corre cada minuto)')
    expect(t.estado).toBe('pendiente')
    expect(Number(t.precio_anterior), '[151A] la etiqueta vieja es la del precio que rige hoy').toBe(1000)
    expect(Number(t.precio_nuevo), '[151A] la etiqueta a imprimir es la del precio programado (C2)').toBe(1250)
    expect(Math.abs(new Date(t.vigente_desde!).getTime() - vigencia.getTime())).toBeLessThan(1000)
    expect(await leerPrecio(request, headers, productoId), '[151A] antes de la hora sigue rigiendo el precio viejo').toBe(1000)

    // Servidor: no se da por puesta antes de la hora…
    const completar = await request.patch(`${SUPABASE_URL}/rest/v1/tareas_repositor?id=eq.${t.id}`, {
      headers, data: { estado: 'completada', completed_at: new Date().toISOString() },
    })
    expect(completar.ok(), '[151A] completar la etiqueta antes de la hora tenía que fallar en el servidor').toBe(false)
    expect(await completar.text()).toMatch(/Todavía no/)
    // …ni se destraba desligando la tarea por REST.
    const desligar = await request.patch(`${SUPABASE_URL}/rest/v1/tareas_repositor?id=eq.${t.id}`, {
      headers, data: { precio_programado_id: null, vigente_desde: null },
    })
    expect(desligar.ok(), '[151A] un usuario no tenía que poder reescribir precio_programado_id por REST').toBe(false)

    // Pantalla: la tarea dice desde cuándo rige y "Completar" está deshabilitado.
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, `/repositores?tarea=${t.id}`)
    await waitForApp(page)
    const card = page.locator(`[data-tarea-repositor="${t.id}"]`)
    await expect(card, '[151A] la tarea anticipada tenía que verse en Repositores').toBeVisible({ timeout: 10000 })
    await expect(card.getByText(/Rige desde/)).toBeVisible()
    await expect(card.getByTitle(/Se completa cuando rija el precio nuevo/)).toBeDisabled()

    // Un cambio manual antes de la hora no le pisa la etiqueta al programado.
    const manual = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${productoId}`, { headers, data: { precio_venta: 1100 } })
    expect(manual.ok(), `[151A] no se pudo cambiar el precio a mano: ${await manual.text()}`).toBe(true)
    const trasManual = await tarea(request, headers, productoId, t.id)
    expect(Number(trasManual.precio_nuevo), '[151A] la etiqueta a poner a la hora sigue siendo la del programado').toBe(1250)
    expect(trasManual.precio_programado_id).toBe(ppId)

    // Cancelar con la góndola desactualizada ($1000 impreso, rige $1100): la tarea sigue, pidiendo la del vigente.
    const cancel = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: ppId } })
    expect(cancel.ok(), `[151A] no se pudo cancelar el programado: ${await cancel.text()}`).toBe(true)
    const desarmada = await tarea(request, headers, productoId, t.id)
    expect(desarmada.estado, '[151A] la góndola sigue mal: la tarea no se tenía que cancelar').toBe('pendiente')
    expect(Number(desarmada.precio_nuevo), '[151A] ahora tiene que pedir la etiqueta del precio vigente').toBe(1100)
    expect(desarmada.precio_programado_id).toBeNull()
    await cancelarTarea(request, headers, t.id)

    // Cancelar con la góndola al día ($1100 impreso y vigente): la tarea anticipada se cancela sola.
    const ppId2 = await rpcProgramar(request, headers, productoId, 1300, new Date(Date.now() + 8 * 60 * 1000))
    const t2 = await esperarTareaDelProgramado(request, headers, productoId, ppId2, 110000,
      '[151A] la segunda tarea anticipada tenía que aparecer')
    const cancel2 = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_cancelar_precio_programado`, { headers, data: { p_id: ppId2 } })
    expect(cancel2.ok(), `[151A] no se pudo cancelar el segundo programado: ${await cancel2.text()}`).toBe(true)
    const cancelada = await tarea(request, headers, productoId, t2.id)
    expect(cancelada.estado, '[151A] con la góndola al día, cancelar el programado cancela su etiqueta').toBe('cancelada')
    expect(cancelada.motivo_cancelacion).toMatch(/Se canceló el cambio de precio programado/)
  })

  test('B · pasada la hora la etiqueta sin hacer queda vencida en Alertas y recién ahí se completa', async ({ page, request }) => {
    test.setTimeout(300000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    await limpiarEtiquetasDePrueba(request, headers)

    const productoId = await crearProductoConPrecio(page, request, headers, `${PREFIJO} B ${Date.now()}`, 2000)
    await asignarGondolaNorte(request, headers, productoId)
    const ppId = await rpcProgramar(request, headers, productoId, 2600, new Date(Date.now() + 75 * 1000))

    await expect
      .poll(async () => leerPrecio(request, headers, productoId), {
        timeout: 200000, intervals: [5000],
        message: '[151B] pasada la hora, el servidor tenía que aplicar el precio programado',
      })
      .toBe(2600)
    const t = await esperarTareaDelProgramado(request, headers, productoId, ppId, 30000,
      '[151B] al aplicarse, la etiqueta sin hacer tenía que quedar ligada al programado')
    expect(t.estado).toBe('pendiente')
    expect(Number(t.precio_nuevo)).toBe(2600)

    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/alertas')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Alertas/ }).first()).toBeVisible({ timeout: 10000 })
    const alerta = page.locator(`[data-etiqueta-vencida="${t.id}"]`)
    await expect(alerta, '[151B] la etiqueta vencida tenía que aparecer en Alertas').toBeVisible({ timeout: 15000 })
    await expect(alerta.getByRole('link', { name: /Ver tarea/ })).toHaveAttribute('href', `/repositores?tarea=${t.id}`)

    // Ya rige: ahora sí se completa…
    const completar = await request.patch(`${SUPABASE_URL}/rest/v1/tareas_repositor?id=eq.${t.id}`, {
      headers, data: { estado: 'completada', completed_at: new Date().toISOString() },
    })
    expect(completar.ok(), `[151B] con el precio vigente la etiqueta se tenía que poder completar: ${await completar.text()}`).toBe(true)

    // …y la alerta se va.
    await goto(page, '/alertas')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Alertas/ }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator(`[data-etiqueta-vencida="${t.id}"]`)).toHaveCount(0)
  })

  test('C · el POS avisa cuando la etiqueta de la góndola muestra otro precio', async ({ page, request }) => {
    test.setTimeout(180000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    await limpiarEtiquetasDePrueba(request, headers)
    const nombre = `${PREFIJO} C ${Date.now()}`

    const productoId = await crearProductoConPrecio(page, request, headers, nombre, 500)
    await asignarGondolaNorte(request, headers, productoId)
    await ingresoRealPorUI(page, { nombreProducto: nombre, cantidad: 3, estadoNombre: 'Disponible', ubicacionNombre: 'RACK2' })

    // Cambio de precio común: la góndola sigue diciendo $500 hasta que el repositor cambie la etiqueta.
    const cambio = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${productoId}`, { headers, data: { precio_venta: 650 } })
    expect(cambio.ok(), `[151C] no se pudo cambiar el precio: ${await cambio.text()}`).toBe(true)
    const t = (await tareas(request, headers, productoId)).find(x => x.estado === 'pendiente')
    expect(t, '[151C] el cambio de precio con góndola asignada tenía que generar la tarea del repositor').toBeTruthy()

    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(nombre)
    const filaProd = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: nombre }).first()
    await expect(filaProd, `[151C] "${nombre}" no apareció en el buscador del POS`).toBeVisible({ timeout: 10000 })
    await filaProd.click()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    const aviso = page.locator('[data-etiqueta-desactualizada]')
    await expect(aviso, '[151C] el carrito tenía que avisar que la etiqueta de la góndola está desactualizada').toBeVisible({ timeout: 15000 })
    await expect(aviso).toContainText('$500')

    // Limpieza: el carrito se guarda como borrador y se restauraría en otros specs.
    await page.getByTitle('Quitar producto del carrito').first().click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 5000 })
    await cancelarTarea(request, headers, t!.id)
  })

  test('D · si Mercado Libre no toma el precio nuevo se avisa al dueño (y un sync de stock no)', async ({ page, request }) => {
    test.setTimeout(90000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string
    const tid = await tenantId(request, headers)

    const prodRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?select=id,nombre&limit=1`, { headers })
    const [prod] = (await prodRes.json()) as Array<{ id: string; nombre: string }>
    expect(prod, '[151D] el negocio de prueba no tiene productos').toBeTruthy()

    const crearJobFallido = async (tipo: 'sync_precio' | 'sync_stock'): Promise<string> => {
      const alta = await request.post(`${SUPABASE_URL}/rest/v1/integration_job_queue`, {
        headers,
        data: {
          tenant_id: tid, integracion: 'MercadoLibre', tipo, status: 'processing',
          payload: { producto_id: prod.id, meli_item_id: 'MLA-E2E-151-INEXISTENTE' },
        },
      })
      expect(alta.ok(), `[151D] no se pudo crear el job ${tipo}: ${await alta.text()}`).toBe(true)
      const [job] = (await alta.json()) as Array<{ id: string }>
      const falla = await request.patch(`${SUPABASE_URL}/rest/v1/integration_job_queue?id=eq.${job.id}`, {
        headers, data: { status: 'failed', retries: 5, error_last: 'E2E 151: la API no respondió' },
      })
      expect(falla.ok(), `[151D] no se pudo marcar el job como fallido: ${await falla.text()}`).toBe(true)
      return job.id
    }
    const avisosDe = async (jobId: string) => {
      const res = await request.get(
        `${SUPABASE_URL}/rest/v1/notificaciones?user_id=eq.${userId}&metadata->>ultimo_job_id=eq.${jobId}` +
          '&select=id,titulo,mensaje,tipo,action_url',
        { headers },
      )
      expect(res.ok(), `[151D] no se pudieron leer las notificaciones: ${await res.text()}`).toBe(true)
      return (await res.json()) as Array<{ id: string; titulo: string; mensaje: string; tipo: string; action_url: string }>
    }

    const jobStock = await crearJobFallido('sync_stock')
    const jobPrecio = await crearJobFallido('sync_precio')

    const avisoPrecio = await avisosDe(jobPrecio)
    expect(avisoPrecio, '[151D] un precio que no se pudo publicar tenía que avisarle al dueño').toHaveLength(1)
    expect(avisoPrecio[0].titulo).toMatch(/No se pudo actualizar un precio en Mercado Libre/)
    expect(avisoPrecio[0].tipo).toBe('danger')
    expect(avisoPrecio[0].action_url).toBe('/configuracion?tab=conectividad')
    expect(await avisosDe(jobStock), '[151D] un sync de stock fallido no es un aviso de precio').toHaveLength(0)

    // Limpieza. Ojo: el aviso también les llega a los otros DUEÑO/SUPER_USUARIO del negocio y la RLS no deja borrar
    // los suyos desde acá (queda uno por corrida, con `ultimo_error` = "E2E 151: …").
    await request.delete(`${SUPABASE_URL}/rest/v1/notificaciones?id=eq.${avisoPrecio[0].id}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/integration_job_queue?id=in.(${jobStock},${jobPrecio})`, { headers })
  })
})
