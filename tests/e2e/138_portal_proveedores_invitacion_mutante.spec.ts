/**
 * 138_portal_proveedores_invitacion_mutante.spec.ts
 * E2E MUTANTE — Portal de Proveedores (Fede, sección H; ver mig 387/390): el staff invita a un
 * proveedor real desde su ficha (ProveedoresPage.tsx → "Portal de Proveedores") → dispara la Edge
 * Function real `invitar-proveedor` (deployada en DEV), que crea la cuenta externa
 * (`proveedor_accounts`, auth.users separado de `users`) y la vincula (`proveedor_account_tenants`).
 *
 * No se prueba clickear el link del email (no hay acceso a la bandeja desde el test) — se verifica
 * el resultado real en DB por REST, igual que el resto de la suite. También se verifica el guard de
 * rol server-side: un CAJERO (sin permiso para gestionar proveedores) debe ser rechazado por la
 * función, no solo por la UI.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CAJERO_SESSION_FILE = path.join(__dirname, '.auth/cajero_session.json')

test.describe('Portal de Proveedores — invitación (mutante)', () => {
  test('DUEÑO invita a un proveedor real desde su ficha → cuenta creada y vinculada en DB', async ({ page, request }) => {
    test.setTimeout(90000)
    const sufijo = Date.now()
    const nombreProv = `E2E PortalProv ${sufijo}`
    const emailInvite = `e2e-portalprov-${sufijo}@genesis360.test`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 1) Sembrar el proveedor de prueba por REST (RLS real, mismo token que la sesión de la página)
    //    tenant_id es obligatorio — se resuelve desde la fila propia de `users`.
    const authUserRes = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers })
    const authUser = await authUserRes.json()
    const userRowRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=tenant_id`, { headers })
    const [userRow] = (await userRowRes.json()) as Array<{ tenant_id: string }>
    const tenantId = userRow.tenant_id

    const provCreateRes = await request.post(`${SUPABASE_URL}/rest/v1/proveedores`, {
      headers, data: { tenant_id: tenantId, nombre: nombreProv },
    })
    expect(provCreateRes.ok(), `[138] no se pudo sembrar el proveedor de prueba: ${await provCreateRes.text()}`).toBe(true)
    const [proveedor] = (await provCreateRes.json()) as Array<{ id: string }>

    // 2) UI real: expandir la ficha del proveedor y usar "Portal de Proveedores"
    await goto(page, '/proveedores')
    await waitForApp(page)
    const buscador = page.getByPlaceholder(/Buscar por nombre, CUIT/i)
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(nombreProv)
    const filaProv = page.locator('div.bg-surface.rounded-xl').filter({ hasText: nombreProv }).first()
    await expect(filaProv, `[138] no apareció la fila del proveedor "${nombreProv}"`).toBeVisible({ timeout: 8000 })
    await filaProv.getByTitle('Ver productos').click()

    const seccionPortal = page.getByText('Portal de Proveedores')
    await expect(seccionPortal, '[138] no apareció la sección "Portal de Proveedores" en la ficha').toBeVisible({ timeout: 5000 })
    const inputEmail = page.getByPlaceholder('Email del proveedor')
    await expect(inputEmail).toBeVisible({ timeout: 5000 })
    await inputEmail.fill(emailInvite)
    await page.getByRole('button', { name: /^Invitar$/ }).click()
    await expect(page.getByText(/Invitación enviada por email/i)).toBeVisible({ timeout: 15000 })

    // POSITIVO en DB: cuenta creada + vinculada (no solo el toast) — vía la RPC del lado STAFF
    // (mig 390, fn_proveedor_portal_vinculo). NO por REST directo a proveedor_accounts/
    // proveedor_account_tenants: esas 2 tablas solo tienen policy de "el proveedor ve su PROPIA
    // fila" (mig 387) — el staff (este token) no tiene ningún camino RLS directo ahí a propósito
    // (hallazgo real de esta misma sesión, ver comentario de la RPC en la migración).
    const vinculoRpcRes = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/fn_proveedor_portal_vinculo`,
      { headers, data: { p_proveedor_id: proveedor.id } },
    )
    expect(vinculoRpcRes.ok(), `[138] no se pudo llamar fn_proveedor_portal_vinculo: ${await vinculoRpcRes.text()}`).toBe(true)
    const [vinculo] = (await vinculoRpcRes.json()) as Array<{ email: string }>
    expect(vinculo, '[138] la RPC no reportó ningún vínculo — la cuenta no se creó o no se linkeó').toBeTruthy()
    expect(vinculo.email, '[138] el vínculo debía reportar el email invitado').toBe(emailInvite)

    // 3) La UI refleja el vínculo tras invalidar la query (re-expandir para forzar el refetch)
    await filaProv.getByTitle('Ver productos').click()
    await filaProv.getByTitle('Ver productos').click()
    await expect(page.getByText(new RegExp(`Vinculado — ${emailInvite}`))).toBeVisible({ timeout: 8000 })

    // 4) Idempotencia real: invitar de nuevo con el mismo email no debe fallar ni duplicar el vínculo
    const segundaRes = await request.post(`${SUPABASE_URL}/functions/v1/invitar-proveedor`, {
      headers, data: { tenant_id: tenantId, proveedor_id: proveedor.id, email: emailInvite },
    })
    expect(segundaRes.ok(), `[138] la 2ª invitación (idempotente) no debía fallar: ${await segundaRes.text()}`).toBe(true)
    const segundaBody = await segundaRes.json()
    expect(segundaBody.ya_vinculado, '[138] la 2ª invitación debía reportar ya_vinculado').toBe(true)

    // Sigue habiendo exactamente UN vínculo visible (la RPC hace LIMIT 1, pero el UNIQUE
    // (proveedor_account_id, tenant_id) de mig 387 ya garantiza que no puede haber 2 — si el
    // segundo insert hubiera duplicado, la 2ª invitación habría fallado con un error de
    // constraint en vez de reportar ya_vinculado:true, así que este chequeo re-confirma lo mismo
    // desde el ángulo del proveedor.
    const vinculoTrasSegundaRes = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/fn_proveedor_portal_vinculo`,
      { headers, data: { p_proveedor_id: proveedor.id } },
    )
    const [vinculoTrasSegunda] = (await vinculoTrasSegundaRes.json()) as Array<{ email: string }>
    expect(vinculoTrasSegunda?.email, '[138] el vínculo debía seguir apuntando al mismo email').toBe(emailInvite)
  })

  test('CAJERO no puede invitar proveedores al portal (guard server-side, no solo UI)', async ({ browser, request }) => {
    test.setTimeout(60000)
    const cajeroContext = await browser.newContext({ storageState: CAJERO_SESSION_FILE })
    const cajeroPage = await cajeroContext.newPage()
    await goto(cajeroPage, '/dashboard')
    await waitForApp(cajeroPage)
    const cajeroToken = await tokenDesdeBrowser(cajeroPage)
    const headers = restHeaders(cajeroToken)

    const authUserRes = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers })
    const authUser = await authUserRes.json()
    const userRowRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=tenant_id`, { headers })
    const [userRow] = (await userRowRes.json()) as Array<{ tenant_id: string }>

    // proveedor_id inventado a propósito — el guard de rol debe rechazar ANTES de llegar a
    // buscarlo (403), así que no hace falta que exista de verdad para probar el rechazo.
    const res = await request.post(`${SUPABASE_URL}/functions/v1/invitar-proveedor`, {
      headers,
      data: { tenant_id: userRow.tenant_id, proveedor_id: '00000000-0000-0000-0000-000000000000', email: 'no-deberia@enviarse.test' },
    })
    expect(res.status(), '[138] CAJERO debía recibir 403 al intentar invitar un proveedor').toBe(403)
    const body = await res.json()
    expect(body.error, '[138] el error debía mencionar autorización').toMatch(/no autorizado/i)

    await cajeroContext.close()
  })
})
