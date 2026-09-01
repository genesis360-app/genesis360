/**
 * 139_portal_proveedores_respuesta_precio_mutante.spec.ts
 * E2E MUTANTE — Portal de Proveedores, ida y vuelta completa (2 tests separados a propósito, ver
 * nota al final del archivo):
 *
 * A) El proveedor entra al portal REAL (login con contraseña, mismo formulario que ve un
 *    proveedor real), ve la OC que le mandaron, propone un precio por ítem (RPC
 *    fn_portal_proveedor_responder_item) — precio_unitario NUNCA se toca solo (REGLA #0).
 * B) El staff ve una propuesta pendiente en el detalle de la OC (ProveedoresPage.tsx) y la
 *    "Aplica" a mano — mismo patrón ya probado en spec 34/138 (navegar a /proveedores con la
 *    sesión del proyecto, sin abrir un contexto nuevo a mitad de test).
 *
 * Fixture PRE-SEMBRADA para (A) (no en este archivo): proveedor + producto + OC 'enviada' con 1
 * ítem + invitación real (Edge Function `invitar-proveedor`, mismo camino que spec 138), toda por
 * REST contra DEV con el token del OWNER. La cuenta de proveedor resultante es un `auth.users`
 * real (creado por `admin.generateLink`, no a mano). Como no hay bandeja de email accesible desde
 * el test, se le fijó una contraseña + `email_confirmed_at` por SQL (pgcrypto — mismo hash que usa
 * GoTrue) SOLO para poder loguearse con el formulario real del portal: es la PRIMERA vez que esa
 * cuenta (recién creada, nunca tuvo contraseña) la tiene — no se toca ninguna cuenta real.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

// Fixture fija sembrada por REST antes de esta corrida (ver comentario del archivo) — tenant DEV.
const NOMBRE_PROD = 'E2E PortalRespProd fixed95901'
const EMAIL_PROV = 'e2e-portalresp-fixed95901@genesis360.test'
const TEST_PASSWORD = 'E2ePortalProveedor!2026'
const OC_NUMERO = 32
const ITEM_ID = '789f4873-bcff-4e23-8d6c-710154d0c1bc'
const PRECIO_ORIGINAL = 100
const PRECIO_PROPUESTO = 137.5

test.describe('Portal de Proveedores — respuesta de precio (mutante)', () => {
  test('A) proveedor loguea, ve la OC enviada, propone precio (RPC real)', async ({ page, request, browser }) => {
    test.setTimeout(60000)

    const token = await (async () => {
      await goto(page, '/dashboard')
      await waitForApp(page)
      return tokenDesdeBrowser(page)
    })()
    const headers = restHeaders(token)
    const itemPreRes = await request.get(
      `${SUPABASE_URL}/rest/v1/orden_compra_items?id=eq.${ITEM_ID}&select=precio_unitario,precio_propuesto_proveedor`,
      { headers },
    )
    const [itemPre] = (await itemPreRes.json()) as Array<{ precio_unitario: number; precio_propuesto_proveedor: number | null }>
    expect(itemPre, '[139] no se encontró el ítem de la fixture — resembrar antes de correr este spec').toBeTruthy()
    expect(Number(itemPre.precio_unitario), '[139] precio_unitario inicial inesperado').toBe(PRECIO_ORIGINAL)

    // Sesión del PROVEEDOR — contexto nuevo con storageState VACÍO explícito. El proyecto
    // `chromium` de playwright.config.ts configura `storageState: session.json` (la sesión del
    // OWNER) a nivel de proyecto, y `browser.newContext()` sin overrides HEREDA esos defaults —
    // sin este `storageState: {cookies:[],origins:[]}` explícito, este contexto "nuevo" arrancaba
    // YA logueado como el OWNER (hallazgo real de esta sesión, no un bug de la feature).
    const provContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const provPage = await provContext.newPage()
    await goto(provPage, '/portal-proveedores')
    await expect(provPage.getByText('Portal de Proveedores')).toBeVisible({ timeout: 8000 })
    await provPage.getByPlaceholder('Tu email').fill(EMAIL_PROV)
    await provPage.getByPlaceholder('Contraseña').fill(TEST_PASSWORD)
    await provPage.getByRole('button', { name: /^Ingresar$/ }).click()

    await expect(provPage.getByText(`OC #${OC_NUMERO}`), '[139] no apareció la OC en el portal del proveedor').toBeVisible({ timeout: 10000 })
    await provPage.getByText(`OC #${OC_NUMERO}`).click()
    await expect(provPage.getByText(NOMBRE_PROD)).toBeVisible({ timeout: 5000 })

    const inputPrecio = provPage.locator('input[type="number"]').first()
    await inputPrecio.fill(String(PRECIO_PROPUESTO))
    await provPage.getByTitle('Enviar precio').click()
    await expect(provPage.getByText(/Precio enviado/i)).toBeVisible({ timeout: 10000 })
    await provContext.close()

    // POSITIVO en DB: la propuesta quedó guardada, precio_unitario NUNCA se tocó solo
    const itemPostRes = await request.get(
      `${SUPABASE_URL}/rest/v1/orden_compra_items?id=eq.${ITEM_ID}&select=precio_unitario,precio_propuesto_proveedor,respondido_at`,
      { headers },
    )
    const [itemPost] = (await itemPostRes.json()) as Array<{ precio_unitario: number; precio_propuesto_proveedor: number; respondido_at: string | null }>
    expect(Number(itemPost.precio_propuesto_proveedor), '[139] la propuesta no quedó guardada').toBe(PRECIO_PROPUESTO)
    expect(itemPost.respondido_at, '[139] respondido_at debía quedar seteado').toBeTruthy()
    expect(Number(itemPost.precio_unitario), '[139] precio_unitario NO debía cambiar solo — eso lo aplica el staff a mano').toBe(PRECIO_ORIGINAL)
  })

  test('B) staff ve una propuesta pendiente y la aplica a mano', async ({ page, request }) => {
    test.setTimeout(60000)
    const sufijo = Date.now()
    const nombreProv = `E2E PortalAplicar ${sufijo}`
    const nombreProd = `E2E PortalAplicarProd ${sufijo}`
    const PRECIO_ORIG_B = 50
    const PRECIO_PROP_B = 63.25

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const authUserRes = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers })
    const authUser = await authUserRes.json()
    const userRowRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=tenant_id`, { headers })
    const [userRow] = (await userRowRes.json()) as Array<{ tenant_id: string }>
    // El listado de OC filtra por sucursal activa con `.eq()` estricto (useSucursalFilter.ts) —
    // excluye sucursal_id NULL cuando hay una sucursal específica seleccionada (no "Todas"). Hay
    // que sembrar la OC en la MISMA sucursal que el filtro activo del staff, o el listado la
    // esconde sin ningún error (hallazgo real de esta sesión, no un bug de la feature).
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?tenant_id=eq.${userRow.tenant_id}&activo=eq.true&select=id&order=created_at&limit=1`, { headers })
    const [sucursal] = (await sucRes.json()) as Array<{ id: string }>

    // Fixture propia — simula que el proveedor YA respondió (no depende del test A ni del portal;
    // aísla la verificación del lado staff, que es la que se ve afectada por el flake ya
    // documentado de AppLayout cuando se navega con un contexto/sesión recién creado).
    const provRes = await request.post(`${SUPABASE_URL}/rest/v1/proveedores`, { headers, data: { tenant_id: userRow.tenant_id, nombre: nombreProv } })
    const [proveedor] = (await provRes.json()) as Array<{ id: string }>
    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, { headers, data: { tenant_id: userRow.tenant_id, nombre: nombreProd, sku: `E2E-PA-${sufijo}`, precio_venta: 100, precio_costo: 50 } })
    const [producto] = (await prodRes.json()) as Array<{ id: string }>
    const ocRes = await request.post(`${SUPABASE_URL}/rest/v1/ordenes_compra`, { headers, data: { tenant_id: userRow.tenant_id, proveedor_id: proveedor.id, estado: 'enviada', sucursal_id: sucursal?.id ?? null } })
    const [oc] = (await ocRes.json()) as Array<{ id: string; numero: number }>
    const itemRes = await request.post(`${SUPABASE_URL}/rest/v1/orden_compra_items`, {
      headers, data: { orden_compra_id: oc.id, producto_id: producto.id, cantidad: 2, precio_unitario: PRECIO_ORIG_B, precio_propuesto_proveedor: PRECIO_PROP_B, respondido_at: new Date().toISOString() },
    })
    const [item] = (await itemRes.json()) as Array<{ id: string }>

    // Mismo patrón ya probado en spec 34/138: `page` recién autenticado por auth.setup.ts, sin
    // gap largo, navegación directa a /proveedores. Filtra por el PROVEEDOR (nombre único de este
    // test, tiene exactamente 1 OC) en vez de buscar por número — el listado etiqueta la OC con
    // `S-OC-NNNN` (numeración por sucursal, A5 del backlog CO1) en vez de `#{numero}` crudo, así
    // que con exactamente 1 resultado alcanza con abrir el único "Ver detalle" visible.
    await goto(page, '/proveedores')
    await waitForApp(page)
    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    const filtroProveedor = page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los proveedores/i }) }).first()
    await expect(filtroProveedor, '[139b] no apareció el filtro de proveedor en Órdenes de compra').toBeVisible({ timeout: 8000 })
    await filtroProveedor.selectOption({ label: nombreProv })
    const verDetalle = page.getByRole('button', { name: /^Ver detalle$/ }).first()
    await expect(verDetalle, `[139b] no apareció la OC filtrando por proveedor "${nombreProv}"`).toBeVisible({ timeout: 10000 })
    await verDetalle.click()

    await expect(page.getByText(`Propuesto: $${PRECIO_PROP_B.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`)).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /^Aplicar$/ }).click()
    await expect(page.getByText(/Precio aplicado/i)).toBeVisible({ timeout: 10000 })

    const itemFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/orden_compra_items?id=eq.${item.id}&select=precio_unitario`, { headers })
    const [itemFinal] = (await itemFinalRes.json()) as Array<{ precio_unitario: number }>
    expect(Number(itemFinal.precio_unitario), '[139b] precio_unitario debía quedar en el valor aplicado').toBe(PRECIO_PROP_B)
  })
})

// Nota: (A) y (B) se separaron a propósito en vez de encadenarlos en un solo test. Encadenados
// (probado primero), navegar al lado staff DESPUÉS del lado proveedor — sea reusando `page` tras
// quedar idle largo rato, sea abriendo un browser.newContext() nuevo a mitad de test — disparaba
// consistentemente el flake YA DOCUMENTADO de AppLayout.tsx (ver docstring de `irAlPOS` en
// helpers/fixtures.ts): el useEffect de restricciones de rutas por rol redirige a /dashboard antes
// de que user/tenant/permisos_custom terminen de resolver. No es un bug de esta feature — (B)
// prueba el mismo código exacto (botón "Aplicar") con el patrón de sesión que YA funciona en
// specs 34/138 (navegación directa apenas arranca el test, sin contexto nuevo a mitad de camino).
