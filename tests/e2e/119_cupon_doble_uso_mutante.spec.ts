/**
 * 119_cupon_doble_uso_mutante.spec.ts
 * E2E MUTANTE — CUPON-07, 08: blindaje contra doble uso de un cupón (plata, backlog Comercial de Fede).
 *
 * CUPON-07: el cupón se re-valida EN FRESCO al confirmar la venta (no alcanza con la validación de
 * cuando se aplicó al carrito). Si el código se usó por otro lado mientras tanto (ej. otra caja), el
 * checkout corta con "ya no está disponible" ANTES de crear la fila en `ventas` — nunca se cobra un
 * descuento que no se puede honrar.
 *
 * CUPON-08: el canje real es un `UPDATE ... WHERE usado_en_venta_id IS NULL` — condicional atómico
 * a nivel de fila. Se prueba DIRECTO contra la DB (mismo patrón que usa `VentasPage.tsx`) que sólo
 * UNA de dos actualizaciones concurrentes puede ganar el claim, y que el `UNIQUE(cupon_codigo_id)`
 * de `ventas` (mig 332) bloquea a nivel constraint que dos ventas queden ligadas al mismo código.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito,
} from './helpers/fixtures'

async function ctx(page: any, request: any) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const [{ tenant_id: tenantId, id: sucId }] = (await (await request.get(
    `${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&order=created_at.asc&limit=1`, { headers })).json()) as Array<{ id: string; tenant_id: string }>
  expect(tenantId, '[119] no se pudo resolver el tenant_id').toBeTruthy()
  return { headers, tenantId, sucId }
}

test.describe('Cupón — doble uso / condición de carrera (mutante)', () => {
  test('CUPON-07: re-validación en fresco — código usado por otra vía corta ANTES de crear la venta', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const c = await ctx(page, request)
    const nombreProducto = `E2E Cupon119A ${ts}`
    const CODIGO = `E2E119A${ts}`.slice(0, 16).toUpperCase()

    // Estado NUEVO, propio de este spec — es_disponible_venta=true y SIN descuento_pct: reusar un
    // estado real/de otro spec podría traer un descuento automático (backlog Fede punto 3) ajeno
    // a lo que este test aísla (el bloqueo por doble uso del cupón).
    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers: c.headers, data: { tenant_id: c.tenantId, nombre: `E2E Disponible119 ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[119] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers: c.headers, data: {
        tenant_id: c.tenantId, nombre: nombreProducto, sku: `E2E-119A-${ts}`,
        precio_costo: 600, precio_venta: 1000, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[119] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    const cuponRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
      headers: c.headers, data: {
        tenant_id: c.tenantId, nombre: `E2E Cupón 119A ${ts}`, monto: 200,
        vigencia_desde: '2020-01-01', vigencia_hasta: '2099-12-31', activo: true,
      },
    })
    expect(cuponRes.ok(), `[119] no se pudo crear el cupón: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    const codigoRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
      headers: c.headers, data: { tenant_id: c.tenantId, cupon_id: cupon.id, codigo: CODIGO },
    })
    expect(codigoRes.ok(), `[119] no se pudo crear el código: ${await codigoRes.text()}`).toBe(true)
    const [codigo] = (await codigoRes.json()) as Array<{ id: string }>

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 5, estadoNombre: estadoVenta.nombre })

    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    const cuponInput = page.getByPlaceholder('Código de cupón')
    await expect(cuponInput).toBeVisible({ timeout: 8000 })
    await cuponInput.fill(CODIGO)
    await page.getByRole('button', { name: 'Aplicar' }).click()
    await expect(page.getByText(new RegExp(`\\(${CODIGO}\\)`))).toBeVisible({ timeout: 6000 })

    // "Otra caja" canjea el mismo código MIENTRAS el carrito de esta sesión lo sigue teniendo
    // aplicado (venta dummy, simula la venta concurrente que se lo llevó primero).
    const ventaOtraRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers: c.headers, data: {
        tenant_id: c.tenantId, sucursal_id: c.sucId, consumidor_final: true, estado: 'despachada',
        subtotal: 800, total: 800, cupon_codigo_id: codigo.id,
        medio_pago: '[{"tipo":"Efectivo","monto":800}]',
      },
    })
    expect(ventaOtraRes.ok(), `[119] no se pudo crear la venta "de otra caja": ${await ventaOtraRes.text()}`).toBe(true)
    const [ventaOtra] = (await ventaOtraRes.json()) as Array<{ id: string }>
    const claimRes = await request.patch(`${SUPABASE_URL}/rest/v1/cupones_codigos?id=eq.${codigo.id}`, {
      headers: c.headers, data: { usado_en_venta_id: ventaOtra.id, usado_at: new Date().toISOString() },
    })
    expect(claimRes.ok(), `[119] no se pudo marcar el código como usado por "la otra caja": ${await claimRes.text()}`).toBe(true)

    // Cobrar en la sesión ORIGINAL (que todavía tiene el cupón aplicado, ahora ya inválido)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('2000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // POSITIVO: corta con el error específico, ANTES de crear la venta
    await expect(page.getByText(/ya no está disponible/i)).toBeVisible({ timeout: 12000 })
    // El carrito sigue ahí (no se limpió — la venta nunca se confirmó)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()

    // POSITIVO en DB: no se creó una SEGUNDA venta para este producto (solo existe la "de otra caja",
    // que no tiene venta_items de este producto en absoluto)
    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=id,venta_id`, { headers: c.headers })
    const items = (await itemsRes.json()) as any[]
    expect(items, '🛑 [119] no debió crearse ninguna venta con este producto — el cupón cortó antes').toHaveLength(0)

    const ventasConCodigoRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?cupon_codigo_id=eq.${codigo.id}&select=id`, { headers: c.headers })
    const ventasConCodigo = (await ventasConCodigoRes.json()) as any[]
    expect(ventasConCodigo, '[119] el código debe seguir ligado ÚNICAMENTE a la venta que lo canjeó primero').toHaveLength(1)
    expect(ventasConCodigo[0].id).toBe(ventaOtra.id)
  })

  test('CUPON-08: el claim atómico solo lo gana UNA venta, y el UNIQUE(cupon_codigo_id) blinda un intento directo de duplicarlo', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const c = await ctx(page, request)
    const CODIGO = `E2E119B${ts}`.slice(0, 16).toUpperCase()

    const cuponRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
      headers: c.headers, data: {
        tenant_id: c.tenantId, nombre: `E2E Cupón 119B ${ts}`, monto: 100,
        vigencia_desde: '2020-01-01', vigencia_hasta: '2099-12-31', activo: true,
      },
    })
    expect(cuponRes.ok(), `[119] no se pudo crear el cupón: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    const codigoRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
      headers: c.headers, data: { tenant_id: c.tenantId, cupon_id: cupon.id, codigo: CODIGO },
    })
    expect(codigoRes.ok(), `[119] no se pudo crear el código: ${await codigoRes.text()}`).toBe(true)
    const [codigo] = (await codigoRes.json()) as Array<{ id: string }>

    const crearVentaMinima = async () => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
        headers: c.headers, data: {
          tenant_id: c.tenantId, sucursal_id: c.sucId, consumidor_final: true, estado: 'despachada',
          subtotal: 500, total: 500, medio_pago: '[{"tipo":"Efectivo","monto":500}]',
        },
      })
      expect(res.ok(), `[119] no se pudo crear la venta: ${await res.text()}`).toBe(true)
      return ((await res.json()) as Array<{ id: string }>)[0]
    }
    const venta1 = await crearVentaMinima()
    const venta2 = await crearVentaMinima()

    // Mismo patrón EXACTO que usa VentasPage.tsx: UPDATE condicional `WHERE usado_en_venta_id IS NULL`.
    const claim1 = await request.patch(
      `${SUPABASE_URL}/rest/v1/cupones_codigos?id=eq.${codigo.id}&usado_en_venta_id=is.null`,
      { headers: c.headers, data: { usado_en_venta_id: venta1.id, usado_at: new Date().toISOString() } })
    expect(claim1.ok(), `[119] el primer claim debería ganar: ${await claim1.text()}`).toBe(true)
    const claimados1 = (await claim1.json()) as any[]
    expect(claimados1, '[119] el primer claim afecta EXACTO 1 fila').toHaveLength(1)

    // 🛑 Segundo claim, mismo filtro (ya no hay fila con usado_en_venta_id IS NULL) → 0 filas, PIERDE.
    const claim2 = await request.patch(
      `${SUPABASE_URL}/rest/v1/cupones_codigos?id=eq.${codigo.id}&usado_en_venta_id=is.null`,
      { headers: c.headers, data: { usado_en_venta_id: venta2.id, usado_at: new Date().toISOString() } })
    expect(claim2.ok(), `[119] el segundo claim no debe romper (0 filas ≠ error): ${await claim2.text()}`).toBe(true)
    const claimados2 = (await claim2.json()) as any[]
    expect(claimados2, '🛑 [119] el claim perdedor NO debe afectar ninguna fila').toHaveLength(0)

    // La venta ganadora liga el código — igual que hace VentasPage.tsx tras ganar el claim.
    const link1 = await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta1.id}`, {
      headers: c.headers, data: { cupon_codigo_id: codigo.id },
    })
    expect(link1.ok(), `[119] la venta ganadora debe poder ligar el código: ${await link1.text()}`).toBe(true)

    // 🛑 Blindaje de constraint: un intento DIRECTO de ligar el MISMO código a la venta perdedora
    // debe fallar por `ventas_cupon_codigo_id_key` (UNIQUE), no solo por lógica de aplicación.
    const link2 = await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta2.id}`, {
      headers: c.headers, data: { cupon_codigo_id: codigo.id },
    })
    expect(link2.ok(), '🛑 [119] el UNIQUE(cupon_codigo_id) debe bloquear un segundo intento de ligar el mismo código').toBe(false)
    const link2Body = await link2.text()
    expect(link2Body.toLowerCase(), `[119] el error debería ser de constraint/duplicado, recibido: ${link2Body}`).toMatch(/duplicate|unique|cupon_codigo_id/)

    // POSITIVO en DB: la venta ganadora quedó ligada, la perdedora nunca se tocó
    const finalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/ventas?id=in.(${venta1.id},${venta2.id})&select=id,cupon_codigo_id`, { headers: c.headers })
    const finales = (await finalRes.json()) as Array<{ id: string; cupon_codigo_id: string | null }>
    const v1 = finales.find(v => v.id === venta1.id)
    const v2 = finales.find(v => v.id === venta2.id)
    expect(v1?.cupon_codigo_id).toBe(codigo.id)
    expect(v2?.cupon_codigo_id).toBeNull()
  })
})
