/**
 * 117_aprobacion_estado_bypass_masivo_mutante.spec.ts
 * E2E MUTANTE — APROB-01, 02, 04: corazón del control anti-fraude de Fase B (backlog Comercial de
 * Fede) — aprobación de cambio de estado con foto.
 *
 * 🛑 Corre bajo el proyecto `chromium-deposito` (rol SUJETO al gate) — NO bajo `chromium` default
 * (sesión OWNER/DUEÑO), que por default queda EXENTO (hallazgo H2, ver spec 118). Si este spec
 * corriera con la sesión del DUEÑO, el cambio se aplicaría directo y el test daría falso-verde.
 *
 * APROB-01: sin foto, el guardado queda BLOQUEADO (botón deshabilitado, `estado_id` no cambia).
 * APROB-02: con foto, el cambio queda PENDIENTE — se sube la foto al bucket privado
 *   `autorizaciones-fotos`, se crea `autorizaciones_inventario` (tipo `cambio_estado`, pendiente),
 *   se notifica a DUEÑO/SUPERVISOR/SUPER_USUARIO, y `inventario_lineas.estado_id` sigue siendo el
 *   viejo hasta que alguien apruebe — verificado en DB, no solo por el toast.
 * APROB-04: el caso MASIVO (≥2 LPNs) es la regresión del bug de seguridad que esta fase cerró
 *   (antes escribía `estado_id` directo sin ningún gate) — mismo comportamiento, UNA sola foto y
 *   UNA sola autorización para todo el lote, NINGÚN LPN cambia hasta aprobar.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, loginToken } from './helpers/fixtures'

/** El `sub` del JWT es el `users.id` del actor logueado (deposito) — evita adivinar cuál fila de
 *  `users` es "la propia" cuando hay más de un usuario con el mismo rol en el tenant. */
function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

// PNG 1x1 válido (evidencia de la foto) — Playwright puede setear el buffer directo, sin disco.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

interface Ctx { headers: Record<string, string>; token: string; tenantId: string; sucursalId: string | null }

async function ctxDeposito(page: any, request: any): Promise<Ctx> {
  await goto(page, '/inventario')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const userId = decodeJwtSub(token)
  const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id,sucursal_id,rol`, { headers })
  const [me] = (await meRes.json()) as Array<{ tenant_id: string; sucursal_id: string | null; rol: string }>
  expect(me, '[117] no se pudo resolver el usuario logueado (deposito)').toBeTruthy()
  expect(me.rol, '[117] este spec necesita correr bajo la sesión DEPOSITO (rol sujeto al gate) — ver chromium-deposito en playwright.config.ts').toBe('DEPOSITO')
  return { headers, token, tenantId: me.tenant_id, sucursalId: me.sucursal_id }
}

async function crearEstadoConAprobacion(request: any, c: Ctx, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, requiere_aprobacion: true, es_disponible_venta: false },
  })
  expect(res.ok(), `[117] no se pudo crear el estado: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearProducto(request: any, c: Ctx, nombre: string, sku: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: c.headers, data: {
      tenant_id: c.tenantId, nombre, sku, precio_costo: 60, precio_venta: 100,
      unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
    },
  })
  expect(res.ok(), `[117] no se pudo crear el producto: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearLinea(request: any, c: Ctx, productoId: string, lpn: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
    headers: c.headers, data: {
      tenant_id: c.tenantId, producto_id: productoId, lpn, cantidad: 10, activo: true,
      sucursal_id: c.sucursalId,
    },
  })
  expect(res.ok(), `[117] no se pudo crear el LPN: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

/** Busca el producto en /inventario y expande su fila de LPNs. */
async function buscarYExpandir(page: any, nombreProducto: string) {
  const buscador = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i)
  await expect(buscador).toBeVisible({ timeout: 8000 })
  await buscador.fill(nombreProducto)
  const fila = page.getByText(nombreProducto, { exact: true }).first()
  await expect(fila, `[117] "${nombreProducto}" no apareció en el buscador de Inventario`).toBeVisible({ timeout: 8000 })
  await fila.click()
}

