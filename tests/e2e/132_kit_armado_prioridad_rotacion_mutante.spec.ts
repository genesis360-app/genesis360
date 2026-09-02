/**
 * 132_kit_armado_prioridad_rotacion_mutante.spec.ts
 * E2E MUTANTE — Motor de Rotación, Opción 3 (E3): al iniciar el armado de un KIT, si el
 * componente tiene la regla "armar kits" activa (`fn_rotacion_reglas_efectivas`), el lote en un
 * estado que dispara Rotación se reserva ANTES que un lote más viejo en estado normal — arregla
 * el gap técnico confirmado en el relevamiento (`iniciar_armado_kit` era FIFO ciego al estado_id).
 *
 * Genera su propia precondición: estado nuevo con `dispara_rotacion=true` (por REST) + producto
 * componente nuevo con `rotacion_armar_kits=true` (por REST) + producto KIT nuevo con una receta
 * de 1 componente x2 (por REST — la receta en sí no es el código bajo prueba) + DOS ingresos
 * REALES por UI del componente: primero al estado normal "Disponible" (línea más VIEJA), después
 * al estado de Rotación (línea más NUEVA). El armado se dispara desde la UI real (Inventario →
 * Kits → Armar), no llamando la RPC a mano — mismo flujo que un operador real.
 *
 * Verifica en DB: `iniciar_armado_kit` solo RESERVA (`cantidad_reservada`), no rebaja todavía —
 * la línea del estado normal queda con `cantidad_reservada=0` (intacta) y la línea de Rotación
 * queda con `cantidad_reservada` = cantidad de receta × cantidad de KITs armados.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, ingresoRealPorUI } from './helpers/fixtures'

test.describe('Motor de Rotación — armado de KIT prioriza el lote en descuento (mutante)', () => {
  test('iniciar armado reserva del lote de Rotación antes que del lote viejo normal', async ({ page, request }) => {
    test.setTimeout(120000)
    const sufijo = Date.now()
    const nombreEstadoRot = `E2E Rotación Kit ${sufijo}`
    const nombreComponente = `E2E KitComponente ${sufijo}`
    const nombreKit = `E2E KitProducto ${sufijo}`
    const CANT_RECETA = 2   // unidades de componente por 1 KIT
    const CANT_NORMAL = 10
    const CANT_ROTACION = 6
    const CANT_KITS_ARMAR = 1

    // 1) Login ya está en storageState — token para sembrar por REST
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 2) Estado NUEVO que dispara Rotación (no toca estados compartidos de otros specs)
    const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/estados_inventario?select=tenant_id&limit=1`, { headers })
    const [{ tenant_id: tenantId }] = (await tenantRes.json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[132] no se pudo resolver el tenant_id del usuario e2e').toBeTruthy()

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers,
      data: { tenant_id: tenantId, nombre: nombreEstadoRot, color: '#10b981', es_disponible_venta: true, dispara_rotacion: true },
    })
    expect(estadoRes.ok(), `[132] no se pudo crear el estado de Rotación: ${await estadoRes.text()}`).toBe(true)
    const [estadoRot] = (await estadoRes.json()) as Array<{ id: string }>
    expect(estadoRot, '[132] insert de estado no devolvió fila').toBeTruthy()

    // 3) Producto COMPONENTE nuevo, con rotacion_armar_kits=true a nivel SKU (jerarquía A3 de la
    //    mig 341, sin depender de categoría/tenant)
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
    expect(componente, '[132] no se encontró el producto componente recién creado').toBeTruthy()

    const patchComp = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${componente.id}`, {
      headers, data: { precio_venta: 100, precio_costo: 60, rotacion_armar_kits: true },
    })
    expect(patchComp.ok(), '[132] no se pudo fijar rotacion_armar_kits del componente').toBe(true)

    // 4) Producto KIT nuevo, marcado es_kit=true (checkbox no es el código bajo prueba → por REST)
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
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreKit)}&select=id`,
      { headers },
    )
    const [kit] = (await kitRes.json()) as Array<{ id: string }>
    expect(kit, '[132] no se encontró el producto KIT recién creado').toBeTruthy()

    const patchKit = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${kit.id}`, {
      headers, data: { es_kit: true, precio_venta: 250 },
    })
    expect(patchKit.ok(), '[132] no se pudo marcar es_kit=true').toBe(true)

    // 5) Receta: 1 KIT = CANT_RECETA unidades del componente
    const recetaRes = await request.post(`${SUPABASE_URL}/rest/v1/kit_recetas`, {
      headers, data: { tenant_id: tenantId, kit_producto_id: kit.id, comp_producto_id: componente.id, cantidad: CANT_RECETA },
    })
    expect(recetaRes.ok(), `[132] no se pudo crear la receta: ${await recetaRes.text()}`).toBe(true)

    // 6) Ingreso REAL por UI del COMPONENTE — PRIMERO al estado normal (línea más VIEJA), DESPUÉS
    //    al estado de Rotación (línea más NUEVA). Ubicación fija "RACK2" (no mono_sku, sin tope de
    //    pallets) — ver el comentario de ingresoRealPorUI sobre la trampa de la primera opción.
    await ingresoRealPorUI(page, { nombreProducto: nombreComponente, cantidad: CANT_NORMAL, estadoNombre: 'Disponible', ubicacionNombre: 'RACK2' })
    await ingresoRealPorUI(page, { nombreProducto: nombreComponente, cantidad: CANT_ROTACION, estadoNombre: nombreEstadoRot, ubicacionNombre: 'RACK2' })

    // Snapshot pre-armado: 2 líneas del componente, la de Rotación es la más NUEVA — si esto no se
    // cumple, la precondición del test está mal armada, no el código bajo prueba.
    const lineasPreRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${componente.id}&activo=eq.true` +
        `&select=id,cantidad,cantidad_reservada,created_at,estado_id&order=created_at.asc`,
      { headers },
    )
    const lineasPre = (await lineasPreRes.json()) as Array<{ id: string; cantidad: number; cantidad_reservada: number | null; created_at: string; estado_id: string }>
    expect(lineasPre.length, `[132] se esperaban 2 líneas del componente, hay ${lineasPre.length}`).toBe(2)
    const lineaNormal = lineasPre.find(l => l.estado_id !== estadoRot.id)
    const lineaRot = lineasPre.find(l => l.estado_id === estadoRot.id)
    expect(lineaNormal, '[132] no se encontró la línea del estado normal').toBeTruthy()
    expect(lineaRot, '[132] no se encontró la línea del estado de Rotación').toBeTruthy()
    expect(lineaNormal!.cantidad_reservada ?? 0, '[132] la línea normal no debería tener reserva previa').toBe(0)
    expect(lineaRot!.cantidad_reservada ?? 0, '[132] la línea de Rotación no debería tener reserva previa').toBe(0)
    expect(
      new Date(lineaRot!.created_at).getTime(),
      '[132] la línea de Rotación debe ser la MÁS NUEVA (si no, FIFO plano la elegiría igual y el test no probaría nada)',
    ).toBeGreaterThan(new Date(lineaNormal!.created_at).getTime())

    // 7) Flujo real de UI: Inventario → Kits → expandir el KIT → Armar → confirmar cantidad
    await goto(page, '/inventario')
    await waitForApp(page)
    const tabKits = page.getByRole('button', { name: 'Kits' })
    await expect(tabKits).toBeVisible({ timeout: 8000 })
    await tabKits.click()

    const buscadorKit = page.getByPlaceholder(/Buscar KIT por nombre o SKU/i)
    await expect(buscadorKit).toBeVisible({ timeout: 8000 })
    await buscadorKit.fill(nombreKit)

    const filaKit = page.locator('div').filter({ hasText: nombreKit }).filter({ has: page.getByRole('button', { name: 'Armar', exact: true }) }).last()
    await expect(filaKit, `[132] no apareció la fila del KIT "${nombreKit}" en la lista`).toBeVisible({ timeout: 10000 })
    const btnArmar = filaKit.getByRole('button', { name: 'Armar', exact: true })
    await expect(btnArmar).toBeEnabled({ timeout: 8000 })
    await btnArmar.click()

    const modalArmado = page.getByRole('heading', { name: 'Iniciar Armado' })
    await expect(modalArmado).toBeVisible({ timeout: 8000 })
    const cantInput = page.locator('xpath=//label[contains(.,"Cantidad de KITs a armar")]/following::input[1]')
    await cantInput.fill(String(CANT_KITS_ARMAR))
    const btnIniciar = page.getByRole('button', { name: /Iniciar armado/i })
    await expect(btnIniciar).toBeEnabled({ timeout: 5000 })
    await btnIniciar.click()
    await expect(page.getByText(/Armado iniciado/i)).toBeVisible({ timeout: 12000 })

    // 8) POSITIVO en DB — la línea normal (más vieja) sigue SIN reserva, la de Rotación (más
    // nueva) quedó reservada por CANT_RECETA × CANT_KITS_ARMAR unidades.
    const lineasPostRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=in.(${lineaNormal!.id},${lineaRot!.id})&select=id,cantidad_reservada`,
      { headers },
    )
    const lineasPost = (await lineasPostRes.json()) as Array<{ id: string; cantidad_reservada: number | null }>
    const normalPost = lineasPost.find(l => l.id === lineaNormal!.id)
    const rotPost = lineasPost.find(l => l.id === lineaRot!.id)
    expect(
      normalPost?.cantidad_reservada ?? 0,
      '[132] la línea del estado NORMAL (más vieja) no debía reservarse — Rotación tenía que priorizarse antes que FIFO plano',
    ).toBe(0)
    expect(
      rotPost?.cantidad_reservada,
      `[132] la línea del estado de Rotación (más nueva) debía reservar ${CANT_RECETA * CANT_KITS_ARMAR} unidades — es la que tiene que salir primero al armar el KIT`,
    ).toBe(CANT_RECETA * CANT_KITS_ARMAR)

    // 9) El log de kitting quedó trazado con la reserva sobre la línea correcta
    const kittingLogRes = await request.get(
      `${SUPABASE_URL}/rest/v1/kitting_log?kit_producto_id=eq.${kit.id}&estado=eq.en_armado&select=componentes_reservados&order=created_at.desc&limit=1`,
      { headers },
    )
    expect(kittingLogRes.ok(), `[132] no se pudo leer kitting_log: ${await kittingLogRes.text()}`).toBe(true)
    const [logRow] = (await kittingLogRes.json()) as Array<{ componentes_reservados: Array<{ linea_id: string; cantidad: number }> }>
    expect(logRow, '[132] no se encontró el kitting_log del armado recién iniciado').toBeTruthy()
    expect(logRow.componentes_reservados.length, '[132] se esperaba una sola línea reservada (la de Rotación alcanzaba sola)').toBe(1)
    expect(logRow.componentes_reservados[0].linea_id, '[132] el kitting_log debe apuntar a la línea de Rotación').toBe(lineaRot!.id)
  })
})
