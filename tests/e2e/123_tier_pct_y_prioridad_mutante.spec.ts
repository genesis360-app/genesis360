/**
 * 123_tier_pct_y_prioridad_mutante.spec.ts
 * E2E MUTANTE — TIER-07, TIER-11: wiring real de tiers en el carrito de `VentasPage.tsx` (la
 * lógica pura ya tiene 28 tests en `tiers.test.ts` — esto valida que el POS no invirtió nada al
 * cablearla).
 *
 * TIER-07 — tier `pct` (10% off) SIN enlace a empaque: el % se calcula sobre el precio de LISTA
 *   ($1.000), no sobre uno ya rebajado. El indicador "Precio mayorista" y el total del carrito
 *   tienen que reflejar $900/u.
 * TIER-11 — "compiten, gana el mejor": un tier enlazado a Pallet (5% off, $95/u) contra un tier
 *   NORMAL (`cantidad_minima=1500`, precio fijo $85/u mejor) que también matchea la cantidad del
 *   bloque del pallet (2.000u de 2.500 cargadas) — el carrito real usa el precio del tier NORMAL
 *   para ese bloque (blended esperado: 2000×$85 + 500×$100 lista = $220.000 → $88/u), replicando
 *   el caso exacto de `tiers.test.ts` pero contra el wiring real, no solo la función pura.
 *
 * Genera su propia precondición: producto + presentación + tiers + stock real (ingreso por UI),
 * todo nuevo por spec (mismo patrón que el spec 116 del lote anterior, dominio hermano).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito, totalDelCarrito,
  sembrarPresentaciones, leerPresentaciones,
} from './helpers/fixtures'

/** Espejo de `redondearPrecio` (src/lib/precioRedondeo.ts) — sin importar desde src/ en los e2e. */
function redondearLocal(precio: number, modo: string | null | undefined): number {
  const paso = ({ '10': 10, '50': 50, '100': 100, '500': 500, '1000': 1000 } as Record<string, number>)[modo ?? ''] ?? 0
  if (!Number.isFinite(precio) || precio <= 0 || paso <= 0) return precio
  return Math.round(precio / paso) * paso
}

async function resolverTenantYRedondeo(page: any, request: any) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const [{ tenant_id: tenantId }] = (await (await request.get(
    `${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
  expect(tenantId, 'no se pudo resolver el tenant_id').toBeTruthy()
  const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=precio_redondeo`, { headers })
  const [{ precio_redondeo: precioRedondeo }] = (await tenantRes.json()) as Array<{ precio_redondeo: string | null }>
  return { token, headers, tenantId, precioRedondeo }
}

async function crearEstadoDisponible(request: any, headers: any, tenantId: string, nombre: string) {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers, data: { tenant_id: tenantId, nombre, es_disponible_venta: true },
  })
  expect(res.ok(), `no se pudo crear el estado: ${await res.text()}`).toBe(true)
  return ((await res.json()) as any[])[0]
}

async function cobrarYFinalizar(page: any, totalEsperado: number) {
  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll((o: HTMLOptionElement[]) => o.map(x => x.value).filter(Boolean))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  // SIN anclas ^$: si algún otro spec dejó una promo configurada en Efectivo, la opción se etiqueta
  // "Efectivo · 🏷 X% off" (VentasPage.tsx) — un regex exacto no matchea y cuelga el .selectOption()
  // (mismo criterio que ya usa el spec 98, que siembra esa misma promo).
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Efectivo/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const montoInput = page.getByPlaceholder(/^Monto$/i).first()
  await montoInput.fill(String(Math.ceil(totalEsperado) + 1000))
  await montoInput.blur()
  await page.waitForTimeout(300)
  const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
  await expect(finalizar).toBeEnabled({ timeout: 5000 })
  await finalizar.click()
  await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
}

