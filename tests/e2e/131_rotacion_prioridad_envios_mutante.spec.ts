/**
 * 131_rotacion_prioridad_envios_mutante.spec.ts
 * E2E MUTANTE — Motor de Rotación, Opción 2 (D1-D3): en una venta con envío/reserva (canal
 * no-presencial), el lote en un estado con `dispara_rotacion=true` se despacha ANTES que un
 * lote más viejo en el estado normal, cuando el producto tiene `rotacion_prioridad_envios=true`.
 *
 * Genera su propia precondición: estado nuevo con `dispara_rotacion=true` (por REST, no toca
 * estados compartidos) + producto nuevo con `rotacion_prioridad_envios=true` + DOS ingresos
 * REALES por UI (flujo real de ingreso, no INSERT directo): primero al estado normal
 * "Disponible" (línea más VIEJA → FIFO plano la elegiría primero), después al estado de
 * Rotación (línea más NUEVA). Flujo real de POS: agregar el producto al carrito PRIMERO
 * (como haría un cajero) y recién después elegir el canal "WhatsApp" — así se prueba el orden
 * de operaciones real, no uno artificialmente favorable al código.
 *
 * Verifica en DB (REGLA #0: la trazabilidad de qué LPN salió tiene que ser la real, no la
 * asumida): la línea del estado normal queda INTACTA y `venta_item_despachos.linea_id` apunta
 * a la línea del estado de Rotación, no a la más vieja.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta, ingresoRealPorUI, visible,
} from './helpers/fixtures'

test.describe('Motor de Rotación — prioridad de envíos (mutante)', () => {
  test('venta por canal no-presencial despacha del lote en Rotación antes que del lote viejo normal', async ({ page, request }) => {
    test.setTimeout(120000)
    const sufijo = Date.now()
    const nombreEstadoRot = `E2E Rotación Envíos ${sufijo}`
    const nombreProducto = `E2E PrioridadEnvios ${sufijo}`
    const PRECIO = 500
    const CANT_NORMAL = 5
    const CANT_ROTACION = 3
    const CANT_VENTA = 2

    // 1) Login ya está en storageState — token para sembrar por REST
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 2) Estado NUEVO que dispara Rotación (no toca estados compartidos de otros specs)
    const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/estados_inventario?select=tenant_id&limit=1`, { headers })
    const [{ tenant_id: tenantId }] = (await tenantRes.json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[131] no se pudo resolver el tenant_id del usuario e2e').toBeTruthy()

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers,
      data: { tenant_id: tenantId, nombre: nombreEstadoRot, color: '#3b82f6', es_disponible_venta: true, dispara_rotacion: true },
    })
    expect(estadoRes.ok(), `[131] no se pudo crear el estado de Rotación: ${await estadoRes.text()}`).toBe(true)
    const [estadoRot] = (await estadoRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(estadoRot, '[131] insert de estado no devolvió fila').toBeTruthy()

    // 3) Producto nuevo con precio conocido + rotacion_prioridad_envios=true (nivel SKU, sin
    //    depender de categoría/tenant — jerarquía A3 de la mig 341)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,tenant_id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(prod, '[131] no se encontró el producto recién creado por REST').toBeTruthy()

    const patchRes = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prod.id}`, {
      headers, data: { precio_venta: PRECIO, precio_costo: PRECIO * 0.6, rotacion_prioridad_envios: true },
    })
    expect(patchRes.ok(), '[131] no se pudo fijar precio_venta/rotacion_prioridad_envios').toBe(true)

    // 4) Ingreso REAL por UI — PRIMERO al estado normal (línea más VIEJA, FIFO plano la
    //    consumiría primero), DESPUÉS al estado de Rotación (línea más NUEVA). El orden temporal
    //    real (segundo ingreso = created_at mayor) es lo que hace la prueba válida.
    //    Ubicación fija "RACK2" (no mono_sku, sin tope de pallets) — la primera opción real del
    //    combo es mono_sku y queda reclamada por el primer producto que entra ahí (ver comentario
    //    en ingresoRealPorUI).
    await ingresoRealPorUI(page, { nombreProducto, cantidad: CANT_NORMAL, estadoNombre: 'Disponible', ubicacionNombre: 'RACK2' })
    await ingresoRealPorUI(page, { nombreProducto, cantidad: CANT_ROTACION, estadoNombre: nombreEstadoRot, ubicacionNombre: 'RACK2' })

    // Snapshot pre-venta: exactamente 2 líneas, la de Rotación es la más NUEVA (created_at mayor)
    // — si esto no se cumple, la precondición del test está mal armada, no el código bajo prueba.
    const lineasPreRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&activo=eq.true` +
        `&select=id,cantidad,created_at,estado_id&order=created_at.asc`,
      { headers },
    )
    const lineasPre = (await lineasPreRes.json()) as Array<{ id: string; cantidad: number; created_at: string; estado_id: string }>
    expect(lineasPre.length, `[131] se esperaban 2 líneas de inventario, hay ${lineasPre.length}`).toBe(2)
    const lineaNormal = lineasPre.find(l => l.estado_id !== estadoRot.id)
    const lineaRot = lineasPre.find(l => l.estado_id === estadoRot.id)
    expect(lineaNormal, '[131] no se encontró la línea del estado normal').toBeTruthy()
    expect(lineaRot, '[131] no se encontró la línea del estado de Rotación').toBeTruthy()
    expect(lineaNormal!.cantidad, '[131] cantidad inicial de la línea normal').toBe(CANT_NORMAL)
    expect(lineaRot!.cantidad, '[131] cantidad inicial de la línea de Rotación').toBe(CANT_ROTACION)
    expect(
      new Date(lineaRot!.created_at).getTime(),
      '[131] la línea de Rotación debe ser la MÁS NUEVA (si no, FIFO plano la elegiría igual y el test no probaría nada)',
    ).toBeGreaterThan(new Date(lineaNormal!.created_at).getTime())

    // 5) Flujo real de POS — agregar el producto al carrito PRIMERO (como haría un cajero,
    //    antes de saber por qué canal factura), recién DESPUÉS elegir el canal "WhatsApp".
    //    Esto es a propósito el orden que puede exponer el gap: si el plan de LPN del carrito
    //    (`lpn_fuentes`) se calculó al agregar el producto SIN saber todavía que el canal iba a
    //    ser no-presencial, ¿el motor lo corrige igual en `registrarVenta`, o quedó fijado?
    await garantizarCajaAbierta(page)
    await goto(page, '/ventas')
    await waitForApp(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()

    const buscadorPOS = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscadorPOS).toBeVisible({ timeout: 8000 })
    await buscadorPOS.fill(nombreProducto)
    const prodBtn = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: nombreProducto }).first()
    await expect(prodBtn).toBeVisible({ timeout: 10000 })
    await prodBtn.click()
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })

    // Subir la cantidad del carrito a CANT_VENTA (se agrega con 1 por default)
    const btnMas = page.getByTitle('Aumentar cantidad').first()
    const cantInput = page.locator('input[inputmode="numeric"], input[inputmode="decimal"]').first()
    await expect(btnMas).toBeVisible({ timeout: 5000 })
    for (let i = 1; i < CANT_VENTA; i++) {
      await btnMas.click()
      await expect(cantInput).toHaveValue(String(i + 1), { timeout: 5000 })
    }

    // Canal de venta = WhatsApp (online → no-presencial) — recién ACÁ, después de agregar el
    // producto. El <select> carga sus opciones por react-query; esperar la opción real, no un
    // timeout fijo (obstáculo #3 documentado en la sesión anterior).
    const canalSelect = page.locator('xpath=//label[contains(.,"Canal de venta")]/following::select[1]')
    await expect(canalSelect).toBeVisible({ timeout: 8000 })
    await expect(
      canalSelect.locator('option[value="WhatsApp"]'),
      '[131] el canal "WhatsApp" no apareció en el selector a tiempo',
    ).toBeAttached({ timeout: 8000 })
    await canalSelect.selectOption('WhatsApp')

    // 6) Cobrar en efectivo y finalizar como "Venta directa" (despachada)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await visible(cajaSelect, 2000)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const totalEsperado = CANT_VENTA * PRECIO
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(totalEsperado + 1000))
    await montoInput.blur()

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 7) POSITIVO en DB — la línea normal (más vieja) queda INTACTA, la de Rotación (más nueva)
    // pierde exactamente CANT_VENTA, y el despacho quedó trazado sobre la línea de Rotación.
    const lineasPostRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=in.(${lineaNormal!.id},${lineaRot!.id})&select=id,cantidad`,
      { headers },
    )
    const lineasPost = (await lineasPostRes.json()) as Array<{ id: string; cantidad: number }>
    const normalPost = lineasPost.find(l => l.id === lineaNormal!.id)
    const rotPost = lineasPost.find(l => l.id === lineaRot!.id)
    expect(
      normalPost?.cantidad,
      `[131] la línea del estado NORMAL (más vieja) no debía tocarse — Rotación tenía que priorizarse antes que FIFO plano`,
    ).toBe(CANT_NORMAL)
    expect(
      rotPost?.cantidad,
      `[131] la línea del estado de Rotación (más nueva) debía perder ${CANT_VENTA} unidades — es la que tiene que salir primero en un envío/reserva`,
    ).toBe(CANT_ROTACION - CANT_VENTA)

    const despachosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_item_despachos?producto_id=eq.${prod.id}&select=linea_id,cantidad&order=created_at.desc`,
      { headers },
    )
    expect(despachosRes.ok(), `[131] no se pudo leer venta_item_despachos: ${await despachosRes.text()}`).toBe(true)
    const despachos = (await despachosRes.json()) as Array<{ linea_id: string; cantidad: number }>
    expect(despachos.length, '[131] se esperaba exactamente 1 fila de despacho (una sola línea alcanzaba)').toBe(1)
    expect(
      despachos[0].linea_id,
      '[131] el despacho tiene que salir de la línea de Rotación, no de la normal/vieja',
    ).toBe(lineaRot!.id)
    expect(despachos[0].cantidad).toBe(CANT_VENTA)
  })
})
