/**
 * 121_aprobacion_estado_resolver_mutante.spec.ts
 * E2E MUTANTE — APROB-05, 06, 07: ciclo de vida completo de una autorización `cambio_estado`
 * ya pendiente (Fase B, backlog Comercial de Fede) — resolverla desde la tab Autorizaciones.
 *
 * Corre bajo el proyecto `chromium` default (sesión DUEÑO) — a diferencia del spec 117 (que
 * necesita un ACTOR SUJETO al gate para GENERAR la solicitud, por eso corre bajo
 * `chromium-deposito`), acá el actor relevante es quien la RESUELVE: `puedeVerAutorizaciones`
 * (InventarioPage.tsx) y el RPC `aprobar_cambio_estado_inventario` (mig 333) exigen
 * DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN — la sesión DUEÑO de `chromium` ya cumple ese requisito,
 * sin tocar `playwright.config.ts`.
 *
 * La precondición (la solicitud YA PENDIENTE) se siembra directo por REST reproduciendo
 * exactamente lo que deja `LpnAccionesModal`/`bulkCambiarEstado` al crearla — foto real subida
 * al bucket privado `autorizaciones-fotos` + fila en `autorizaciones` con
 * `datos_cambio`/`estado='pendiente'`. La RLS de esa tabla es tenant-only (mig 056): no exige el
 * rol sujeto al gate para el INSERT, así que no hace falta re-ejercitar el flujo completo de
 * creación (ya cubierto por el spec 117) solo para poder probar la resolución.
 *
 * APROB-05: single — recién al aprobar cambia `estado_id`, y "Ver foto" resuelve una URL firmada
 *   REAL (5 min) del bucket privado, no un link muerto.
 * APROB-06: batch — al aprobar, TODOS los `linea_ids` del lote quedan con el `estado_id` nuevo
 *   (se verifica la CANTIDAD de filas actualizadas, no solo la primera — regresión del bypass
 *   masivo que esta misma fase cerró).
 * APROB-07: rechazo (motivo obligatorio) — ningún LPN cambia de estado, la autorización queda
 *   `rechazada` con el motivo.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

// PNG 1x1 válido — foto de evidencia real, no un placeholder inerte.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** El `sub` del JWT es el `users.id` del actor logueado — evita adivinar la fila propia en `users`. */
function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

interface Ctx { headers: Record<string, string>; token: string; tenantId: string; userId: string }