test.describe('Tiers — % sobre lista y prioridad "gana el mejor" en el carrito real (mutante)', () => {
  test('tier pct SIN empaque descuenta desde el precio de LISTA (TIER-07)', async ({ page, request }) => {
    test.setTimeout(120000)
    const ts = Date.now()
    const nombreProducto = `E2E Tier123 Pct ${ts}`
    const PRECIO_LISTA = 1000
    const PCT_TIER = 10
    const CANT_MINIMA = 5
    const CANTIDAD = 8 // >= cant_minima, sin enlace a empaque

    const { headers, tenantId, precioRedondeo } = await resolverTenantYRedondeo(page, request)
    const estadoVenta = await crearEstadoDisponible(request, headers, tenantId, `E2E Disponible123A ${ts}`)

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-123A-${ts}`,
        precio_costo: PRECIO_LISTA * 0.6, precio_venta: PRECIO_LISTA, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    // Tier normal (SIN presentacion_id) — % siempre sobre precio de lista
    const tierRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: { tenant_id: tenantId, producto_id: producto.id, cantidad_minima: CANT_MINIMA, precio: PCT_TIER, tipo_valor: 'pct' },
    })
    expect(tierRes.ok(), `no se pudo crear el tier: ${await tierRes.text()}`).toBe(true)

    const precioEsperado = redondearLocal(PRECIO_LISTA * (1 - PCT_TIER / 100), precioRedondeo)
    const totalEsperado = precioEsperado * CANTIDAD

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 20, estadoNombre: estadoVenta.nombre })
    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    const qtyInput = page.locator('input[inputmode="numeric"], input[inputmode="decimal"]').first()
    await qtyInput.fill(String(CANTIDAD))
    await qtyInput.blur()
    await page.waitForTimeout(700)

    await expect(page.getByText(new RegExp(`Precio mayorista:\\s*\\$${Math.round(precioEsperado)}/u`))).toBeVisible({ timeout: 8000 })
    const total = await totalDelCarrito(page)
    expect(total, `[123] TIER-07: total esperado $${totalEsperado} (10% off de lista $${PRECIO_LISTA})`).toBeCloseTo(totalEsperado, 1)

    await cobrarYFinalizar(page, totalEsperado)

    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=cantidad,subtotal,precio_unitario,ventas(total)&order=created_at.desc&limit=1`,
      { headers })
    expect(itemsRes.ok(), `no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{ cantidad: number; subtotal: number; precio_unitario: number; ventas: { total: number } }>
    expect(item, 'no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad).toBe(CANTIDAD)
    expect(item.precio_unitario, `precio_unitario persistido esperado $${precioEsperado}`).toBeCloseTo(precioEsperado, 1)
    expect(item.subtotal, `subtotal persistido esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
    expect(item.ventas.total, `ventas.total esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
  })

  test('"compiten, gana el mejor": el tier NORMAL le gana al de empaque para el mismo bloque (TIER-11)', async ({ page, request }) => {
    test.setTimeout(150000)
    const ts = Date.now()
    const nombreProducto = `E2E Tier123 Prioridad ${ts}`
    const PRECIO_LISTA = 100
    const CANTIDAD = 2500
    const FACTOR_PALLET = 2000
    const PCT_PALLET = 5           // tier enlazado: 5% off → $95/u
    const CANT_MINIMA_NORMAL = 1500
    const PRECIO_FIJO_NORMAL = 85  // tier normal: precio fijo mejor que el del pallet

    const { token, headers, tenantId, precioRedondeo } = await resolverTenantYRedondeo(page, request)
    const estadoVenta = await crearEstadoDisponible(request, headers, tenantId, `E2E Disponible123B ${ts}`)

    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-123B-${ts}`,
        precio_costo: PRECIO_LISTA * 0.6, precio_venta: PRECIO_LISTA, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    await sembrarPresentaciones(request, token, producto.id, 'Unidad', [{ etiqueta: 'Pallet', factor_base: FACTOR_PALLET, padre_idx: 0 }])
    const presentaciones = await leerPresentaciones(request, token, producto.id)
    const pallet = presentaciones.find(p => p.etiqueta === 'Pallet')
    expect(pallet, 'no se sembró la línea "Pallet" del empaque').toBeTruthy()

    // Tier ENLAZADO al pallet (peor precio para este escenario a propósito: 5% off = $95/u)
    const tierLigadoRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: {
        tenant_id: tenantId, producto_id: producto.id, cantidad_minima: 1, precio: PCT_PALLET,
        tipo_valor: 'pct', presentacion_id: pallet!.id,
      },
    })
    expect(tierLigadoRes.ok(), `no se pudo crear el tier enlazado: ${await tierLigadoRes.text()}`).toBe(true)

    // Tier NORMAL que también matchea la cantidad del bloque del pallet (2000 >= 1500), y da mejor precio
    const tierNormalRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: {
        tenant_id: tenantId, producto_id: producto.id, cantidad_minima: CANT_MINIMA_NORMAL, precio: PRECIO_FIJO_NORMAL,
        tipo_valor: 'precio_fijo', operador: '>=',
      },
    })
    expect(tierNormalRes.ok(), `no se pudo crear el tier normal: ${await tierNormalRes.text()}`).toBe(true)

    // Blended esperado: el bloque del pallet (2000u) lo gana el tier NORMAL ($85 < $95); las 500
    // sueltas no llegan a 1500 → sin tier, precio de lista ($100). Mismo fixture que tiers.test.ts.
    const rawBlended = (FACTOR_PALLET * PRECIO_FIJO_NORMAL + (CANTIDAD - FACTOR_PALLET) * PRECIO_LISTA) / CANTIDAD
    const precioEsperado = redondearLocal(rawBlended, precioRedondeo)
    const totalEsperado = precioEsperado * CANTIDAD
    // Sanity del fixture: si el wiring usara el tier de empaque en vez del normal, el resultado sería
    // otro (peor para el cliente) — nos aseguramos de que el escenario distinga ambos casos.
    const rawBlendedSiGanaraElLigado = (FACTOR_PALLET * (PRECIO_LISTA * (1 - PCT_PALLET / 100)) + (CANTIDAD - FACTOR_PALLET) * PRECIO_LISTA) / CANTIDAD
    expect(precioEsperado, '[123] fixture inválido: el escenario debe distinguir ganar-normal de ganar-ligado').not.toBeCloseTo(redondearLocal(rawBlendedSiGanaraElLigado, precioRedondeo), 1)

    await ingresoRealPorUI(page, { nombreProducto, cantidad: 3000, estadoNombre: estadoVenta.nombre })
    await garantizarCajaAbierta(page)
    await irAlPOS(page)
    const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
    await agregarPrimerProductoAlCarrito(page, nombreProducto)

    const qtyInput = page.locator('input[inputmode="numeric"], input[inputmode="decimal"]').first()
    await qtyInput.fill(String(CANTIDAD))
    await qtyInput.blur()
    await page.waitForTimeout(700)

    await expect(page.getByText(new RegExp(`Precio mayorista:\\s*\\$${Math.round(precioEsperado)}/u`))).toBeVisible({ timeout: 8000 })
    const total = await totalDelCarrito(page)
    expect(total, `[123] TIER-11: total esperado $${totalEsperado} (blended $${precioEsperado}/u — gana el tier NORMAL, no el de empaque)`).toBeCloseTo(totalEsperado, 1)

    await cobrarYFinalizar(page, totalEsperado)

    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=cantidad,subtotal,precio_unitario,ventas(total)&order=created_at.desc&limit=1`,
      { headers })
    expect(itemsRes.ok(), `no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{ cantidad: number; subtotal: number; precio_unitario: number; ventas: { total: number } }>
    expect(item, 'no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad).toBe(CANTIDAD)
    expect(item.precio_unitario, `precio_unitario persistido esperado $${precioEsperado}`).toBeCloseTo(precioEsperado, 1)
    expect(item.subtotal, `subtotal persistido esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
    expect(item.ventas.total, `ventas.total esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
  })
})
