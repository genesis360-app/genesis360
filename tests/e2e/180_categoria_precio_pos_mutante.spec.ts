/**
 * 180_categoria_precio_pos_mutante.spec.ts
 * E2E MUTANTE — B2 / Fase 4 (mig 468): la CATEGORÍA del cliente en el POS. REGLA #0, plata.
 *
 * A. Caso A1 del relevamiento: lista $100, tier "10 o más a $80", categoría 30 % → 12 u a $70 (gana la categoría, no se
 *    acumula con el tier). El cajero ve "Categoría …: −30 % sobre lista" y el cartel; se cobra y la base guarda F2
 *    (mecanismo 'categoria', lista $100, categoría y %). El mismo carrito SIN cliente sale a $80 (tier).
 * B. Tope de descuento acumulado (PL-1): con tope 20 % esa venta (30 %) NO se registra — ni siendo DUEÑO.
 *
 * Genera su propia precondición (producto + tier + stock por UI + categoría + cliente). Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import {
  tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta,
  ingresoRealPorUI, irAlPOS, agregarPrimerProductoAlCarrito, totalDelCarrito,
} from './helpers/fixtures'

async function prepararEscenario(page: any, request: any, ts: number) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [t] = await (await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,precio_redondeo,descuento_tope_acumulado_pct&limit=1`, { headers })).json()
  const tenantId = t.id as string

  const [estado] = await (await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers, data: { tenant_id: tenantId, nombre: `E2E Disp180 ${ts}`, es_disponible_venta: true },
  })).json()
  const nombreProducto = `E2E Cat180 Bidon ${ts}`
  const [producto] = await (await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers, data: { tenant_id: tenantId, nombre: nombreProducto, sku: `E2E-180-${ts}`, precio_costo: 50, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
  })).json()
  expect(producto?.id, 'no se pudo crear el producto').toBeTruthy()
  const tier = await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
    headers, data: { tenant_id: tenantId, producto_id: producto.id, cantidad_minima: 10, precio: 80, operador: '>=', tipo_valor: 'precio_fijo' },
  })
  expect(tier.ok(), `tier: ${await tier.text()}`).toBe(true)

  const [cat] = await (await request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, {
    headers, data: { tenant_id: tenantId, nombre: `Colocadores 180 ${ts}`, activo: true },
  })).json()
  expect(cat?.id, 'no se pudo crear la categoría').toBeTruthy()
  const desc = await request.post(`${SUPABASE_URL}/rest/v1/categoria_cliente_descuentos`, {
    headers, data: { tenant_id: tenantId, categoria_id: cat.id, producto_id: producto.id, descuento_pct: 30 },
  })
  expect(desc.ok(), `descuento: ${await desc.text()}`).toBe(true)
  const nombreCliente = `ZZZ Cat180 ${ts}`
  const [cliente] = await (await request.post(`${SUPABASE_URL}/rest/v1/clientes`, {
    headers, data: { tenant_id: tenantId, nombre: nombreCliente, categoria_cliente_id: cat.id },
  })).json()
  expect(cliente?.id, 'no se pudo crear el cliente').toBeTruthy()

  await ingresoRealPorUI(page, { nombreProducto, cantidad: 30, estadoNombre: estado.nombre })
  await garantizarCajaAbierta(page)
  return { headers, tenantId, t, producto, cat, cliente, nombreProducto, nombreCliente }
}

async function armarCarrito(page: any, nombreProducto: string, nombreCliente: string | null) {
  await irAlPOS(page)
  const verTodos = page.getByRole('button', { name: /^Todos$/ }).first()
  if (await verTodos.isVisible().catch(() => false)) await verTodos.click()
  await agregarPrimerProductoAlCarrito(page, nombreProducto)
  const qty = page.locator('input[inputmode="numeric"], input[inputmode="decimal"]').first()
  await qty.fill('12')
  await qty.blur()
  if (nombreCliente) {
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    const buscar = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await buscar.fill(nombreCliente)
    await page.getByRole('button', { name: new RegExp(nombreCliente, 'i') }).first().click()
  }
  await expect(page.getByTestId('pos-registrar-venta')).toBeEnabled({ timeout: 15000 })
}

async function cobrarEfectivo(page: any, monto: number) {
  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll((o: HTMLOptionElement[]) => o.map(x => x.value).filter(Boolean))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Efectivo/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const montoInput = page.getByPlaceholder(/^Monto$/i).first()
  await montoInput.fill(String(Math.ceil(monto) + 1000))
  await montoInput.blur()
}

test.describe('Categoría del cliente en el POS (mig 468)', () => {
  test('A1: categoría 30 % le gana al tier y se guarda F2; sin cliente sale al tier', async ({ page, request }) => {
    test.setTimeout(180000)
    const ts = Date.now()
    const e = await prepararEscenario(page, request, ts)
    test.skip(!!e.t.precio_redondeo && e.t.precio_redondeo !== 'none', 'El tenant tiene redondeo: los montos esperados no aplican.')
    test.skip(e.t.descuento_tope_acumulado_pct != null, 'El tenant ya tiene un tope de descuento configurado.')

    // Sin cliente: tier $80 × 12
    await armarCarrito(page, e.nombreProducto, null)
    expect(await totalDelCarrito(page)).toBeCloseTo(960, 1)

    // Con el cliente de la categoría: $70 × 12, etiqueta + cartel
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    await page.getByPlaceholder(/Buscar por nombre o DNI/i).first().fill(e.nombreCliente)
    await page.getByRole('button', { name: new RegExp(e.nombreCliente, 'i') }).first().click()
    await expect(page.getByTestId('pos-etiqueta-categoria')).toContainText(/−30 % sobre lista/, { timeout: 15000 })
    await expect(page.getByTestId('pos-cartel-precio')).toContainText(/no se suma al precio por cantidad/i)
    await expect(page.getByTestId('pos-registrar-venta')).toBeEnabled({ timeout: 15000 })
    expect(await totalDelCarrito(page)).toBeCloseTo(840, 1)

    await cobrarEfectivo(page, 840)
    await page.getByTestId('pos-registrar-venta').click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 20000 })

    const [item] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${e.producto.id}&select=cantidad,precio_unitario,subtotal,mecanismo_precio,precio_lista_unitario,categoria_cliente_id,categoria_descuento_pct&order=created_at.desc&limit=1`,
      { headers: e.headers })).json()
    expect(Number(item.cantidad)).toBe(12)
    expect(Number(item.precio_unitario)).toBeCloseTo(70, 2)
    expect(Number(item.subtotal)).toBeCloseTo(840, 2)
    expect(item.mecanismo_precio).toBe('categoria')
    expect(Number(item.precio_lista_unitario)).toBeCloseTo(100, 2)
    expect(item.categoria_cliente_id).toBe(e.cat.id)
    expect(Number(item.categoria_descuento_pct)).toBeCloseTo(30, 2)
    // F3 (mig 469): lo que bajó la categoría frente al tier = 12 × ($80 − $70) = $120
    const [f3] = await (await request.get(
      `${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${e.producto.id}&select=descuento_categoria_monto&order=created_at.desc&limit=1`,
      { headers: e.headers })).json()
    expect(Number(f3.descuento_categoria_monto), '[180] F3: 12 × ($80 tier − $70 categoría)').toBeCloseTo(120, 2)

    // El reporte "Descuentos por categoría" lo muestra (categoría + cliente + $120).
    await goto(page, '/reportes')
    await waitForApp(page)
    await page.getByRole('button', { name: /Descuentos por categoría/ }).first().click()
    const fila = page.locator('tbody tr').filter({ hasText: e.cat.nombre ?? `Colocadores 180 ${ts}` })
    await expect(fila).toHaveCount(1, { timeout: 15000 })
    await expect(fila).toContainText(e.nombreCliente)
    await expect(fila).toContainText(/120/)
  })

  test('tope 20 %: la venta con 30 % de descuento no se registra (ni el DUEÑO)', async ({ page, request }) => {
    test.setTimeout(180000)
    const ts = Date.now()
    const e = await prepararEscenario(page, request, ts)
    test.skip(!!e.t.precio_redondeo && e.t.precio_redondeo !== 'none', 'El tenant tiene redondeo: los montos esperados no aplican.')
    test.skip(e.t.descuento_tope_acumulado_pct != null, 'El tenant ya tiene un tope de descuento configurado.')
    const patch = (v: number | null) => request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${e.tenantId}`, { headers: e.headers, data: { descuento_tope_acumulado_pct: v } })
    expect((await patch(20)).ok()).toBe(true)
    try {
      await page.reload()   // el tope se lee del negocio cargado al entrar
      await waitForApp(page)
      await armarCarrito(page, e.nombreProducto, e.nombreCliente)
      expect(await totalDelCarrito(page)).toBeCloseTo(840, 1)
      await cobrarEfectivo(page, 840)
      await page.getByTestId('pos-registrar-venta').click()
      await expect(page.getByText(/descuento total de 30 % sobre el precio de lista y el tope del negocio es 20 %/i).first()).toBeVisible({ timeout: 10000 })
      // El carrito sigue cargado y no se grabó ninguna línea de ese producto.
      await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
      const items = await (await request.get(`${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${e.producto.id}&select=id`, { headers: e.headers })).json()
      expect(items).toHaveLength(0)
    } finally {
      await patch(null)
    }
  })
})

// ── Pedidos (A2 de punta a punta, `fn_pedido_generar_venta`) ───────────────────────────────────────────────────────────
type H = Record<string, string>
async function pedidoA2(request: any, headers: H, tenantId: string, tipoId: string, ts: number, suf: string, catId: string, clienteId: string) {
  const c: { productoId?: string; ubicId?: string; estadoId?: string; pedidoId?: string; pedidoNumero?: number } = {}
  const [p] = await (await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers, data: { tenant_id: tenantId, nombre: `E2E Ped180 ${suf} ${ts}`, sku: `E2E-PED180-${suf}-${ts}`, precio_costo: 50, precio_venta: 100, unidad_medida: 'unidad', activo: true, alicuota_iva: 21 },
  })).json()
  c.productoId = p.id
  await request.post(`${SUPABASE_URL}/rest/v1/producto_precios_mayorista`, {
    headers, data: { tenant_id: tenantId, producto_id: p.id, cantidad_minima: 10, precio: 80, operador: '>=', tipo_valor: 'precio_fijo' },
  })
  await request.post(`${SUPABASE_URL}/rest/v1/categoria_cliente_descuentos`, {
    headers, data: { tenant_id: tenantId, categoria_id: catId, producto_id: p.id, descuento_pct: 20 },
  })
  const [est] = await (await request.post(`${SUPABASE_URL}/rest/v1/estados_inventario`, {
    headers, data: { tenant_id: tenantId, nombre: `E2E Prox vencer 180 ${suf} ${ts}`, es_disponible_venta: true, descuento_pct: 25 },
  })).json()
  c.estadoId = est.id
  const [u] = await (await request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
    headers, data: { tenant_id: tenantId, nombre: `E2E Picking 180 ${suf} ${ts}`, tipo_logico: 'picking', disponible_surtido: true, activo: true },
  })).json()
  c.ubicId = u.id
  for (const [cant, estadoId, lpn] of [[8, null, 'N'], [4, est.id, 'V']] as const) {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers, data: { tenant_id: tenantId, producto_id: p.id, lpn: `LPN-180-${suf}-${lpn}-${ts}`, cantidad: cant, ubicacion_id: u.id, activo: true, estado_id: estadoId },
    })
    expect(r.ok(), `[180] stock: ${await r.text()}`).toBe(true)
  }
  const [ped] = await (await request.post(`${SUPABASE_URL}/rest/v1/pedidos`, {
    headers, data: { tenant_id: tenantId, tipo_pedido_id: tipoId, cliente_id: clienteId, estado: 'confirmado' },
  })).json()
  c.pedidoId = ped.id; c.pedidoNumero = ped.numero
  const it = await request.post(`${SUPABASE_URL}/rest/v1/pedido_items`, { headers, data: { tenant_id: tenantId, pedido_id: ped.id, producto_id: p.id, cantidad: 12 } })
  expect(it.ok(), `[180] pedido_item: ${await it.text()}`).toBe(true)
  const l = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_generar_tareas_picking_pedido`, { headers, data: { p_pedido_id: ped.id } })
  expect(l.ok(), `[180] lanzar: ${await l.text()}`).toBe(true)
  return c
}

test('Pedidos A2: con categoría el lote con 25 % compite contra la lista ($940); sin categoría se acumula ($880)', async ({ page, request }) => {
  test.setTimeout(150000)
  const ts = Date.now()
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [t] = await (await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,precio_redondeo,descuento_tope_acumulado_pct&limit=1`, { headers })).json()
  test.skip(!!t.precio_redondeo && t.precio_redondeo !== 'none', 'El tenant tiene redondeo.')
  test.skip(t.descuento_tope_acumulado_pct != null, 'El tenant ya tiene un tope de descuento configurado.')
  const tenantId = t.id as string
  const [tipo] = await (await request.get(`${SUPABASE_URL}/rest/v1/tipos_pedido?tenant_id=eq.${tenantId}&select=id&limit=1`, { headers })).json()
  expect(tipo, '[180] no hay tipo_pedido').toBeTruthy()
  const [cat] = await (await request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, { headers, data: { tenant_id: tenantId, nombre: `Colocadores ped 180 ${ts}`, activo: true } })).json()
  const [conCat] = await (await request.post(`${SUPABASE_URL}/rest/v1/clientes`, { headers, data: { tenant_id: tenantId, nombre: `ZZZ Ped180 cat ${ts}`, categoria_cliente_id: cat.id } })).json()
  const [sinCat] = await (await request.post(`${SUPABASE_URL}/rest/v1/clientes`, { headers, data: { tenant_id: tenantId, nombre: `ZZZ Ped180 sin ${ts}` } })).json()

  await garantizarCajaAbierta(page, { caja: 'Caja1' })
  const [sesion] = await (await request.get(`${SUPABASE_URL}/rest/v1/caja_sesiones?tenant_id=eq.${tenantId}&estado=eq.abierta&select=id&limit=1`, { headers })).json()
  const entregar = async (pedidoId: string) => {
    // Mig 484: un pedido no se entrega con el picking pendiente → se completa primero (misma RPC que /picking).
    const tareas = (await (await request.get(`${SUPABASE_URL}/rest/v1/wms_tareas?pedido_id=eq.${pedidoId}&estado=in.(pendiente,en_curso)&select=id,tipo`, { headers })).json()) as Array<{ id: string; tipo: string }>
    for (const t of [...tareas].sort((x, y) => (x.tipo === 'replenishment' ? -1 : 1) - (y.tipo === 'replenishment' ? -1 : 1))) {
      const rpc = t.tipo === 'replenishment' ? 'fn_completar_tarea_reabastecimiento' : 'fn_completar_tarea_picking'
      const c = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, { headers, data: { p_tarea_id: t.id } })
      expect(c.ok(), `[180] ${rpc}: ${await c.text()}`).toBe(true)
    }
    const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_pedido_generar_venta`, {
      headers, data: { p_pedido_id: pedidoId, p_sesion_caja_id: sesion.id, p_medio_pago: [{ tipo: 'Efectivo', monto: null }] },
    })
    expect(r.ok(), `[180] fn_pedido_generar_venta: ${await r.text()}`).toBe(true)
    return (await r.json()) as string
  }

  const a = await pedidoA2(request, headers, tenantId, tipo.id, ts, 'C', cat.id, conCat.id)
  const ventaA = await entregar(a.pedidoId!)
  const [va] = await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaA}&select=total,venta_items(precio_unitario,mecanismo_precio,precio_lista_unitario,categoria_descuento_pct,descuento_estado_monto,descuento_categoria_monto)`, { headers })).json()
  expect(Number(va.total), '[180] 8 × $80 (categoría) + 4 × $75 (estado 25 % le gana) = $940').toBeCloseTo(940, 2)
  expect(va.venta_items[0].mecanismo_precio).toBe('categoria')
  expect(Number(va.venta_items[0].precio_lista_unitario)).toBeCloseTo(100, 2)
  expect(Number(va.venta_items[0].descuento_estado_monto)).toBeCloseTo(20, 2)
  // F3: con cat 20 % la categoría empata con el tier ($80) → ganó la categoría pero no bajó nada frente al tier.
  expect(va.venta_items[0].descuento_categoria_monto).toBeNull()

  const b = await pedidoA2(request, headers, tenantId, tipo.id, ts, 'S', cat.id, sinCat.id)
  const ventaB = await entregar(b.pedidoId!)
  const [vb] = await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaB}&select=total,venta_items(mecanismo_precio)`, { headers })).json()
  expect(Number(vb.total), '[180] sin categoría: 12 × $80 − 4 × $80 × 25 % = $880 (se acumula, como antes)').toBeCloseTo(880, 2)
  expect(vb.venta_items[0].mecanismo_precio).toBe('tier')
})
