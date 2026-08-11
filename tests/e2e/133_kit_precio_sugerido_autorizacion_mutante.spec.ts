/**
 * 133_kit_precio_sugerido_autorizacion_mutante.spec.ts
 * E2E MUTANTE — Motor de Rotación, Opción 3 (E2/E4): la card de un KIT en Inventario → Kits
 * sugiere nombre y precio según su receta (precio = suma de precio_venta × cantidad de cada
 * componente, SIN restar descuento — E4). El nombre se aplica directo (cualquier rol); el precio
 * requiere aprobación de DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN si quien lo pide no lo es.
 *
 * Dos sesiones reales en el mismo test (mismo patrón que los specs de rol 13-18): DEPOSITO
 * (no está en la lista de bypass) dispara el cambio de nombre (directo) y de precio (queda
 * pendiente) desde la UI real; DUEÑO (sesión del storageState del proyecto) lo aprueba desde
 * Autorizaciones. Verifica en DB en cada paso — no solo el toast.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, visible } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEPOSITO_SESSION_FILE = path.join(__dirname, '.auth/deposito_session.json')

test.describe('Motor de Rotación — nombre/precio sugerido de KIT + autorización (mutante)', () => {
  test('nombre se aplica directo; precio pedido por DEPOSITO queda pendiente y DUEÑO lo aprueba', async ({ page, request, browser }) => {
    test.setTimeout(120000)
    const sufijo = Date.now()
    const nombreComponente = `E2E KitPrecioComp ${sufijo}`
    const nombreKit = `E2E KitPrecioKit ${sufijo}`
    const CANT_RECETA = 3
    const PRECIO_COMPONENTE = 100
    const PRECIO_SUGERIDO = PRECIO_COMPONENTE * CANT_RECETA // 300 — E4: sin restar descuento

    // 1) Sesión DUEÑO (storageState del proyecto) — siembra el fixture por REST/UI
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInputComp = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInputComp).toBeVisible({ timeout: 8000 })
    await nombreInputComp.fill(nombreComponente)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })
    const compRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreComponente)}&select=id`,
      { headers },
    )
    const [componente] = (await compRes.json()) as Array<{ id: string }>
    expect(componente, '[133] no se encontró el producto componente recién creado').toBeTruthy()
    const patchComp = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${componente.id}`, {
      headers, data: { precio_venta: PRECIO_COMPONENTE, precio_costo: 60 },
    })
    expect(patchComp.ok(), '[133] no se pudo fijar precio_venta del componente').toBe(true)

    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInputKit = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInputKit).toBeVisible({ timeout: 8000 })
    await nombreInputKit.fill(nombreKit)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })
    const kitRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreKit)}&select=id,tenant_id,precio_venta`,
      { headers },
    )
    const [kit] = (await kitRes.json()) as Array<{ id: string; tenant_id: string; precio_venta: number | null }>
    expect(kit, '[133] no se encontró el producto KIT recién creado').toBeTruthy()
    const patchKit = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${kit.id}`, {
      headers, data: { es_kit: true },
    })
    expect(patchKit.ok(), '[133] no se pudo marcar es_kit=true').toBe(true)
    // precio_venta del KIT queda en su default (0/null) — así la sugerencia SIEMPRE difiere y el
    // bloque "Sugerido según la receta" se muestra sin depender de qué default trae el form de alta.
    expect(Number(kit.precio_venta) || 0, '[133] el KIT recién creado no debería tener ya el precio sugerido por casualidad').not.toBe(PRECIO_SUGERIDO)

    const recetaRes = await request.post(`${SUPABASE_URL}/rest/v1/kit_recetas`, {
      headers, data: { tenant_id: kit.tenant_id, kit_producto_id: kit.id, comp_producto_id: componente.id, cantidad: CANT_RECETA },
    })
    expect(recetaRes.ok(), `[133] no se pudo crear la receta: ${await recetaRes.text()}`).toBe(true)

    const nombreSugeridoEsperado = `Kit ${CANT_RECETA}× ${nombreComponente}`

    // 2) Sesión DEPOSITO (rol sin bypass de precio) — abre Inventario → Kits, expande el KIT,
    //    ve la sugerencia y APLICA EL NOMBRE directo (sin autorización)
    const depositoContext = await browser.newContext({ storageState: DEPOSITO_SESSION_FILE })
    const depositoPage = await depositoContext.newPage()
    await goto(depositoPage, '/inventario')
    await waitForApp(depositoPage)
    const tabKitsDep = depositoPage.getByRole('button', { name: 'Kits' })
    await expect(tabKitsDep, '[133] DEPOSITO no ve el tab Kits').toBeVisible({ timeout: 8000 })
    await tabKitsDep.click()
    const buscadorKitDep = depositoPage.getByPlaceholder(/Buscar KIT por nombre o SKU/i)
    await expect(buscadorKitDep).toBeVisible({ timeout: 8000 })
    await buscadorKitDep.fill(nombreKit)
    const filaKitDep = depositoPage.locator('div').filter({ hasText: nombreKit }).filter({ has: depositoPage.getByRole('button', { name: 'Armar' }) }).last()
    await expect(filaKitDep, `[133] DEPOSITO no ve la fila del KIT "${nombreKit}"`).toBeVisible({ timeout: 10000 })
    await filaKitDep.click()

    const sugeridoBlockDep = depositoPage.getByText('Sugerido según la receta')
    await expect(sugeridoBlockDep, '[133] no apareció el bloque de sugerencia').toBeVisible({ timeout: 8000 })
    await expect(depositoPage.getByText(nombreSugeridoEsperado)).toBeVisible({ timeout: 5000 })
    await depositoPage.getByRole('button', { name: 'Usar' }).click()
    await expect(depositoPage.getByText(/Nombre del KIT actualizado/i)).toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: el nombre se aplicó SIN pasar por autorizaciones
    const kitPostNombreRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${kit.id}&select=nombre`, { headers })
    const [kitPostNombre] = (await kitPostNombreRes.json()) as Array<{ nombre: string }>
    expect(kitPostNombre?.nombre, '[133] el nombre del KIT debía quedar actualizado al sugerido').toBe(nombreSugeridoEsperado)

    // 3) Misma sesión DEPOSITO — pide el cambio de PRECIO. Como DEPOSITO no está en la lista de
    //    bypass (DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN), tiene que quedar PENDIENTE, no aplicarse.
    //    El KIT cambió de nombre recién arriba — re-buscar con el nombre NUEVO (buscar con el
    //    viejo daría 0 resultados y la card ya no estaría expandida tras el refetch).
    await buscadorKitDep.fill(nombreSugeridoEsperado)
    const filaKitDep2 = depositoPage.locator('div').filter({ hasText: nombreSugeridoEsperado }).filter({ has: depositoPage.getByRole('button', { name: 'Armar' }) }).last()
    await expect(filaKitDep2, `[133] DEPOSITO no ve la fila del KIT ya renombrado "${nombreSugeridoEsperado}"`).toBeVisible({ timeout: 10000 })
    if (!(await visible(depositoPage.getByText('Sugerido según la receta'), 2000))) await filaKitDep2.click()

    const botonPrecioDep = depositoPage.getByRole('button', { name: 'Enviar a aprobación' })
    await expect(
      botonPrecioDep,
      '[133] no apareció "Enviar a aprobación" — DEPOSITO no debería ver "Actualizar" directo (eso sería un bypass real del gate de precio)',
    ).toBeVisible({ timeout: 8000 })
    await botonPrecioDep.click()
    // Modal de confirmación propio (useConfirm, role="alertdialog") — confirmar. Acotado al
    // diálogo: la cola "En Armado" (spec 132 deja kits sin confirmar/cancelar a propósito) tiene
    // sus propios botones "Confirmar" sueltos en la misma página — un selector global chocaría.
    const confirmarBtnDep = depositoPage.getByRole('alertdialog').getByRole('button', { name: /^Confirmar$/i })
    await expect(confirmarBtnDep, '[133] no apareció el diálogo de confirmación al pedir el cambio de precio').toBeVisible({ timeout: 5000 })
    await confirmarBtnDep.click()
    await expect(depositoPage.getByText(/pendiente de aprobación/i)).toBeVisible({ timeout: 10000 })
    await depositoContext.close()

    // POSITIVO en DB: precio_venta del KIT SIGUE sin tocarse, quedó una autorización pendiente
    const kitTrasPedidoRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${kit.id}&select=precio_venta`, { headers })
    const [kitTrasPedido] = (await kitTrasPedidoRes.json()) as Array<{ precio_venta: number | null }>
    expect(Number(kitTrasPedido?.precio_venta) || 0, '[133] el precio del KIT NO debía cambiar todavía — falta la aprobación').not.toBe(PRECIO_SUGERIDO)

    const autRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones?tipo=eq.kit_precio&estado=eq.pendiente` +
        `&datos_cambio->>producto_id=eq.${kit.id}&select=id,datos_cambio&order=created_at.desc&limit=1`,
      { headers },
    )
    expect(autRes.ok(), `[133] no se pudo leer autorizaciones: ${await autRes.text()}`).toBe(true)
    const [aut] = (await autRes.json()) as Array<{ id: string; datos_cambio: { precio_nuevo: number; precio_anterior: number; kit_nombre: string } }>
    expect(aut, '[133] no se encontró la autorización pendiente de kit_precio').toBeTruthy()
    expect(aut.datos_cambio.precio_nuevo, '[133] la autorización debe pedir el precio sugerido exacto').toBe(PRECIO_SUGERIDO)
    expect(aut.datos_cambio.kit_nombre, '[133] la autorización debe llevar el nombre del KIT').toBe(nombreSugeridoEsperado)

    // 4) Sesión DUEÑO (page principal) — aprueba desde Inventario → Autorizaciones
    await goto(page, '/inventario')
    await waitForApp(page)
    const tabAut = page.getByRole('button', { name: 'Autorizaciones' })
    await expect(tabAut, '[133] DUEÑO no ve el tab Autorizaciones').toBeVisible({ timeout: 8000 })
    await tabAut.click()

    const filaAut = page.locator('div').filter({ hasText: nombreSugeridoEsperado }).filter({ has: page.getByRole('button', { name: /Aprobar/i }) }).last()
    await expect(filaAut, '[133] no apareció la fila de la autorización de precio en la lista').toBeVisible({ timeout: 10000 })
    const btnAprobar = filaAut.getByRole('button', { name: /Aprobar/i })
    await expect(btnAprobar).toBeVisible({ timeout: 5000 })
    await btnAprobar.click()
    const confirmarAprobar = page.getByRole('alertdialog').getByRole('button', { name: /^Confirmar$/i })
    await expect(confirmarAprobar, '[133] no apareció el diálogo de confirmación al aprobar').toBeVisible({ timeout: 5000 })
    await confirmarAprobar.click()
    await expect(page.getByText(/Autorización aprobada y ejecutada/i)).toBeVisible({ timeout: 10000 })

    // 5) POSITIVO final en DB: el precio del KIT quedó en el valor sugerido, y la autorización
    //    pasó a aprobada.
    const kitFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${kit.id}&select=precio_venta`, { headers })
    const [kitFinal] = (await kitFinalRes.json()) as Array<{ precio_venta: number | null }>
    expect(Number(kitFinal?.precio_venta), '[133] el precio del KIT debía quedar en el valor sugerido tras la aprobación').toBe(PRECIO_SUGERIDO)

    const autFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${aut.id}&select=estado`, { headers })
    const [autFinal] = (await autFinalRes.json()) as Array<{ estado: string }>
    expect(autFinal?.estado, '[133] la autorización debía quedar aprobada').toBe('aprobada')
  })
})
