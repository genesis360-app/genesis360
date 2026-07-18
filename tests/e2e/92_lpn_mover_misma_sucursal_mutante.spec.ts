/**
 * 92_lpn_mover_misma_sucursal_mutante.spec.ts
 * E2E MUTANTE — LpnAccionesModal → tab "Mover", reubicación DENTRO de la misma sucursal.
 *
 * Cierra el gap de cobertura que dejaba UAT §33 ítem #8 ("Código — sin e2e dedicado") y sirve
 * de regresión de control para el fix de la ubicación-destino-por-sucursal (GO, 2026-07-18):
 * cuando NO se cambia la sucursal destino, "Ubicación destino" debe seguir ofreciendo las
 * ubicaciones de la sucursal ACTUAL de la línea (nunca vacío) y el movimiento debe seguir siendo
 * la reubicación directa de siempre — sin generar ningún traslado.
 *
 * Genera su propia precondición: producto nuevo + ingreso real en Sucursal Norte, mueve una
 * cantidad parcial a otra ubicación de la MISMA sucursal, y verifica por REST que: (a) el LPN
 * original quedó con la cantidad reducida, (b) se creó un LPN nuevo en la ubicación elegida con
 * el mismo sucursal_id, (c) NO se creó ningún traslado para este producto (root del bug real:
 * antes del fix, mover a otra sucursal creaba stock directo sin traslado — acá se confirma que
 * el camino "misma sucursal" nunca pasa por esa rama).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('LpnAccionesModal → Mover dentro de la misma sucursal (mutante)', () => {
  test('mover parcial a otra ubicación de Sucursal Norte reubica directo, sin traslado', async ({ page, request }) => {
    const nombreProducto = `E2E MoverMismaSuc ${Date.now()}`

    // Sucursal activa fija = Norte (mismo patrón que el spec 30)
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)

    // 1) Crear producto nuevo (sin atributos de variante — no es el foco de este spec)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /^Crear producto$/ }).click()
    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })

    // 2) Ingreso de 5 unidades en Sucursal Norte
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
    const resultado = modalIngreso.getByText(nombreProducto).first()
    await expect(resultado).toBeVisible({ timeout: 6000 })
    await resultado.click()
    await page.waitForTimeout(500)

    const sucSelectIngreso = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelectIngreso.isVisible().catch(() => false)) {
      await sucSelectIngreso.selectOption(NORTE)
    }
    const cantidadIngreso = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidadIngreso).toBeVisible({ timeout: 5000 })
    await cantidadIngreso.fill('5')
    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 3) Abrir el producto en el listado de Inventario y sus acciones de LPN
    await goto(page, '/inventario')
    await waitForApp(page)
    const buscadorInv = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i).first()
    await expect(buscadorInv).toBeVisible({ timeout: 8000 })
    await buscadorInv.fill(nombreProducto)
    await page.waitForTimeout(700)
    await page.getByText(nombreProducto, { exact: true }).first().click()
    await page.waitForTimeout(400)

    const accionesBtn = page.getByTitle('Acciones sobre este LPN').first()
    await expect(accionesBtn).toBeVisible({ timeout: 8000 })
    await accionesBtn.click()

    // 4) Tab "Mover" — NO tocar "Sucursal destino" (queda en la actual = Norte)
    await page.getByRole('button', { name: /^Mover$/ }).click()
    const cantMoverInput = page.getByPlaceholder('Ingresá una cantidad')
    await expect(cantMoverInput).toBeVisible({ timeout: 5000 })
    await cantMoverInput.fill('2')

    const ubicDestinoSelect = page.locator('xpath=//label[contains(.,"Ubicación destino")]/following-sibling::select[1]')
    await expect(ubicDestinoSelect).toBeVisible({ timeout: 5000 })
    // poll: la query ubicaciones-destino-lpn fetchea recién al entrar al tab "Mover" — un
    // evaluateAll() inmediato puede leer el <select> antes de que resuelva (carrera, no bug).
    await expect
      .poll(() => ubicDestinoSelect.locator('option').count(), {
        timeout: 8000,
        message: '[92] "Ubicación destino" vino vacío para la sucursal ACTUAL de la línea — no debería pasar nunca (regresión del fix de scoping por sucursal)',
      })
      .toBeGreaterThan(1) // 1 = solo "Seleccioná ubicación..."
    const opcionesUbic = await ubicDestinoSelect.locator('option').evaluateAll(
      opts => (opts as HTMLOptionElement[]).map(o => ({ value: o.value, label: o.textContent })).filter(o => o.value),
    )
    await ubicDestinoSelect.selectOption(opcionesUbic[0].value)

    // No debe aparecer el aviso de traslado — es reubicación directa
    await expect(page.getByText(/genera un traslado/i)).not.toBeVisible()

    const confirmarBtn = page.getByRole('button', { name: /^Confirmar traslado$/ })
    await expect(confirmarBtn).toBeVisible({ timeout: 5000 })
    await confirmarBtn.click()
    await expect(page.getByText(/Stock movido — nuevo LPN creado/i)).toBeVisible({ timeout: 10000 })

    // 5) POSITIVO — verificar por REST el efecto real en la base
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[92] no se encontró el producto recién creado por REST').toBeTruthy()

    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&activo=eq.true&select=id,cantidad,sucursal_id,ubicacion_id`,
      { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ id: string; cantidad: number; sucursal_id: string | null; ubicacion_id: string | null }>
    expect(lineas.length, '[92] deberían quedar 2 líneas activas: la original reducida + la nueva movida').toBe(2)

    const original = lineas.find(l => l.cantidad === 3)
    const nueva = lineas.find(l => l.cantidad === 2)
    expect(original, '[92] la línea original debería haber quedado en 3 u. (5 - 2)').toBeTruthy()
    expect(nueva, '[92] debería existir una línea nueva con las 2 u. movidas').toBeTruthy()
    expect(nueva!.sucursal_id, '[92] la reubicación dentro de la misma sucursal NO debe cambiar sucursal_id').toBe(NORTE)
    expect(nueva!.ubicacion_id, '[92] la línea nueva debe quedar en la ubicación elegida').toBe(opcionesUbic[0].value)

    // NO debe haberse generado ningún traslado para este movimiento (es reubicación directa)
    const trasladosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/traslado_items?producto_id=eq.${prod.id}&select=id`,
      { headers },
    )
    const trasladoItems = (await trasladosRes.json()) as Array<{ id: string }>
    expect(trasladoItems.length, '[92] mover dentro de la misma sucursal NO debe generar traslado_items').toBe(0)
  })
})