async function ctxAprobador(page: any, request: any): Promise<Ctx> {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const userId = decodeJwtSub(token)
  const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id,rol`, { headers })
  const [me] = (await meRes.json()) as Array<{ tenant_id: string; rol: string }>
  expect(me, '[121] no se pudo resolver el usuario logueado').toBeTruthy()
  expect(
    ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'ADMIN'],
    '[121] este spec resuelve autorizaciones — necesita un rol que pueda aprobar (puedeVerAutorizaciones + RPC aprobar_cambio_estado_inventario)',
  ).toContain(me.rol)
  return { headers, token, tenantId: me.tenant_id, userId }
}

async function crearEstadoConAprobacion(request: any, c: Ctx, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, requiere_aprobacion: true, es_disponible_venta: false },
  })
  expect(res.ok(), `[121] no se pudo crear el estado: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearProducto(request: any, c: Ctx, nombre: string, sku: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, sku, precio_costo: 60, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
  })
  expect(res.ok(), `[121] no se pudo crear el producto: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearLinea(request: any, c: Ctx, productoId: string, lpn: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
    headers: c.headers, data: { tenant_id: c.tenantId, producto_id: productoId, lpn, cantidad: 10, activo: true },
  })
  expect(res.ok(), `[121] no se pudo crear el LPN: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

/** Sube una foto REAL al bucket privado (mismo endpoint que usa `supabase-js` internamente para
 *  `storage.from(bucket).upload(path, file)`: POST con el body binario crudo, sin multipart). */
async function subirFotoEvidencia(request: any, c: Ctx, path: string) {
  const res = await request.post(`${SUPABASE_URL}/storage/v1/object/autorizaciones-fotos/${path}`, {
    headers: { Authorization: c.headers.Authorization, apikey: c.headers.apikey, 'Content-Type': 'image/png' },
    data: PNG_1x1,
  })
  expect(res.ok(), `[121] no se pudo subir la foto de evidencia real al bucket: ${await res.text()}`).toBe(true)
}

/** Crea la fila PENDIENTE de `autorizaciones` — misma forma que deja la UI real
 *  (LpnAccionesModal single / InventarioPage bulk). */
async function crearAutorizacionPendiente(
  request: any, c: Ctx,
  opts: { lineaId?: string; lineaIds?: string[]; estadoAnteriorId: string | null; estadoNuevoId: string; fotoPath: string },
) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/autorizaciones`, {
    headers: c.headers,
    data: {
      tenant_id: c.tenantId,
      modulo: 'inventario',
      tipo: 'cambio_estado',
      linea_id: opts.lineaId ?? null,
      datos_cambio: {
        ...(opts.lineaIds ? { linea_ids: opts.lineaIds } : {}),
        estado_anterior_id: opts.estadoAnteriorId,
        estado_nuevo_id: opts.estadoNuevoId,
        foto_path: opts.fotoPath,
      },
      estado: 'pendiente',
      solicitado_por: c.userId,
    },
  })
  expect(res.ok(), `[121] no se pudo crear la autorización pendiente: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function irATabAutorizaciones(page: any) {
  await goto(page, '/inventario')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Autorizaciones' }).click()
  await expect(page.getByRole('button', { name: 'Pendientes' })).toBeVisible({ timeout: 8000 })
}

/** Localiza la tarjeta de la autorización por el nombre (único, con timestamp) del estado destino. */
function cardPorEstado(page: any, nombreEstadoNuevo: string) {
  return page.locator('div.bg-white.rounded-xl.shadow-sm.border-gray-100').filter({ hasText: nombreEstadoNuevo })
}

test.describe('Resolver autorizaciones de cambio de estado — ciclo de vida completo (mutante)', () => {
  test('single: aprobar recién ahí cambia estado_id + "Ver foto" resuelve URL firmada real (APROB-05)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctxAprobador(page, request)
    const nombreEstado = `E2E Aprob121 Estado ${ts}`
    const producto = await crearProducto(request, c, `E2E Aprob121 Prod ${ts}`, `E2E-SKU121-${ts}`)
    const linea = await crearLinea(request, c, producto.id, `E2E-LPN121-${ts}`)
    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)
    const estadoIdOriginal: string | null = linea.estado_id ?? null

    const fotoPath = `${c.tenantId}/${linea.id}-${ts}.png`
    await subirFotoEvidencia(request, c, fotoPath)
    const aut = await crearAutorizacionPendiente(request, c, {
      lineaId: linea.id, estadoAnteriorId: estadoIdOriginal, estadoNuevoId: estado.id, fotoPath,
    })

    await irATabAutorizaciones(page)
    const card = cardPorEstado(page, nombreEstado)
    await expect(card).toBeVisible({ timeout: 8000 })

    // "Ver foto" resuelve una URL FIRMADA real del bucket privado (createSignedUrl), no un link muerto
    const popupPromise = page.waitForEvent('popup')
    await card.getByRole('button', { name: 'Ver foto' }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    expect(popup.url(), '[121] "Ver foto" debe abrir una URL firmada del bucket autorizaciones-fotos').toContain('/storage/v1/object/sign/autorizaciones-fotos/')
    const fotoRes = await request.get(popup.url())
    expect(fotoRes.ok(), `[121] la URL firmada no resolvió la foto real: ${await fotoRes.text()}`).toBe(true)
    await popup.close()

    // POSITIVO: mientras sigue pendiente, estado_id NO cambió todavía
    const antesRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: c.headers })
    const [antes] = (await antesRes.json()) as Array<{ estado_id: string | null }>
    expect(antes.estado_id, '[121] antes de aprobar, estado_id debe seguir siendo el viejo').toBe(estadoIdOriginal)

    await card.getByRole('button', { name: 'Aprobar' }).click()
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await confirmDialog.getByRole('button', { name: 'Confirmar' }).click()
    await expect(page.getByText(/Autorización aprobada y ejecutada/i)).toBeVisible({ timeout: 12000 })

    // POSITIVO en DB: recién ACÁ estado_id cambió (vía el RPC aprobar_cambio_estado_inventario)
    const despuesRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: c.headers })
    const [despues] = (await despuesRes.json()) as Array<{ estado_id: string | null }>
    expect(despues.estado_id, '🛑 [121] APROB-05: al aprobar, estado_id debe pasar al nuevo estado').toBe(estado.id)

    const autPostRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${aut.id}&select=estado,aprobado_por`, { headers: c.headers })
    const [autPost] = (await autPostRes.json()) as Array<{ estado: string; aprobado_por: string | null }>
    expect(autPost.estado, '[121] la autorización debe quedar aprobada').toBe('aprobada')
    expect(autPost.aprobado_por, '[121] aprobado_por debe registrar quién aprobó').toBe(c.userId)
  })

  test('batch: aprobar actualiza TODOS los linea_ids del lote, no solo el primero (APROB-06)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctxAprobador(page, request)
    const nombreEstado = `E2E Aprob121B Estado ${ts}`
    const producto = await crearProducto(request, c, `E2E Aprob121B Prod ${ts}`, `E2E-SKU121B-${ts}`)
    const lineaA = await crearLinea(request, c, producto.id, `E2E-121B-A-${ts}`)
    const lineaB = await crearLinea(request, c, producto.id, `E2E-121B-B-${ts}`)
    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)

    const fotoPath = `${c.tenantId}/bulk-${ts}.png`
    await subirFotoEvidencia(request, c, fotoPath)
    await crearAutorizacionPendiente(request, c, {
      lineaIds: [lineaA.id, lineaB.id], estadoAnteriorId: null, estadoNuevoId: estado.id, fotoPath,
    })

    await irATabAutorizaciones(page)
    const card = cardPorEstado(page, nombreEstado)
    await expect(card).toBeVisible({ timeout: 8000 })
    await expect(card.getByText(/2\s+LPN\(s\)/)).toBeVisible()

    await card.getByRole('button', { name: 'Aprobar' }).click()
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await confirmDialog.getByRole('button', { name: 'Confirmar' }).click()
    await expect(page.getByText(/Autorización aprobada y ejecutada/i)).toBeVisible({ timeout: 12000 })

    // 🛑 POSITIVO en DB: AMBOS LPN quedaron con el estado nuevo — no solo el primero del lote
    const postRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=in.(${lineaA.id},${lineaB.id})&select=id,estado_id`, { headers: c.headers })
    const post = (await postRes.json()) as Array<{ id: string; estado_id: string | null }>
    expect(post, '[121] deben existir las 2 líneas').toHaveLength(2)
    const actualizadas = post.filter(l => l.estado_id === estado.id)
    expect(actualizadas.length, '🛑 [121] APROB-06: TODOS los linea_ids del lote deben quedar con el estado nuevo, no solo el primero').toBe(2)
  })

  test('rechazar (motivo obligatorio): ningún LPN cambia, la autorización queda rechazada (APROB-07)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctxAprobador(page, request)
    const nombreEstado = `E2E Aprob121C Estado ${ts}`
    const producto = await crearProducto(request, c, `E2E Aprob121C Prod ${ts}`, `E2E-SKU121C-${ts}`)
    const linea = await crearLinea(request, c, producto.id, `E2E-LPN121C-${ts}`)
    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)
    const estadoIdOriginal: string | null = linea.estado_id ?? null

    const fotoPath = `${c.tenantId}/${linea.id}-${ts}.png`
    await subirFotoEvidencia(request, c, fotoPath)
    const aut = await crearAutorizacionPendiente(request, c, {
      lineaId: linea.id, estadoAnteriorId: estadoIdOriginal, estadoNuevoId: estado.id, fotoPath,
    })

    await irATabAutorizaciones(page)
    const card = cardPorEstado(page, nombreEstado)
    await expect(card).toBeVisible({ timeout: 8000 })

    await card.getByRole('button', { name: 'Rechazar' }).click()
    const motivoInput = card.locator('input[type="text"]')
    await expect(motivoInput).toBeVisible({ timeout: 5000 })
    const confirmarRechazoBtn = card.getByRole('button', { name: 'Confirmar' })

    // Motivo obligatorio: sin texto, el botón queda deshabilitado
    await expect(confirmarRechazoBtn).toBeDisabled()

    const motivo = `No corresponde — E2E ${ts}`
    await motivoInput.fill(motivo)
    await expect(confirmarRechazoBtn).toBeEnabled({ timeout: 3000 })
    await confirmarRechazoBtn.click()
    await expect(page.getByText(/Autorización rechazada/i)).toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: NINGÚN LPN cambió de estado, y la autorización quedó rechazada con el motivo
    const lineaPostRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: c.headers })
    const [lineaPost] = (await lineaPostRes.json()) as Array<{ estado_id: string | null }>
    expect(lineaPost.estado_id, '🛑 [121] APROB-07: al rechazar, estado_id NO debe cambiar').toBe(estadoIdOriginal)

    const autPostRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${aut.id}&select=estado,motivo_rechazo,aprobado_por`, { headers: c.headers })
    const [autPost] = (await autPostRes.json()) as Array<{ estado: string; motivo_rechazo: string | null; aprobado_por: string | null }>
    expect(autPost.estado, '[121] la autorización debe quedar rechazada').toBe('rechazada')
    expect(autPost.motivo_rechazo, '[121] motivo_rechazo debe guardar el texto ingresado').toBe(motivo)
    expect(autPost.aprobado_por, '[121] aprobado_por registra quién resolvió (aprobó o rechazó)').toBe(c.userId)
  })
})
