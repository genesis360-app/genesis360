/**
 * 137_ventas_anulacion_supervision_mutante.spec.ts
 * E2E MUTANTE — A1 (relevamiento Supervisión, Fede 2026-08-20): "Anular venta despachada" ya NO
 * se ejecuta directo con clave maestra: pasa a cola de aprobación (mismo patrón que Clientes/
 * Envíos/Proveedores/Pedidos/RRHH, mig 386).
 *
 * Parte A (SIN CAE, despachada): solicitar → aprobar dispara el MISMO efecto real de siempre
 * (cambiarEstado→'cancelada': reincorpora stock + revierte caja) — verificado en DB, no solo UI.
 * Es el camino nuevo y de más riesgo real (dinero/stock), así que se corre de punta a punta.
 *
 * Parte B (CON CAE, sintético — sin llamar a AFIP real): antes la solicitud NI SIQUIERA se
 * ofrecía (el botón "Anular" se ocultaba del todo si había CAE). Ahora sí se ofrece, y aprobarla
 * abre "Devolver" precargada a devolución completa (todos los ítems) — se verifica que la
 * precarga es total y que la autorización SIGUE pendiente si se cancela sin confirmar (nunca se
 * marca aprobada antes de que el efecto real ocurra). No se completa la devolución con datos
 * sintéticos: eso dispararía la NC automática (A10) contra AFIP con un comprobante inventado —
 * mismo criterio defensivo que el spec 22 (devolución) ya usa para el "happy path monetario".
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta, ingresoRealPorUI } from './helpers/fixtures'

async function crearProductoConPrecio(
  page: any, request: any, headers: Record<string, string>, nombre: string, precio: number,
): Promise<string> {
  await goto(page, '/productos/nuevo')
  await waitForApp(page)
  const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
  await expect(nombreInput).toBeVisible({ timeout: 8000 })
  await nombreInput.fill(nombre)
  await page.getByRole('button', { name: /Crear producto/i }).click()
  await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
    await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
  })
  const prodRes = await request.get(
    `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombre)}&select=id`,
    { headers },
  )
  const [producto] = (await prodRes.json()) as Array<{ id: string }>
  expect(producto, `[137] no se encontró el producto "${nombre}" recién creado`).toBeTruthy()
  const patch = await request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${producto.id}`, {
    headers, data: { precio_venta: precio, precio_costo: Math.round(precio / 2) },
  })
  expect(patch.ok(), '[137] no se pudo fijar precio_venta').toBe(true)
  return producto.id
}

/** Venta directa (despachada, efectivo exacto) del producto por nombre — deja el carrito vacío al terminar. */
async function venderDirecto(page: any, nombreProducto: string, precio: number): Promise<void> {
  await goto(page, '/ventas')
  await waitForApp(page)
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await expect(buscador).toBeVisible({ timeout: 8000 })
  await buscador.fill(nombreProducto)
  const filaProd = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: nombreProducto }).first()
  await expect(filaProd, `[137] "${nombreProducto}" no apareció en el buscador del POS`).toBeVisible({ timeout: 10000 })
  await filaProd.click()
  await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll(
      (opts: HTMLOptionElement[]) => opts.map(o => o.value).filter(Boolean),
    )
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const montoInput = page.getByPlaceholder(/^Monto$/i).first()
  await montoInput.fill(String(precio))
  await montoInput.blur()
  const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
  await expect(finalizar).toBeEnabled({ timeout: 5000 })
  await finalizar.click()
  await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
}

/** Abre el detalle de la venta desde Historial buscándola por número (único por tenant). */
async function abrirDetalleEnHistorial(page: any, numero: number): Promise<void> {
  await goto(page, '/ventas')
  await waitForApp(page)
  await page.getByRole('button', { name: /^Historial$/ }).first().click()
  const buscadorHist = page.getByPlaceholder(/Buscar cliente/i).first()
  await expect(buscadorHist).toBeVisible({ timeout: 8000 })
  await buscadorHist.fill(String(numero))
  await buscadorHist.press('Enter')
  const fila = page.locator('div.divide-y > div').filter({ hasText: /\$/ }).first()
  await expect(fila, `[137] no apareció ninguna fila de Historial buscando la venta #${numero}`).toBeVisible({ timeout: 10000 })
  await fila.click()
}

