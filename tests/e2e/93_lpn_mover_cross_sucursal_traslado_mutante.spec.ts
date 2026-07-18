/**
 * 93_lpn_mover_cross_sucursal_traslado_mutante.spec.ts
 * E2E MUTANTE — LpnAccionesModal → tab "Mover" hacia OTRA sucursal genera un traslado real
 * (REGLA #0, inventario multi-sucursal).
 *
 * Reproduce y cierra el gap que reportó GO (2026-07-18): antes de este fix, mover parte de un
 * LPN a otra sucursal desde el modal de Acciones reubicaba el stock DIRECTO en destino — el
 * stock aparecía en la otra sucursal sin que nadie confirmara que llegó físicamente, saltándose
 * el mecanismo de "traslado en tránsito → confirmar recepción" que ya existía en el tab
 * Traslados. Ahora debe: (a) despachar un traslado real (estado en_transito, sale el stock del
 * origen), (b) NO crear stock en destino todavía, (c) aparecer en el tab Traslados para que la
 * OTRA sucursal lo confirme, (d) la ubicación elegida al despachar precarga el selector de
 * "Confirmar recepción" (mig 276) sin ser vinculante.
 *
 * Usa DOS usuarios reales de sucursales distintas (no el OWNER simulando ambos lados, como el
 * spec 30): el despacho lo hace el OWNER parado en Sucursal Norte, la recepción la confirma
 * `deposito@genesis360.com` (rol DEPOSITO, fijo a Sucursal Sur, puede_ver_todas=false) en un
 * browser context separado con su propio login real — así se valida también que un usuario
 * restringido a UNA sucursal puede confirmar lo que le llega.
 *
 * Genera su propia precondición: producto nuevo + ingreso real. Requiere
 * E2E_DEPOSITO_SUR_EMAIL/PASSWORD en .env.test.local (si faltan, se skipea).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

test.describe('LpnAccionesModal → Mover a OTRA sucursal genera traslado (mutante)', () => {
  test('despacha desde el LPN hacia Sur → Sur (usuario distinto) confirma la recepción', async ({ page, request, browser }) => {
    test.setTimeout(120_000) // producto + ingreso + mover + login de un 2do usuario + recepción

    const emailSur = process.env.E2E_DEPOSITO_SUR_EMAIL
    const passwordSur = process.env.E2E_DEPOSITO_SUR_PASSWORD
    test.skip(!emailSur || !passwordSur, 'Faltan E2E_DEPOSITO_SUR_EMAIL/PASSWORD en .env.test.local')

    const nombreProducto = `E2E MoverCrossSuc ${Date.now()}`

    // Sucursal activa del OWNER fija = Norte (origen)
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)

    // 1) Crear producto + ingreso de 5 u. en Sucursal Norte (mismo patrón que el spec 92)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /^Crear producto$/ }).click()
    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })

    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()
    await page.waitForTimeout(400)
    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
    await ingresoBtn.click()
    await page.waitForTimeout(400)

    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscador).toBeVisible({ timeout: 6000 })
    await buscador.fill(nombreProducto)
    await page.waitForTimeout(900)
    const modalIngreso = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
    await modalIngreso.getByText(nombreProducto).first().click()
    await page.waitForTimeout(500)
    const sucSelectIngreso = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelectIngreso.isVisible().catch(() => false)) await sucSelectIngreso.selectOption(NORTE)
    const cantidadIngreso = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidadIngreso).toBeVisible({ timeout: 5000 })
    await cantidadIngreso.fill('5')
    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 2) Abrir Acciones del LPN → tab Mover → elegir Sucursal destino = SUR
    await goto(page, '/inventario')
    await waitForApp(page)
    const buscadorInv = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i).first()
    await expect(buscadorInv).toBeVisible({ timeout: 8000 })
    await buscadorInv.fill(nombreProducto)
    await page.waitForTimeout(700)
    await page.getByText(nombreProducto, { exact: true }).first().click()
    await page.waitForTimeout(400)
    await page.getByTitle('Acciones sobre este LPN').first().click()
    await page.getByRole('button', { name: /^Mover$/ }).click()

    const cantMoverInput = page.getByPlaceholder('Ingresá una cantidad')
    await expect(cantMoverInput).toBeVisible({ timeout: 5000 })
    await cantMoverInput.fill('2')

    const sucDestinoSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following-sibling::select[1]')
    await expect(sucDestinoSelect).toBeVisible({ timeout: 5000 })
    await sucDestinoSelect.selectOption(SUR)

    // El aviso debe cambiar a "genera un traslado" apenas se elige otra sucursal
    await expect(page.getByText(/genera un traslado/i)).toBeVisible({ timeout: 5000 })

    const ubicDestinoSelect = page.locator('xpath=//label[contains(.,"Ubicación destino")]/following-sibling::select[1]')
    await expect
      .poll(() => ubicDestinoSelect.locator('option').count(), {
        timeout: 8000,
        message: '[93] "Ubicación destino" no repobló con las ubicaciones de Sucursal Sur tras cambiar la sucursal destino',
      })
      .toBeGreaterThan(1)
    const opcionesSur = await ubicDestinoSelect.locator('option').evaluateAll(
      opts => (opts as HTMLOptionElement[]).map(o => ({ value: o.value, label: o.textContent })).filter(o => o.value),
    )
    const ubicacionElegidaId = opcionesSur[0].value
    await ubicDestinoSelect.selectOption(ubicacionElegidaId)

    const despacharBtn = page.getByRole('button', { name: /^Despachar traslado$/ })
    await expect(despacharBtn).toBeVisible({ timeout: 5000 })
    await despacharBtn.click()
    await expect(page.getByText(/Traslado #\d+ despachado.*en tránsito/i)).toBeVisible({ timeout: 12000 })

    // 3) POSITIVO (origen) — el traslado quedó en_transito, el stock salió de Norte
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[93] no se encontró el producto por REST').toBeTruthy()

    const trasladosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/traslados?sucursal_origen_id=eq.${NORTE}&sucursal_destino_id=eq.${SUR}&estado=eq.en_transito` +
        `&order=created_at.desc&limit=1&select=id,numero,traslado_items(id,producto_id,cantidad,ubicacion_sugerida_id)`,
      { headers },
    )
    const [traslado] = (await trasladosRes.json()) as Array<{
      id: string; numero: number
      traslado_items: Array<{ id: string; producto_id: string; cantidad: number; ubicacion_sugerida_id: string | null }>
    }>
    expect(traslado, '[93] no se encontró el traslado en_transito recién despachado').toBeTruthy()
    const item = traslado.traslado_items.find(it => it.producto_id === prod.id)
    expect(item, '[93] el traslado no tiene el ítem de este producto').toBeTruthy()
    expect(item!.cantidad, '[93] cantidad despachada debería ser 2').toBe(2)
    expect(item!.ubicacion_sugerida_id, '[93] debería haber quedado la ubicación elegida al despachar (mig 276)').toBe(ubicacionElegidaId)

    const lineasOrigenRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&sucursal_id=eq.${NORTE}&activo=eq.true&select=cantidad`,
      { headers },
    )
    const lineasOrigen = (await lineasOrigenRes.json()) as Array<{ cantidad: number }>
    const totalOrigen = lineasOrigen.reduce((a, l) => a + l.cantidad, 0)
    expect(totalOrigen, '[93] el origen debería haber quedado con 3 u. (5 - 2 despachadas)').toBe(3)

    const lineasDestinoAntesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&sucursal_id=eq.${SUR}&activo=eq.true&select=id`,
      { headers },
    )
    expect(
      (await lineasDestinoAntesRes.json()) as unknown[],
      '[93] NO debe haber stock en Sur todavía — recién se despachó, falta confirmar recepción',
    ).toHaveLength(0)

    // 4) Un usuario REAL de Sucursal Sur (no el owner) confirma la recepción.
    // `browser.newContext()` hereda por defecto el `use.storageState` del PROYECTO de Playwright
    // (acá, la sesión ya logueada del OWNER en `chromium`) si no se lo pisa explícitamente — sin
    // esto el "contexto nuevo" en realidad seguía autenticado como OWNER, no como el usuario Sur.
    // Tampoco hereda `use.baseURL`, así que el goto relativo necesita la base explícita.
    const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
    const contextSur = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } })
    const pageSur = await contextSur.newPage()
    await pageSur.goto('/login')
    await pageSur.getByLabel(/email/i).fill(emailSur!)
    await pageSur.getByLabel(/contraseña|password/i).fill(passwordSur!)
    await pageSur.getByRole('button', { name: /ingresar|iniciar sesión|login/i }).click()
    await pageSur.waitForURL('**/inventario', { timeout: 15000 })
    // Primer login de este usuario en un contexto nuevo → dispara el tour de bienvenida
    // (mismo dismiss que usan auth.*.setup.ts para los demás roles de prueba).
    await pageSur.evaluate(() => localStorage.setItem('genesis360_walkthrough_v1', 'seen'))
    await pageSur.reload()
    await waitForApp(pageSur)

    await pageSur.getByRole('button', { name: /^Traslados$/ }).first().click()
    await pageSur.waitForTimeout(800)
    await expect(pageSur.getByText(new RegExp(`Traslado.*en tránsito hacia tu sucursal`, 'i'))).toBeVisible({ timeout: 10000 })

    const confirmarLista = pageSur.getByRole('button', { name: /Confirmar recepción/i }).first()
    await expect(confirmarLista).toBeVisible({ timeout: 10000 })
    await confirmarLista.click()
    await expect(pageSur.getByText(new RegExp(`Confirmar recepción — Traslado #${traslado.numero}`))).toBeVisible({ timeout: 5000 })

    // La ubicación elegida al despachar debe venir PRECARGADA (mig 276) — el destino puede
    // cambiarla, no es vinculante, pero no debe arrancar en blanco.
    const ubicRecepcionSelect = pageSur.locator('xpath=//label[contains(.,"Ubicación destino")]/following-sibling::select[1]')
    await expect(ubicRecepcionSelect).toHaveValue(ubicacionElegidaId, { timeout: 8000 })

    await pageSur.getByRole('button', { name: /Confirmar recepción/i }).last().click()
    await expect(pageSur.getByText(/Traslado #\d+ recibido completo/i)).toBeVisible({ timeout: 15000 })
    await contextSur.close()

    // 5) POSITIVO (destino) — el stock entró a Sur con la ubicación correcta
    const lineasDestinoRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&sucursal_id=eq.${SUR}&activo=eq.true&select=cantidad,ubicacion_id`,
      { headers },
    )
    const lineasDestino = (await lineasDestinoRes.json()) as Array<{ cantidad: number; ubicacion_id: string | null }>
    expect(lineasDestino, '[93] debería haber quedado 1 línea nueva en Sur').toHaveLength(1)
    expect(lineasDestino[0].cantidad, '[93] la línea en Sur debería tener las 2 u. recibidas').toBe(2)
    expect(lineasDestino[0].ubicacion_id, '[93] debería haber quedado en la ubicación confirmada').toBe(ubicacionElegidaId)

    const trasladoFinalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/traslados?id=eq.${traslado.id}&select=estado`,
      { headers },
    )
    const [trasladoFinal] = (await trasladoFinalRes.json()) as Array<{ estado: string }>
    expect(trasladoFinal.estado, '[93] el traslado debería haber quedado "recibido" (completo, sin faltante)').toBe('recibido')
  })
})
