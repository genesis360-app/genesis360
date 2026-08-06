/**
 * 115_cupon_prorrateo_fiscal_mutante.spec.ts
 * E2E MUTANTE — CUPON-06: prorrateo fiscal del cupón (Regla #0, backlog Comercial de Fede, Fase C).
 *
 * 🛑 El hallazgo fiscal más importante de esta fase: una venta compuesta ÚNICAMENTE por un cupón
 * aplicado (sin descuento general, sin combo, sin promo por método de pago) tiene que facturarse
 * con el monto YA restado el cupón. `prorratearDescuentoGlobal` (facturacionLogic.ts) reparte el
 * descuento global sobre `venta_items` para que la suma coincida EXACTO con `ventas.total` — hasta
 * que se agregó `montoCupon` a la condición `hayDescGlobal` (VentasPage.tsx), un cupón SOLO (sin
 * ningún otro descuento) no disparaba el prorrateo: `venta_items.subtotal` quedaba en el precio de
 * LISTA mientras `ventas.total` ya tenía el cupón restado → sobre-facturación (factura + IVA débito
 * por MÁS de lo que pagó el cliente).
 *
 * Genera su propia precondición: producto nuevo con precio conocido + ingreso REAL de stock por UI
 * (no INSERT directo a inventario_lineas) + cupón/código nuevos por REST. Vende por el POS real
 * aplicando SOLO el cupón (sin tocar "Descuento general" ni combos) y verifica en DB que
 * `venta_items.subtotal` sumado = `ventas.total` = precio de lista − monto del cupón.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito, totalDelCarrito,
} from './helpers/fixtures'

test.describe('Cupón — prorrateo fiscal (mutante)', () => {
  test('venta con SOLO cupón aplicado factura el monto YA restado el cupón', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Cupon115 ${ts}`
    const PRECIO = 5000
    const MONTO_CUPON = 500
    const CODIGO = `E2E115${ts}`.slice(0, 16).toUpperCase()

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const [{ tenant_id: tenantId }] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[115] no se pudo resolver el tenant_id').toBeTruthy()

    // Estado NUEVO, propio de este spec — es_disponible_venta=true y SIN descuento_pct ni
    // requiere_aprobacion. Nunca reusar un estado real/de otro spec: alguno del catálogo puede
    // traer un descuento automático (backlog Fede punto 3) que contaminaría el total esperado
    // de ESTE test (que solo quiere aislar el efecto del cupón).
    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tenantId, nombre: `E2E Disponible115 ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[115] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    // Producto con precio conocido
    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-115-${ts}`,
        precio_costo: PRECIO * 0.6, precio_venta: PRECIO, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[115] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    // Cupón activo/vigente + código único
    const cuponNombre = `E2E Cupón 115 ${ts}`
    const cuponRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones`, {
      headers, data: {
        tenant_id: tenantId, nombre: cuponNombre, monto: MONTO_CUPON,
        vigencia_desde: '2020-01-01', vigencia_hasta: '2099-12-31', activo: true,
      },
    })
    expect(cuponRes.ok(), `[115] no se pudo crear el cupón: ${await cuponRes.text()}`).toBe(true)
    const [cupon] = (await cuponRes.json()) as Array<{ id: string }>
    const codigoRes = await request.post(`${SUPABASE_URL}/rest/v1/cupones_codigos`, {
      headers, data: { tenant_id: tenantId, cupon_id: cupon.id, codigo: CODIGO },
    })
    expect(codigoRes.ok(), `[115] no se pudo crear el código: ${await codigoRes.text()}`).toBe(true)
    const [codigoRow] = (await codigoRes.json()) as Array<{ id: string }>

    // Stock real por el flujo de Ingreso (no INSERT directo)
    await ingresoRealPorUI(page, { nombreProducto, cantidad: 5, estadoNombre: estadoVenta.nombre })

    // Vender: SOLO cupón — nunca tocar "Descuento general" ni combos ni promo por medio de pago
    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    const cuponInput = page.getByPlaceholder('Código de cupón')
    await expect(cuponInput).toBeVisible({ timeout: 8000 })
    await cuponInput.fill(CODIGO)
    await page.getByRole('button', { name: 'Aplicar' }).click()

    // POSITIVO: el cupón quedó aplicado (caja violeta con nombre+código) y el ticket muestra la línea
    await expect(page.getByText(new RegExp(`\\(${CODIGO}\\)`))).toBeVisible({ timeout: 6000 })
    await expect(page.getByText(/🎟 Cupón/)).toBeVisible({ timeout: 6000 })

    const totalEsperado = PRECIO - MONTO_CUPON
    const total = await totalDelCarrito(page)
    expect(total, `[115] el total del carrito debería reflejar el cupón (esperado ${totalEsperado})`).toBeCloseTo(totalEsperado, 1)

    // Cobrar en efectivo y finalizar (puede haber más de una caja abierta)
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill(String(Math.ceil(totalEsperado) + 1000))
    await montoInput.blur()

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // POSITIVO en DB: venta_items sumado = ventas.total, con el cupón restado — Regla #0
    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=cantidad,subtotal,precio_unitario,ventas(total,cupon_monto,cupon_codigo_id)&order=created_at.desc&limit=1`,
      { headers })
    expect(itemsRes.ok(), `[115] no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{
      cantidad: number; subtotal: number; precio_unitario: number
      ventas: { total: number; cupon_monto: number | null; cupon_codigo_id: string | null }
    }>
    expect(item, '[115] no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad).toBe(1)
    expect(item.ventas.cupon_monto, '[115] ventas.cupon_monto debe ser el snapshot del cupón').toBeCloseTo(MONTO_CUPON, 1)
    expect(item.ventas.cupon_codigo_id, '[115] la venta debe quedar ligada al código canjeado').toBe(codigoRow.id)
    expect(item.ventas.total, `[115] ventas.total esperado ${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
    // 🛑 Ésta es la aserción que hubiera fallado SIN el fix de hayDescGlobal: sin prorrateo,
    // venta_items.subtotal habría quedado en $5000 (precio de LISTA) mientras ventas.total ya
    // tenía el cupón restado ($4500) → factura por MÁS de lo que pagó el cliente.
    expect(item.subtotal, `[115] venta_items.subtotal debe sumar EXACTO ventas.total (esperado ${totalEsperado})`).toBeCloseTo(totalEsperado, 1)
    expect(item.precio_unitario, '[115] precio_unitario recalculado (subtotal/cantidad) coherente con el subtotal').toBeCloseTo(totalEsperado, 1)

    // El código quedó marcado como usado, ligado a ESTA venta (no reusable)
    const codigoFinalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/cupones_codigos?id=eq.${codigoRow.id}&select=usado_en_venta_id`, { headers })
    const [codigoFinal] = (await codigoFinalRes.json()) as Array<{ usado_en_venta_id: string | null }>
    expect(codigoFinal.usado_en_venta_id, '[115] el código debe quedar marcado como usado').toBeTruthy()
  })
})