test.describe('Ventas — anulación vía Supervisión (A1, mutante)', () => {
  test('sin CAE: solicitar anulación → aprobar reincorpora stock y revierte caja', async ({ page, request }) => {
    test.setTimeout(120000)
    const sufijo = Date.now()
    const nombreProd = `E2E AnularVtaA ${sufijo}`
    const PRECIO = 1234
    const STOCK_INICIAL = 5

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const productoId = await crearProductoConPrecio(page, request, headers, nombreProd, PRECIO)
    await ingresoRealPorUI(page, { nombreProducto: nombreProd, cantidad: STOCK_INICIAL, estadoNombre: 'Disponible', ubicacionNombre: 'RACK2' })

    const prodPreRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${productoId}&select=stock_actual`, { headers })
    const [prodPre] = (await prodPreRes.json()) as Array<{ stock_actual: number }>
    expect(prodPre?.stock_actual, '[137] el stock inicial no quedó como se sembró').toBe(STOCK_INICIAL)

    await garantizarCajaAbierta(page)
    await venderDirecto(page, nombreProd, PRECIO)

    // La venta recién creada es la ÚNICA con este producto (nombre único con timestamp) — no hace
    // falta ordenar/limitar, alcanza con que exista exactamente 1 fila.
    const itemsRes = await request.get(`${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${productoId}&select=venta_id`, { headers })
    const items = (await itemsRes.json()) as Array<{ venta_id: string }>
    expect(items.length, '[137] debía haber exactamente 1 venta_item para el producto recién vendido').toBe(1)
    const ventaId = items[0].venta_id

    const ventaPreRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=id,numero,estado,cae,monto_pagado`, { headers })
    const [ventaPre] = (await ventaPreRes.json()) as Array<{ id: string; numero: number; estado: string; cae: string | null; monto_pagado: number }>
    expect(ventaPre.estado, '[137] la venta recién despachada debía quedar "despachada"').toBe('despachada')
    expect(ventaPre.cae, '[137] esta venta NO debe tener CAE (no facturada)').toBeFalsy()
    expect(Number(ventaPre.monto_pagado), '[137] el monto pagado debía ser el precio exacto').toBe(PRECIO)

    // 1) Solicitar anulación desde el detalle de la venta
    await abrirDetalleEnHistorial(page, ventaPre.numero)
    const btnSolicitar = page.getByRole('button', { name: /Solicitar anulación/i })
    await expect(btnSolicitar, '[137] no apareció "Solicitar anulación" en el detalle de una venta despachada sin CAE').toBeVisible({ timeout: 8000 })
    await btnSolicitar.click()
    await expect(page.getByRole('heading', { name: /Solicitar anulación/i }).or(page.getByText(/Solicitar anulación — Venta/i))).toBeVisible({ timeout: 5000 })
    const motivoInput = page.getByPlaceholder(/¿Por qué se anula esta venta\?/i)
    await motivoInput.fill('E2E — verificación automática A1')
    await page.getByRole('button', { name: /^Enviar solicitud$/ }).click()
    await expect(page.getByText(/Solicitud de anulación enviada/i)).toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: quedó una autorización pendiente, la venta SIGUE despachada (nada se ejecutó todavía)
    const autPendRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones?modulo=eq.ventas&tipo=eq.eliminar_venta_despachada` +
        `&datos_cambio->>venta_id=eq.${ventaId}&estado=eq.pendiente&select=id,datos_cambio`,
      { headers },
    )
    expect(autPendRes.ok(), `[137] no se pudo leer autorizaciones: ${await autPendRes.text()}`).toBe(true)
    const [autPend] = (await autPendRes.json()) as Array<{ id: string; datos_cambio: any }>
    expect(autPend, '[137] no se encontró la autorización pendiente de anulación').toBeTruthy()
    expect(autPend.datos_cambio.venta_numero, '[137] datos_cambio debía llevar el número de venta').toBe(ventaPre.numero)

    const ventaSigueDespachadaRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=estado`, { headers })
    const [ventaSigueDespachada] = (await ventaSigueDespachadaRes.json()) as Array<{ estado: string }>
    expect(ventaSigueDespachada.estado, '[137] la venta NO debía cambiar de estado solo por solicitar la anulación').toBe('despachada')

    // 2) Aprobar desde Ventas → Autorizaciones
    await goto(page, '/ventas?tab=autorizaciones')
    await waitForApp(page)
    const filaAut = page.locator('div').filter({ hasText: `#${ventaPre.numero}` }).filter({ has: page.getByRole('button', { name: /Aprobar/i }) }).last()
    await expect(filaAut, `[137] no apareció la fila de la autorización de la venta #${ventaPre.numero}`).toBeVisible({ timeout: 10000 })
    await filaAut.getByRole('button', { name: /Aprobar/i }).click()
    const confirmarAprobar = page.getByRole('alertdialog').getByRole('button', { name: /^Confirmar$/i })
    await expect(confirmarAprobar, '[137] no apareció el diálogo de confirmación al aprobar').toBeVisible({ timeout: 5000 })
    await confirmarAprobar.click()
    await expect(page.getByText(/Anulación aprobada y ejecutada/i)).toBeVisible({ timeout: 15000 })

    // 3) POSITIVO final en DB: venta cancelada, autorización aprobada, stock restaurado, caja revertida
    const ventaPostRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=estado`, { headers })
    const [ventaPost] = (await ventaPostRes.json()) as Array<{ estado: string }>
    expect(ventaPost.estado, '[137] la venta debía quedar "cancelada" tras aprobar').toBe('cancelada')

    const autPostRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${autPend.id}&select=estado`, { headers })
    const [autPost] = (await autPostRes.json()) as Array<{ estado: string }>
    expect(autPost.estado, '[137] la autorización debía quedar "aprobada"').toBe('aprobada')

    const prodPostRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${productoId}&select=stock_actual`, { headers })
    const [prodPost] = (await prodPostRes.json()) as Array<{ stock_actual: number }>
    expect(prodPost.stock_actual, '[137] el stock debía volver al valor sembrado tras la anulación').toBe(STOCK_INICIAL)

    const cajaRes = await request.get(
      `${SUPABASE_URL}/rest/v1/caja_movimientos?tipo=eq.egreso_devolucion_sena&concepto=ilike.*Venta%20%23${ventaPre.numero}*&select=id,monto&order=created_at.desc&limit=1`,
      { headers },
    )
    expect(cajaRes.ok(), `[137] no se pudo leer caja_movimientos: ${await cajaRes.text()}`).toBe(true)
    const [movCaja] = (await cajaRes.json()) as Array<{ id: string; monto: number }>
    expect(movCaja, '[137] no se encontró el egreso de caja que revierte el cobro al anular').toBeTruthy()
    expect(Number(movCaja.monto), '[137] el egreso de caja debía ser por el monto exacto cobrado').toBe(PRECIO)
  })

  test('con CAE (sintético): la solicitud ahora se ofrece y aprobar abre "Devolver" precargada a devolución total, sin marcar aprobada hasta confirmarla', async ({ page, request }) => {
    test.setTimeout(120000)
    const sufijo = Date.now()
    const nombreProd = `E2E AnularVtaB ${sufijo}`
    const PRECIO = 2345

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const productoId = await crearProductoConPrecio(page, request, headers, nombreProd, PRECIO)
    await ingresoRealPorUI(page, { nombreProducto: nombreProd, cantidad: 3, estadoNombre: 'Disponible', ubicacionNombre: 'RACK2' })

    await garantizarCajaAbierta(page)
    await venderDirecto(page, nombreProd, PRECIO)

    const itemsRes = await request.get(`${SUPABASE_URL}/rest/v1/venta_items?producto_id=eq.${productoId}&select=venta_id`, { headers })
    const items = (await itemsRes.json()) as Array<{ venta_id: string }>
    expect(items.length, '[137b] debía haber exactamente 1 venta_item para el producto recién vendido').toBe(1)
    const ventaId = items[0].venta_id

    // Fixture SINTÉTICO — NUNCA se llama a AFIP acá: solo se marca la venta como facturada con un
    // CAE de prueba para poder verificar el GATING de la UI (antes bloqueaba del todo esta acción
    // con CAE). No se completa una devolución real con estos datos (ver comentario del archivo).
    const caeFalso = `E2ETEST${sufijo}`
    const patchFact = await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}`, {
      headers, data: { estado: 'facturada', cae: caeFalso, tipo_comprobante: 'Factura B' },
    })
    expect(patchFact.ok(), `[137b] no se pudo marcar la venta como facturada (fixture sintético): ${await patchFact.text()}`).toBe(true)

    const ventaRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=numero,estado,cae`, { headers })
    const [venta] = (await ventaRes.json()) as Array<{ numero: number; estado: string; cae: string }>
    expect(venta.estado).toBe('facturada')
    expect(venta.cae).toBe(caeFalso)

    // 1) Con CAE, "Solicitar anulación" ahora SÍ se ofrece (antes el botón "Anular" no aparecía)
    await abrirDetalleEnHistorial(page, venta.numero)
    const btnSolicitar = page.getByRole('button', { name: /Solicitar anulación/i })
    await expect(btnSolicitar, '[137b] con CAE, "Solicitar anulación" debía ofrecerse igual (antes se bloqueaba del todo)').toBeVisible({ timeout: 8000 })
    // "Cambiar cliente" NO debe ofrecerse con CAE (sin cambios respecto de antes)
    await expect(page.getByRole('button', { name: /Cambiar cliente/i }), '[137b] "Cambiar cliente" no debía ofrecerse con CAE').not.toBeVisible()
    await btnSolicitar.click()
    await expect(page.getByText(/facturada electrónicamente \(CAE\)/i)).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /^Enviar solicitud$/ }).click()
    await expect(page.getByText(/Solicitud de anulación enviada/i)).toBeVisible({ timeout: 10000 })

    const autPendRes = await request.get(
      `${SUPABASE_URL}/rest/v1/autorizaciones?modulo=eq.ventas&tipo=eq.eliminar_venta_despachada` +
        `&datos_cambio->>venta_id=eq.${ventaId}&estado=eq.pendiente&select=id`,
      { headers },
    )
    const [autPend] = (await autPendRes.json()) as Array<{ id: string }>
    expect(autPend, '[137b] no se encontró la autorización pendiente').toBeTruthy()

    // 2) Aprobar → debe abrir "Devolver" precargada a devolución TOTAL (no ejecutar nada solo)
    await goto(page, '/ventas?tab=autorizaciones')
    await waitForApp(page)
    const filaAut = page.locator('div').filter({ hasText: `#${venta.numero}` }).filter({ has: page.getByRole('button', { name: /Aprobar/i }) }).last()
    await expect(filaAut, `[137b] no apareció la fila de la autorización de la venta #${venta.numero}`).toBeVisible({ timeout: 10000 })
    await filaAut.getByRole('button', { name: /Aprobar/i }).click()
    const confirmarAprobar = page.getByRole('alertdialog').getByRole('button', { name: /^Confirmar$/i })
    await expect(confirmarAprobar).toBeVisible({ timeout: 5000 })
    await confirmarAprobar.click()

    await expect(page.getByRole('heading', { name: /Procesar devolución/ }), '[137b] aprobar una anulación FACTURADA debía abrir "Devolver"').toBeVisible({ timeout: 10000 })
    await expect(page.getByText(new RegExp(`Venta #${venta.numero}`))).toBeVisible()
    // Precarga TOTAL: la cantidad a devolver del único ítem viene en el máximo (vendimos 1 unidad)
    const cantInput = page.locator('input[type="number"]').first()
    await expect(cantInput, '[137b] no apareció el input de cantidad a devolver').toBeVisible({ timeout: 5000 })
    await expect(cantInput).toHaveValue('1')
    const totalBanner = page.locator('div').filter({ hasText: /^Total a devolver\$/ }).last()
    await expect(totalBanner, '[137b] no apareció el banner "Total a devolver"').toBeVisible()
    await expect(totalBanner).toContainText(`$${PRECIO.toLocaleString('es-AR')}`)

    // 3) Cancelar SIN confirmar (no se completa la devolución con datos sintéticos — dispararía
    // la NC automática A10 contra AFIP con un comprobante inventado)
    await page.getByRole('button', { name: /^Cancelar$/ }).first().click()
    await expect(page.getByRole('heading', { name: /Procesar devolución/ })).not.toBeVisible({ timeout: 5000 })

    // POSITIVO en DB: la autorización SIGUE pendiente — nunca se marcó aprobada sin el efecto real
    const autTrasCancelarRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${autPend.id}&select=estado`, { headers })
    const [autTrasCancelar] = (await autTrasCancelarRes.json()) as Array<{ estado: string }>
    expect(autTrasCancelar.estado, '[137b] la autorización NO debía quedar aprobada al cancelar sin confirmar la devolución').toBe('pendiente')

    const ventaTrasCancelarRes = await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=estado`, { headers })
    const [ventaTrasCancelar] = (await ventaTrasCancelarRes.json()) as Array<{ estado: string }>
    expect(ventaTrasCancelar.estado, '[137b] la venta NO debía cambiar de estado al cancelar sin confirmar').toBe('facturada')
  })
})
