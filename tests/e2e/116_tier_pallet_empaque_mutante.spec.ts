/**
 * 116_tier_pallet_empaque_mutante.spec.ts
 * E2E MUTANTE — TIER-08 + TIER-10: tier mayorista enlazado a una presentación de empaque (Pallet).
 *
 * 🛑 El caso EXACTO de Fede (backlog Comercial, Fase A) — plata real, cero cobertura de
 * integración hoy (la lógica pura ya tiene 28 tests en tiers.test.ts, pero nunca se ejercitó en
 * el carrito real ni contra la RPC server-side).
 *
 * Given un producto con presentación "Pallet" (`factor_base=2000`, `producto_presentaciones`) y un
 * tier enlazado (`tipo_valor='pct'` 10%, `presentacion_id` = esa línea), When se cargan 2500
 * unidades en el carrito (1 pallet completo + 500 sueltas) a precio de lista $100, Then:
 *  - el indicador "Precio mayorista" del carrito muestra el precio BLENDED ($92/u si el tenant no
 *    redondea) y el total del carrito da exactamente 2500 × ese precio;
 *  - la RPC `fn_precio_venta_efectivo` (mig 330, la que usa Pedidos) devuelve EL MISMO precio
 *    contra el mismo fixture — fuente única de precio entre POS y Pedidos (Regla #0);
 *  - tras confirmar la venta, `venta_items.subtotal`/`precio_unitario` reflejan ese mismo total.
 *
 * Genera su propia precondición: producto + presentación + tier + stock real (ingreso por UI) por
 * REST/UI, todo nuevo (nunca reutiliza un producto real del catálogo, a diferencia del spec 54).
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

test.describe('Tier mayorista enlazado a empaque — Pallet (mutante)', () => {
  test('2500 unidades (1 pallet + 500 sueltas) cobran el precio BLENDED — carrito, RPC y venta_items coinciden', async ({ page, request }) => {
    test.setTimeout(150000)
    const ts = Date.now()
    const nombreProducto = `E2E TierPallet116 ${ts}`
    const PRECIO_LISTA = 100
    const CANTIDAD = 2500
    const FACTOR_PALLET = 2000
    const PCT_TIER = 10

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const [{ tenant_id: tenantId }] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as Array<{ tenant_id: string }>
    expect(tenantId, '[116] no se pudo resolver el tenant_id').toBeTruthy()

    const tenantRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=precio_redondeo`, { headers })
    const [{ precio_redondeo: precioRedondeo }] = (await tenantRes.json()) as Array<{ precio_redondeo: string | null }>

    // Estado NUEVO, propio de este spec — es_disponible_venta=true y SIN descuento_pct: reusar un
    // estado real/de otro spec podría traer un descuento automático (backlog Fede punto 3) que
    // contaminaría el total esperado (este test aísla el efecto del tier, nada más).
    const estadoRes = await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
      headers, data: { tenant_id: tenantId, nombre: `E2E Disponible116 ${ts}`, es_disponible_venta: true },
    })
    expect(estadoRes.ok(), `[116] no se pudo crear el estado: ${await estadoRes.text()}`).toBe(true)
    const [estadoVenta] = (await estadoRes.json()) as Array<{ nombre: string }>

    // Producto nuevo con precio de lista conocido
    const prodRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers, data: {
        tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-116-${ts}`,
        precio_costo: PRECIO_LISTA * 0.6, precio_venta: PRECIO_LISTA, unidad_medida: 'unidad', activo: true, alicuota_iva: 21,
      },
    })
    expect(prodRes.ok(), `[116] no se pudo crear el producto: ${await prodRes.text()}`).toBe(true)
    const [producto] = (await prodRes.json()) as Array<{ id: string }>

    // Empaque: base "Unidad" (factor 1) + "Pallet" (factor 2000), padre = base
    await sembrarPresentaciones(request, token, producto.id, 'Unidad', [
      { etiqueta: 'Pallet', factor_base: FACTOR_PALLET, padre_idx: 0 },
    ])
    const presentaciones = await leerPresentaciones(request, token, producto.id)
    const pallet = presentaciones.find(p => p.etiqueta === 'Pallet')
    expect(pallet, '[116] no se sembró la línea "Pallet" del empaque').toBeTruthy()

    // Tier enlazado: 10% off desde 1 pallet completo (>= 1 múltiplo de 2000)
    const tierRes = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
      headers, data: {
        tenant_id: tenantId, producto_id: producto.id, cantidad_minima: 1, precio: PCT_TIER,
        tipo_valor: 'pct', presentacion_id: pallet!.id,
      },
    })
    expect(tierRes.ok(), `[116] no se pudo crear el tier enlazado: ${await tierRes.text()}`).toBe(true)

    // Precio esperado: caso Fede — 2000u a 90 (10% off) + 500u a 100 (lista) = $230.000 / 2500 = $92/u
    const rawBlended = (FACTOR_PALLET * (PRECIO_LISTA * (1 - PCT_TIER / 100)) + (CANTIDAD - FACTOR_PALLET) * PRECIO_LISTA) / CANTIDAD
    const precioEsperado = redondearLocal(rawBlended, precioRedondeo)
    const totalEsperado = precioEsperado * CANTIDAD

    // Stock real >= 2500 (con margen) por el flujo de Ingreso
    await ingresoRealPorUI(page, { nombreProducto, cantidad: 3000, estadoNombre: estadoVenta.nombre })

    // Caja abierta ANTES de armar el carrito — garantizarCajaAbierta navega a /caja; si se llamara
    // después de construir el carrito, la navegación fuera de /ventas rompería los locators de abajo.
    await garantizarCajaAbierta(page)

    // TIER-08: carrito real — cargar 2500 unidades y verificar el precio BLENDED
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
    expect(total, `[116] total del carrito esperado $${totalEsperado} (blended $${precioEsperado}/u)`).toBeCloseTo(totalEsperado, 1)

    // TIER-10: la RPC server-side (la que usa Pedidos) tiene que devolver EL MISMO precio — fuente
    // única de precio entre POS y Pedidos (Regla #0), nunca antes ejercitada contra un RPC real.
    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_precio_venta_efectivo`, {
      headers, data: { p_tenant_id: tenantId, p_producto_id: producto.id, p_cantidad: CANTIDAD },
    })
    expect(rpcRes.ok(), `[116] fn_precio_venta_efectivo falló: ${await rpcRes.text()}`).toBe(true)
    const rpcPrecio = Number(await rpcRes.json())
    expect(rpcPrecio, '[116] la RPC debe devolver el mismo precio blended que calculó el POS').toBeCloseTo(precioEsperado, 2)

    // Confirmar la venta y verificar que persiste el mismo total en venta_items
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
    await page.waitForTimeout(300)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    const itemsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${producto.id}&select=cantidad,subtotal,precio_unitario,ventas(total)&order=created_at.desc&limit=1`,
      { headers })
    expect(itemsRes.ok(), `[116] no se pudo leer venta_items: ${await itemsRes.text()}`).toBe(true)
    const [item] = (await itemsRes.json()) as Array<{
      cantidad: number; subtotal: number; precio_unitario: number; ventas: { total: number }
    }>
    expect(item, '[116] no se encontró el venta_item recién creado').toBeTruthy()
    expect(item.cantidad).toBe(CANTIDAD)
    expect(item.precio_unitario, `[116] precio_unitario persistido esperado $${precioEsperado}`).toBeCloseTo(precioEsperado, 1)
    expect(item.subtotal, `[116] subtotal persistido esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
    expect(item.ventas.total, `[116] ventas.total esperado $${totalEsperado}`).toBeCloseTo(totalEsperado, 1)
  })
})
