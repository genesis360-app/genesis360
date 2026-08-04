/**
 * 120_tier_trigger_cross_producto_spec.ts
 * E2E (REST-only, sin UI) — TIER-09 + APROB-09: dos guards de integridad server-side del backlog
 * Comercial de Fede (Fases A y B).
 *
 * TIER-09: el FK de `producto_precios_mayorista.presentacion_id` no alcanza para impedir enlazar la
 * presentación de OTRO producto (ni de otro tenant, ya que los checks de FK no pasan por RLS) —
 * `trg_ppm_presentacion_mismo_producto` (mig 329) rechaza el INSERT/UPDATE con `RAISE EXCEPTION`.
 *
 * APROB-09: el gate de aprobación de cambio de estado (Fase B, mig 331) vivía 100% en el cliente —
 * un `PATCH` directo por REST a `inventario_lineas.estado_id` se saltaba foto+autorización
 * (hallazgo H1). `fn_inventario_estado_aprobacion_guard` (mig 333) lo bloquea server-side para un
 * actor en modo 'siempre' (no-DUEÑO, config default) y — complemento del caso positivo — DEJA PASAR
 * el mismo PATCH para un actor en modo 'directo' (DUEÑO, config default, H2) para no dejar cubierta
 * solo la mitad del guard.
 *
 * `loginToken(request, email, password)` autentica un rol DISTINTO por REST, independiente de bajo
 * qué proyecto de Playwright corre este spec (mismo patrón que el spec 94) — no hace falta el
 * storageState de un rol no-DUEÑO para probar el guard server-side.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, loginToken,
  sembrarPresentaciones, leerPresentaciones,
} from './helpers/fixtures'

test.describe('Guards server-side — tier cross-producto y aprobación de estado (REST-only)', () => {
  test('TIER-09: el trigger rechaza enlazar en un tier la presentación de OTRO producto', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const [{ tenant_id: tenantId }] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[120] no se pudo resolver el tenant_id').toBeTruthy()

    const crearProducto = async (nombre: string) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
        headers, data: { tenant_id: tenantId, nombre, sku: `${nombre}-SKU`, precio_costo: 60, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
      })
      expect(res.ok(), `[120] no se pudo crear "${nombre}": ${await res.text()}`).toBe(true)
      return ((await res.json()) as Array<{ id: string }>)[0]
    }
    const productoA = await crearProducto(`E2E TierA 120 ${ts}`)
    const productoB = await crearProducto(`E2E TierB 120 ${ts}`)

    await sembrarPresentaciones(request, token, productoA.id, 'Unidad', [{ etiqueta: 'Caja', factor_base: 10, padre_idx: 0 }])
    await sembrarPresentaciones(request, token, productoB.id, 'Unidad', [{ etiqueta: 'Caja', factor_base: 10, padre_idx: 0 }])
    const presA = await leerPresentaciones(request, token, productoA.id)
    const presB = await leerPresentaciones(request, token, productoB.id)
    const cajaA = presA.find(p => p.etiqueta === 'Caja')
    const cajaB = presB.find(p => p.etiqueta === 'Caja')
    expect(cajaA, '[120] no se sembró la línea "Caja" de A').toBeTruthy()
    expect(cajaB, '[120] no se sembró la línea "Caja" de B').toBeTruthy()

    // POSITIVO: un tier de A enlazado a SU PROPIA presentación se permite.
    const okRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: { tenant_id: tenantId, producto_id: productoA.id, cantidad_minima: 1, precio: 5, presentacion_id: cajaA!.id },
    })
    expect(okRes.ok(), `[120] un tier de A enlazado a su propia presentación debe permitirse: ${await okRes.text()}`).toBe(true)
    const [tierA] = (await okRes.json()) as Array<{ id: string }>

    // 🛑 NEGATIVO — INSERT: tier de A enlazado a la presentación de B.
    const badInsertRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: { tenant_id: tenantId, producto_id: productoA.id, cantidad_minima: 2, precio: 5, presentacion_id: cajaB!.id },
    })
    expect(badInsertRes.ok(), '🛑 [120] el trigger debe rechazar un INSERT de A enlazado a la presentación de B').toBe(false)
    expect((await badInsertRes.text()).toLowerCase()).toMatch(/no pertenece|presentaci/)

    // 🛑 NEGATIVO — UPDATE: mover el tier YA existente de A hacia la presentación de B.
    const badUpdateRes = await request.patch(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista?id=eq.${tierA.id}`, {
      headers, data: { presentacion_id: cajaB!.id },
    })
    expect(badUpdateRes.ok(), '🛑 [120] el trigger debe rechazar también un UPDATE hacia la presentación de B').toBe(false)

    // El tier de A sigue enlazado a SU presentación (el UPDATE rechazado no dejó nada a medio camino)
    const finalRes = await request.get(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista?id=eq.${tierA.id}&select=presentacion_id`, { headers })
    const [tierFinal] = (await finalRes.json()) as Array<{ presentacion_id: string }>
    expect(tierFinal.presentacion_id).toBe(cajaA!.id)
  })

  test('APROB-09: el guard bloquea un PATCH directo de un rol NO exento, y deja pasar el del DUEÑO', async ({ page, request }) => {
    test.setTimeout(90000)
    test.skip(!process.env.E2E_DEPOSITO_EMAIL || !process.env.E2E_DEPOSITO_PASSWORD, 'Faltan E2E_DEPOSITO_EMAIL/PASSWORD en .env.test.local')
    const ts = Date.now()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const ownerToken = await tokenDesdeBrowser(page)
    const ownerHeaders = restHeaders(ownerToken)

    const [{ tenant_id: tenantId }] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers: ownerHeaders })).json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[120] no se pudo resolver el tenant_id').toBeTruthy()

    // Config default del tenant: sin override para DEPOSITO/DUEÑO — si un spec previo lo dejó
    // configurado, este test asume otra cosa y hay que frenar antes de sacar conclusiones falsas.
    const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=ajuste_autorizacion_roles`, { headers: ownerHeaders })
    const [{ ajuste_autorizacion_roles: config }] = (await tenantRes.json()) as Array<{ ajuste_autorizacion_roles: any }>
    const overrides = config && typeof config === 'object' ? Object.keys(config) : []
    expect(overrides.filter(r => r === 'DUEÑO' || r === 'DEPOSITO'), '[120] el tenant tiene overrides de DUEÑO/DEPOSITO en ajuste_autorizacion_roles — este spec asume la config default').toHaveLength(0)

    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers: ownerHeaders, data: { tenant_id: tenantId, nombre: `E2E Aprob120 Estado ${ts}`, requiere_aprobacion: true, es_disponible_venta: false },
    })
    expect(estadoRes.ok(), `[120] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoGate] = (await estadoRes.json()) as Array<{ id: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: ownerHeaders, data: { tenant_id: tenantId, nombre: `E2E Aprob120 Prod ${ts}`, sku: `E2E-SKU120-${ts}`, precio_costo: 60, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
    })
    expect(prodRes.ok(), `[120] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers: ownerHeaders, data: { tenant_id: tenantId, producto_id: producto.id, lpn: `E2E-LPN120-${ts}`, cantidad: 5, activo: true },
    })
    expect(lineaRes.ok(), `[120] no se pudo crear el LPN: ${await lineaRes.text()}`).toBe(true)
    const [linea] = (await lineaRes.json()) as Array<{ id: string; estado_id: string | null }>

    // (a) DEPOSITO (modo 'siempre' por default) — el PATCH directo debe FALLAR
    const depositoToken = await loginToken(request, process.env.E2E_DEPOSITO_EMAIL, process.env.E2E_DEPOSITO_PASSWORD)
    const depositoHeaders = restHeaders(depositoToken)
    const patchDeposito = await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}`, {
      headers: depositoHeaders, data: { estado_id: estadoGate.id },
    })
    expect(patchDeposito.ok(), '🛑 [120] APROB-09: un PATCH directo de un rol NO exento debe ser rechazado por el guard server-side').toBe(false)
    expect((await patchDeposito.text()).toLowerCase()).toMatch(/aprobaci|insufficient|autorizaci/)

    const sinCambioRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: ownerHeaders })
    const [sinCambio] = (await sinCambioRes.json()) as Array<{ estado_id: string | null }>
    expect(sinCambio.estado_id, '🛑 [120] el guard rechazó el PATCH — estado_id no debe haber cambiado').toBe(linea.estado_id)

    // (b) DUEÑO (modo 'directo' por default, H2) — el MISMO PATCH directo SÍ debe pasar
    const patchDueno = await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}`, {
      headers: ownerHeaders, data: { estado_id: estadoGate.id },
    })
    expect(patchDueno.ok(), `[120] APROB-09: el mismo PATCH directo para el DUEÑO (modo directo) debe pasar: ${await patchDueno.text()}`).toBe(true)

    const conCambioRes = await request.get(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}&select=estado_id`, { headers: ownerHeaders })
    const [conCambio] = (await conCambioRes.json()) as Array<{ estado_id: string | null }>
    expect(conCambio.estado_id, '[120] el guard debe dejar pasar al DUEÑO — estado_id sí cambió').toBe(estadoGate.id)
  })
})