test.describe('Aprobación de cambio de estado — bypass masivo cerrado (mutante, rol DEPOSITO)', () => {
  test('single LPN: sin foto bloquea (APROB-01), con foto queda PENDIENTE sin tocar estado_id (APROB-02)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctxDeposito(page, request)
    const nombreEstado = `E2E Aprob117 Estado ${ts}`
    const nombreProducto = `E2E Aprob117 Prod ${ts}`
    const lpn = `E2E-LPN117-${ts}`

    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)
    // SKU distinto del LPN a propósito: si coincidieran, el texto del LPN quedaría AMBIGUO en la UI
    // (la fila del producto también muestra su SKU) y `getByText(lpn, { exact: true })` rompería en
    // "strict mode violation" por resolver a 2 elementos.
    const producto = await crearProducto(request, c, nombreProducto, `E2E-SKU117-${ts}`)
    const linea = await crearLinea(request, c, producto.id, lpn)
    const estadoIdOriginal: string | null = linea.estado_id ?? null

    await goto(page, '/inventario')
    await waitForApp(page)
    await buscarYExpandir(page, nombreProducto)

    const lpnSpan = page.getByText(lpn, { exact: true })
    await expect(lpnSpan).toBeVisible({ timeout: 8000 })
    const fila = lpnSpan.locator('xpath=ancestor::div[contains(@class,"grid-cols-9")][1]')
    await fila.locator('button[title="Acciones sobre este LPN"]').click()

    const modal = page.locator('div.fixed.inset-0.bg-black\\/50').first()
    await expect(modal.getByText(lpn, { exact: true }).first()).toBeVisible({ timeout: 8000 })

    const estadoSelect = modal.locator('xpath=.//label[text()="Estado"]/following::select[1]')
    await expect(estadoSelect).toBeVisible({ timeout: 5000 })
    await estadoSelect.selectOption({ label: nombreEstado })

    const guardarBtn = modal.getByRole('button', { name: /Enviar a aprobación|Guardar cambios/ })

    // ── APROB-01: sin foto, el guardado queda bloqueado ──
    await expect(modal.getByText(/requiere una foto tomada en el momento|no se puede subir desde la galería/i)).toBeVisible({ timeout: 5000 })
    await expect(guardarBtn).toHaveText(/Enviar a aprobación/)
    await expect(guardarBtn).toBeDisabled()

    const sinCambioRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: c.headers })
    const [sinCambio] = (await sinCambioRes.json()) as Array<{ estado_id: string | null }>
    expect(sinCambio.estado_id, '[117] APROB-01: sin foto, estado_id NO debe cambiar').toBe(estadoIdOriginal)

    // ── APROB-02: con foto, queda pendiente de aprobación ──
    const fileInput = modal.locator('input[type="file"]')
    await fileInput.setInputFiles({ name: 'evidencia117.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect(modal.getByText(/✓ evidencia117\.png/)).toBeVisible({ timeout: 3000 })
    await expect(guardarBtn).toBeEnabled({ timeout: 3000 })
    await guardarBtn.click()

    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await expect(confirmDialog).toContainText(/no se aplica directo/i)
    await confirmDialog.getByRole('button', { name: 'Confirmar' }).click()

    await expect(page.getByText(/Solicitud enviada — pendiente de aprobación del supervisor/i)).toBeVisible({ timeout: 12000 })

    // POSITIVO en DB: autorización pendiente creada, con la foto y los estados correctos
    const autRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones_inventario?linea_id=eq.${linea.id}&tipo=eq.cambio_estado&order=created_at.desc&limit=1&select=id,estado,tipo,linea_id,datos_cambio`,
      { headers: c.headers })
    expect(autRes.ok(), `[117] no se pudo leer autorizaciones_inventario: ${await autRes.text()}`).toBe(true)
    const [aut] = (await autRes.json()) as Array<{ id: string; estado: string; datos_cambio: any }>
    expect(aut, '[117] APROB-02: no se creó la autorización de cambio_estado').toBeTruthy()
    expect(aut.estado, '[117] la autorización debe quedar PENDIENTE').toBe('pendiente')
    expect(aut.datos_cambio.estado_nuevo_id).toBe(estado.id)
    expect(aut.datos_cambio.estado_anterior_id ?? null).toBe(estadoIdOriginal)
    const fotoPath = aut.datos_cambio.foto_path as string
    expect(fotoPath, '[117] datos_cambio.foto_path debe existir').toBeTruthy()
    expect(fotoPath.startsWith(`${c.tenantId}/${linea.id}-`), `[117] foto_path esperado con prefijo "${c.tenantId}/${linea.id}-", recibido "${fotoPath}"`).toBe(true)

    // La foto realmente se subió al bucket privado (no solo la referencia en la DB)
    const fotoRes = await request.get(`${SUPABASE_URL}/storage/v1/object/autorizaciones-fotos/${fotoPath}`, { headers: c.headers })
    expect(fotoRes.ok(), `[117] la foto no está en el bucket "autorizaciones-fotos": ${await fotoRes.text()}`).toBe(true)

    // 🛑 estado_id de la línea SIGUE siendo el viejo hasta que alguien apruebe
    const lineaPostRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: c.headers })
    const [lineaPost] = (await lineaPostRes.json()) as Array<{ estado_id: string | null }>
    expect(lineaPost.estado_id, '🛑 [117] APROB-02: estado_id NO debe cambiar hasta la aprobación').toBe(estadoIdOriginal)

    // Se notificó a quienes pueden aprobar (RLS de notificaciones es self-only → leer como OWNER)
    const ownerToken = await loginToken(request)
    const ownerHeaders = restHeaders(ownerToken)
    const notifRes = await request.get(
      `${SUPABASE_URL}/rest/v1/notificaciones?tipo=eq.cambio_estado_pendiente&mensaje=ilike.*${encodeURIComponent(lpn)}*&order=created_at.desc&limit=5`,
      { headers: ownerHeaders })
    expect(notifRes.ok(), `[117] no se pudo leer notificaciones: ${await notifRes.text()}`).toBe(true)
    const notifs = (await notifRes.json()) as any[]
    expect(notifs.length, '[117] debe haberse notificado a DUEÑO/SUPERVISOR/SUPER_USUARIO').toBeGreaterThan(0)
  })

  test('bulk (≥2 LPNs): mismo gate, NINGÚN LPN cambia de estado hasta aprobar (APROB-04)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctxDeposito(page, request)
    const nombreEstado = `E2E Aprob117B Estado ${ts}`
    const nombreProducto = `E2E Aprob117B Prod ${ts}`
    const lpnA = `E2E-117B-A-${ts}`
    const lpnB = `E2E-117B-B-${ts}`

    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)
    const producto = await crearProducto(request, c, nombreProducto, `E2E-117B-${ts}`)
    const lineaA = await crearLinea(request, c, producto.id, lpnA)
    const lineaB = await crearLinea(request, c, producto.id, lpnB)

    await goto(page, '/inventario')
    await waitForApp(page)
    await buscarYExpandir(page, nombreProducto)

    for (const lpn of [lpnA, lpnB]) {
      const span = page.getByText(lpn, { exact: true })
      await expect(span).toBeVisible({ timeout: 8000 })
      const fila = span.locator('xpath=ancestor::div[contains(@class,"grid-cols-9")][1]')
      await fila.locator('input[type="checkbox"]').check()
    }

    await expect(page.getByText(/2\s+LPNs?\s+seleccionado/i)).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Cambiar estado' }).click()

    const bulkModal = page.locator('div.fixed.inset-0.bg-black\\/40').first()
    await expect(bulkModal).toBeVisible({ timeout: 5000 })
    await bulkModal.locator('select').first().selectOption({ label: nombreEstado })

    const confirmarBtn = bulkModal.getByRole('button', { name: /Enviar a aprobación|^Confirmar$/ })
    // Sin foto, bloqueado — mismo criterio que el single (APROB-01, ahora en el bulk)
    await expect(confirmarBtn).toHaveText(/Enviar a aprobación/)
    await expect(confirmarBtn).toBeDisabled()

    const fileInput = bulkModal.locator('input[type="file"]')
    await fileInput.setInputFiles({ name: 'evidencia117b.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect(confirmarBtn).toBeEnabled({ timeout: 3000 })
    await confirmarBtn.click()

    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await confirmDialog.getByRole('button', { name: 'Confirmar' }).click()

    await expect(page.getByText(/Solicitud enviada — 2 LPN\(s\) pendientes de aprobación/i)).toBeVisible({ timeout: 12000 })

    // POSITIVO en DB: UNA sola autorización para todo el lote
    const autRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones_inventario?tipo=eq.cambio_estado&linea_id=is.null&order=created_at.desc&limit=5&select=id,estado,datos_cambio`,
      { headers: c.headers })
    expect(autRes.ok(), `[117] no se pudo leer autorizaciones_inventario: ${await autRes.text()}`).toBe(true)
    const bulkAuts = (await autRes.json()) as Array<{ id: string; estado: string; datos_cambio: any }>
    const aut = bulkAuts.find(a => {
      const ids: string[] = a.datos_cambio?.linea_ids ?? []
      return ids.includes(lineaA.id) && ids.includes(lineaB.id)
    })
    expect(aut, '🛑 [117] APROB-04: no se creó la autorización batch con AMBOS linea_ids').toBeTruthy()
    expect(aut!.estado, '[117] la autorización batch debe quedar PENDIENTE').toBe('pendiente')
    expect(aut!.datos_cambio.estado_nuevo_id).toBe(estado.id)
    const fotoPath = aut!.datos_cambio.foto_path as string
    expect(fotoPath?.startsWith(`${c.tenantId}/bulk-`), `[117] foto_path del bulk esperado con prefijo "${c.tenantId}/bulk-"`).toBe(true)

    // 🛑 Regresión del bug cerrado por esta fase: NINGÚN LPN del lote cambió de estado
    const postRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=in.(${lineaA.id},${lineaB.id})&select=id,estado_id`, { headers: c.headers })
    const post = (await postRes.json()) as Array<{ id: string; estado_id: string | null }>
    for (const l of post) {
      expect(l.estado_id, `🛑 [117] APROB-04: LPN ${l.id} NO debe haber cambiado de estado sin aprobar`).not.toBe(estado.id)
    }
  })
})
