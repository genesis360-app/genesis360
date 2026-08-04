/**
 * 126_aprobacion_estado_convive_cantidad_mutante.spec.ts
 * E2E MUTANTE — APROB-08: un LPN con rol sujeto a AMBOS gates (cantidad, mig 228, y estado, mig
 * 331/333) — cambiar cantidad Y estado A LA VEZ en el mismo guardado de `LpnAccionesModal.tsx`
 * (tab Editar) tiene que generar DOS filas de autorización independientes (`ajuste_cantidad` y
 * `cambio_estado`), sin pisarse, y el resto de los campos editados en el mismo guardado
 * (ubicación, lote, proveedor) se aplica DIRECTO igual — no queda bloqueado por ninguno de los
 * dos gates.
 *
 * 🛑 Corre bajo `chromium-deposito` (rol SUJETO a ambos gates con la config default del tenant:
 * DUEÑO → 'directo', cualquier otro rol → 'siempre', mismo criterio que el spec 117/120 — DEPOSITO
 * está en modo 'siempre' para AMBOS gates porque comparten la fórmula `requiereAuthAjuste`,
 * `src/lib/ajusteAutorizacion.ts`). Con la sesión OWNER (chromium default) el DUEÑO queda exento
 * de los dos gates (H2, ver spec 118) y el test daría falso-verde.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function decodeJwtSub(token: string): string {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub as string
}

interface Ctx { headers: Record<string, string>; tenantId: string; sucursalId: string | null }

async function ctxDeposito(page: any, request: any): Promise<Ctx> {
  await goto(page, '/inventario')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const userId = decodeJwtSub(token)
  const meRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id,sucursal_id,rol`, { headers })
  const [me] = (await meRes.json()) as Array<{ tenant_id: string; sucursal_id: string | null; rol: string }>
  expect(me, '[126] no se pudo resolver el usuario logueado (deposito)').toBeTruthy()
  expect(me.rol, '[126] este spec necesita correr bajo la sesión DEPOSITO (rol sujeto a AMBOS gates) — ver chromium-deposito en playwright.config.ts').toBe('DEPOSITO')

  // Config default del tenant: sin override para DEPOSITO/DUEÑO — si un spec previo lo dejó
  // configurado, este test asume otra cosa y hay que frenar antes de sacar conclusiones falsas
  // (mismo guard que ya usa el spec 120 para APROB-09).
  const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${me.tenant_id}&select=ajuste_autorizacion_roles`, { headers })
  const [{ ajuste_autorizacion_roles: config }] = (await tenantRes.json()) as Array<{ ajuste_autorizacion_roles: any }>
  const overrides = config && typeof config === 'object' ? Object.keys(config) : []
  expect(overrides.filter((r: string) => r === 'DUEÑO' || r === 'DEPOSITO'), '[126] el tenant tiene overrides de DUEÑO/DEPOSITO en ajuste_autorizacion_roles — este spec asume la config default').toHaveLength(0)

  return { headers, tenantId: me.tenant_id, sucursalId: me.sucursal_id }
}

async function crearEstadoConAprobacion(request: any, c: Ctx, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, requiere_aprobacion: true, es_disponible_venta: false },
  })
  expect(res.ok(), `[126] no se pudo crear el estado: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearUbicacion(request: any, c: Ctx, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, activo: true },
  })
  expect(res.ok(), `[126] no se pudo crear la ubicación "${nombre}": ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearProveedor(request: any, c: Ctx, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/proveedores`, {
    headers: c.headers, data: { tenant_id: c.tenantId, nombre, activo: true },
  })
  expect(res.ok(), `[126] no se pudo crear el proveedor "${nombre}": ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearProducto(request: any, c: Ctx, nombre: string, sku: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: c.headers, data: {
      tenant_id: c.tenantId, nombre, sku, precio_costo: 60, precio_venta: 100,
      unidad_medida: 'unidad', activo: true, alicuota_iva: 21, tiene_lote: true,
    },
  })
  expect(res.ok(), `[126] no se pudo crear el producto: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function crearLinea(request: any, c: Ctx, opts: { productoId: string; lpn: string; ubicacionId: string; proveedorId: string; nroLote: string }) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
    headers: c.headers, data: {
      tenant_id: c.tenantId, producto_id: opts.productoId, lpn: opts.lpn, cantidad: 10, activo: true,
      sucursal_id: c.sucursalId, ubicacion_id: opts.ubicacionId, proveedor_id: opts.proveedorId, nro_lote: opts.nroLote,
    },
  })
  expect(res.ok(), `[126] no se pudo crear el LPN: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function buscarYExpandir(page: any, nombreProducto: string) {
  const buscador = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i)
  await expect(buscador).toBeVisible({ timeout: 8000 })
  await buscador.fill(nombreProducto)
  await page.waitForTimeout(700)
  await page.getByText(nombreProducto, { exact: true }).first().click()
}

test.describe('Aprobación de estado convive con aprobación de cantidad (mutante, rol DEPOSITO)', () => {
  test('cambiar cantidad Y estado a la vez genera 2 autorizaciones independientes; ubicación/lote/proveedor se guardan directo (APROB-08)', async ({ page, request }) => {
    test.setTimeout(150000)
    const ts = Date.now()
    const c = await ctxDeposito(page, request)
    const nombreEstado = `E2E Aprob126 Estado ${ts}`
    const nombreProducto = `E2E Aprob126 Prod ${ts}`
    const lpn = `E2E-LPN126-${ts}`

    const estado = await crearEstadoConAprobacion(request, c, nombreEstado)
    const ubicA = await crearUbicacion(request, c, `E2E Ubic126-A ${ts}`)
    const ubicB = await crearUbicacion(request, c, `E2E Ubic126-B ${ts}`)
    const provA = await crearProveedor(request, c, `E2E Prov126-A ${ts}`)
    const provB = await crearProveedor(request, c, `E2E Prov126-B ${ts}`)
    const producto = await crearProducto(request, c, nombreProducto, `E2E-SKU126-${ts}`)
    const linea = await crearLinea(request, c, {
      productoId: producto.id, lpn, ubicacionId: ubicA.id, proveedorId: provA.id, nroLote: 'LOTE-126-A',
    })
    const estadoIdOriginal: string | null = linea.estado_id ?? null
    const cantidadOriginal: number = linea.cantidad

    await goto(page, '/inventario')
    await waitForApp(page)
    await buscarYExpandir(page, nombreProducto)

    const lpnSpan = page.getByText(lpn, { exact: true })
    await expect(lpnSpan).toBeVisible({ timeout: 8000 })
    const fila = lpnSpan.locator('xpath=ancestor::div[contains(@class,"grid-cols-9")][1]')
    await fila.locator('button[title="Acciones sobre este LPN"]').click()

    const modal = page.locator('div.fixed.inset-0.bg-black\\/50').first()
    await expect(modal.getByText(lpn, { exact: true }).first()).toBeVisible({ timeout: 8000 })

    // ── Cambiar CANTIDAD (gate de mig 228) ──
    const cantInput = modal.locator('xpath=.//label[text()="Cantidad"]/following::input[1]')
    await expect(cantInput).toBeVisible({ timeout: 5000 })
    const cantidadNueva = cantidadOriginal + 5
    await cantInput.fill(String(cantidadNueva))

    // ── Cambiar ESTADO (gate de mig 331/333) ──
    const estadoSelect = modal.locator('xpath=.//label[text()="Estado"]/following::select[1]')
    await estadoSelect.selectOption({ label: nombreEstado })

    // ── Cambiar UBICACIÓN, LOTE y PROVEEDOR — deben guardarse DIRECTO, sin gate ──
    const ubicSelect = modal.locator('xpath=.//label[text()="Ubicación"]/following::select[1]')
    await ubicSelect.selectOption({ label: ubicB.nombre })
    const loteInput = modal.locator('xpath=.//label[contains(.,"Nro. lote")]/following::input[1]')
    await loteInput.fill('LOTE-126-B')
    const provSelect = modal.locator('xpath=.//label[text()="Proveedor"]/following::select[1]')
    await provSelect.selectOption({ label: provB.nombre })

    const guardarBtn = modal.getByRole('button', { name: /Enviar a aprobación|Guardar cambios/ })
    // El gate de ESTADO exige foto — sin ella, bloqueado (aunque el gate de cantidad por sí solo no la exige).
    await expect(guardarBtn).toHaveText(/Enviar a aprobación/)
    await expect(guardarBtn).toBeDisabled()

    const fileInput = modal.locator('input[type="file"]')
    await fileInput.setInputFiles({ name: 'evidencia126.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect(guardarBtn).toBeEnabled({ timeout: 3000 })
    await guardarBtn.click()

    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })
    await expect(confirmDialog).toContainText(/no se aplica directo/i)
    await confirmDialog.getByRole('button', { name: 'Confirmar' }).click()

    await expect(page.getByText(/Solicitud enviada — pendiente de aprobación del supervisor/i)).toBeVisible({ timeout: 12000 })

    // ── POSITIVO en DB: DOS autorizaciones independientes, una por gate ──
    const autsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones_inventario?linea_id=eq.${linea.id}&order=created_at.desc&limit=5&select=id,tipo,estado,datos_cambio`,
      { headers: c.headers })
    expect(autsRes.ok(), `[126] no se pudo leer autorizaciones_inventario: ${await autsRes.text()}`).toBe(true)
    const auts = (await autsRes.json()) as Array<{ id: string; tipo: string; estado: string; datos_cambio: any }>

    const autCantidad = auts.find(a => a.tipo === 'ajuste_cantidad')
    expect(autCantidad, '🛑 [126] APROB-08: falta la autorización independiente de ajuste_cantidad').toBeTruthy()
    expect(autCantidad!.estado, '[126] la autorización de cantidad debe quedar PENDIENTE').toBe('pendiente')
    expect(autCantidad!.datos_cambio.cantidad_anterior).toBe(cantidadOriginal)
    expect(autCantidad!.datos_cambio.cantidad_nueva).toBe(cantidadNueva)

    const autEstado = auts.find(a => a.tipo === 'cambio_estado')
    expect(autEstado, '🛑 [126] APROB-08: falta la autorización independiente de cambio_estado').toBeTruthy()
    expect(autEstado!.estado, '[126] la autorización de estado debe quedar PENDIENTE').toBe('pendiente')
    expect(autEstado!.datos_cambio.estado_anterior_id ?? null).toBe(estadoIdOriginal)
    expect(autEstado!.datos_cambio.estado_nuevo_id).toBe(estado.id)
    expect(autEstado!.datos_cambio.foto_path, '[126] la autorización de estado debe traer foto_path').toBeTruthy()

    // No se pisan entre sí: son DOS filas distintas.
    expect(autCantidad!.id).not.toBe(autEstado!.id)

    // ── POSITIVO en DB: la línea sigue con cantidad Y estado VIEJOS (ambos pendientes de aprobar)... ──
    // ...pero ubicación/lote/proveedor SÍ se guardaron directo, sin pasar por ningún gate.
    const lineaRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=cantidad,estado_id,ubicacion_id,nro_lote,proveedor_id`,
      { headers: c.headers })
    const [lineaPost] = (await lineaRes.json()) as Array<{
      cantidad: number; estado_id: string | null; ubicacion_id: string | null; nro_lote: string | null; proveedor_id: string | null
    }>
    expect(lineaPost.cantidad, '🛑 [126] cantidad NO debe haber cambiado hasta que se apruebe').toBe(cantidadOriginal)
    expect(lineaPost.estado_id, '🛑 [126] estado_id NO debe haber cambiado hasta que se apruebe').toBe(estadoIdOriginal)
    expect(lineaPost.ubicacion_id, '[126] ubicación SÍ debe haberse guardado directo (sin gate)').toBe(ubicB.id)
    expect(lineaPost.nro_lote, '[126] nro_lote SÍ debe haberse guardado directo (sin gate)').toBe('LOTE-126-B')
    expect(lineaPost.proveedor_id, '[126] proveedor SÍ debe haberse guardado directo (sin gate)').toBe(provB.id)
  })
})
