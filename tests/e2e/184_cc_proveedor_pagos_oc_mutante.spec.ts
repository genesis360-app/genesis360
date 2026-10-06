/**
 * 184_cc_proveedor_pagos_oc_mutante.spec.ts
 * E2E MUTANTE — 🛑 REGLA #0: pagos de OC y cuenta corriente del proveedor (mig 473, decisión de GO 2026-10-06).
 *
 * Por qué existe: el plan de cobertura marcaba el pago de OC (L8) como 🔴 hueco y el pago desde la CC del proveedor ni
 * figuraba. Así pasaron: la misma OC pasada a CC dos veces (deuda doble), el saldo negativo por pagos al contado, el pago
 * desde el proveedor que no cerraba ninguna OC y el efectivo que nunca entraba en la caja.
 *
 * Modelo: la deuda nace al RECIBIR (cargo por la recepción); todo pago descuenta; desde la CC se imputa a la OC más
 * vieja primero; "Cuenta Corriente" solo fija el plazo.
 *
 * A · API (con la sesión del DUEÑO, misma RLS que la app): anticipo → saldo a favor; pasar a CC dos veces no suma deuda;
 *     recibir carga la deuda; pago desde la CC cierra las OCs por antigüedad; sobrepago, efectivo sin caja y pagar una
 *     OC ya pagada se rechazan; una OC con pagos no cambia sus ítems.
 * B · UI: el modal de la CC muestra el saldo correcto y el medio de pago legible (no el JSON).
 * Datos inventados: proveedor "E2E184 …" propio (queda inactivo; sus OCs con pagos no se pueden borrar, a propósito).
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>
const rpc = (request: APIRequestContext, headers: H, fn: string, data: object) =>
  request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers, data })
const num = (v: unknown) => parseFloat(String(v ?? 0))
// Sucursal Norte: la que miran la app y los demás e2e. Con `sucursales?limit=1` los gastos caían en Sur con la fecha de hoy
// y rompían a los specs que toman "el último gasto del mes" (141, 143, 145 — 2026-10-06).
const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test('pagos de OC y CC del proveedor: la deuda nace al recibir y los pagos cierran por antigüedad', async ({ page, request }) => {
  test.setTimeout(120_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const get = async (path: string) => (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers })).json()
  const post = async (tabla: string, data: object) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/${tabla}`, { headers, data })
    expect(r.ok(), `insert ${tabla}: ${await r.text()}`).toBeTruthy()
    return (await r.json())[0]
  }

  const [suc] = await get(`sucursales?select=id,tenant_id&id=eq.${NORTE}`)
  const [me] = await get('users?select=id&limit=1')
  const [prod] = await get('productos?select=id&activo=eq.true&limit=1')
  const ts = Date.now()
  const prov = await post('proveedores', { tenant_id: suc.tenant_id, nombre: `E2E184 Proveedor ${ts}` })
  const resumen = async () => (await rpc(request, headers, 'fn_proveedor_cc_resumen', { p_proveedor_id: prov.id })).json()
  const saldo = async () => num((await resumen()).saldo?.ARS)
  const nuevaOC = async (precio: number) => {
    const oc = await post('ordenes_compra', { tenant_id: suc.tenant_id, proveedor_id: prov.id, numero: 0, estado: 'enviada', sucursal_id: suc.id, moneda: 'ARS' })
    await post('orden_compra_items', { orden_compra_id: oc.id, producto_id: prod.id, cantidad: 10, precio_unitario: precio })
    return oc as { id: string; numero: number }
  }
  const ocDe = async (id: string) => (await get(`ordenes_compra?id=eq.${id}&select=estado_pago,monto_pagado`))[0]

  try {
    // OC1 $10.000 (más vieja) y OC2 $5.000, sin total guardado (nunca pagadas: el total sale de los ítems).
    const oc1 = await nuevaOC(1000)
    const oc2 = await nuevaOC(500)
    expect(num((await resumen()).pendiente_ocs?.ARS), 'lo pendiente incluye OCs sin total guardado').toBe(15000)
    expect(await saldo(), 'sin recibir no hay deuda').toBe(0)

    // Anticipo de $1.000 a la OC1 → saldo −1.000 (a favor del negocio), OC1 parcial.
    let r = await rpc(request, headers, 'registrar_pago_oc', { p_oc_id: oc1.id, p_medios: [{ tipo: 'Transferencia', monto: 1000 }] })
    expect(r.ok(), await r.text()).toBeTruthy()
    expect(await saldo()).toBe(-1000)

    // Pasar el resto a CC DOS veces: no suma deuda ni cuenta como pagado (antes: deuda doble).
    for (let i = 0; i < 2; i++) {
      r = await rpc(request, headers, 'registrar_pago_oc', { p_oc_id: oc1.id, p_medios: [{ tipo: 'Cuenta Corriente', monto: 9000 }] })
      expect(r.ok(), await r.text()).toBeTruthy()
    }
    expect(await saldo(), 'pasar a CC no carga deuda').toBe(-1000)
    expect(await ocDe(oc1.id)).toMatchObject({ estado_pago: 'cuenta_corriente' })
    expect(num((await ocDe(oc1.id)).monto_pagado)).toBe(1000)

    // Recibir la OC1 (recepción + su gasto "Compra OC") → la deuda nace: 10.000 − 1.000 = 9.000.
    const rec = await post('recepciones', { tenant_id: suc.tenant_id, oc_id: oc1.id, proveedor_id: prov.id, estado: 'confirmada', sucursal_id: suc.id })
    await post('gastos', {
      tenant_id: suc.tenant_id, recepcion_id: rec.id, descripcion: `Compra OC #${oc1.numero} — E2E184`, monto: 10000,
      moneda: 'ARS', categoria: 'Compras', fecha: new Date().toISOString().slice(0, 10), sucursal_id: suc.id, usuario_id: me.id,
    })
    expect(await saldo(), 'recibir carga la deuda').toBe(9000)

    // 🛑 Rechazos: efectivo sin caja, sobrepago, editar ítems de una OC con pagos.
    r = await rpc(request, headers, 'registrar_pago_proveedor', { p_proveedor_id: prov.id, p_medio: 'Efectivo', p_monto: 100, p_caja_sesion_id: null })
    expect(r.ok()).toBeFalsy()
    expect(await r.text()).toMatch(/caja abierta/)
    r = await rpc(request, headers, 'registrar_pago_proveedor', { p_proveedor_id: prov.id, p_medio: 'Transferencia', p_monto: 14001 })
    expect(r.ok()).toBeFalsy()
    expect(await r.text()).toMatch(/supera/)
    const del = await request.delete(`${SUPABASE_URL}/rest/v1/orden_compra_items?orden_compra_id=eq.${oc1.id}`, { headers })
    expect(del.ok(), 'una OC con pagos no cambia sus ítems').toBeFalsy()

    // Pago desde la CC de $11.000 → la más vieja primero: OC1 recibe 9.000 (queda pagada), OC2 recibe 2.000.
    r = await rpc(request, headers, 'registrar_pago_proveedor', { p_proveedor_id: prov.id, p_medio: 'Transferencia', p_monto: 11000 })
    expect(r.ok(), await r.text()).toBeTruthy()
    const imp = (await r.json()).imputaciones as { numero: number; monto: number }[]
    expect(imp.map(i => [i.numero, num(i.monto)])).toEqual([[oc1.numero, 9000], [oc2.numero, 2000]])
    expect(await ocDe(oc1.id)).toMatchObject({ estado_pago: 'pagada' })
    expect(await ocDe(oc2.id)).toMatchObject({ estado_pago: 'pago_parcial' })
    expect(await saldo(), 'OC2 no recibida: lo pagado es anticipo').toBe(-2000)

    // Pagar una OC ya pagada → rechazado.
    r = await rpc(request, headers, 'registrar_pago_oc', { p_oc_id: oc1.id, p_medios: [{ tipo: 'Transferencia', monto: 1 }] })
    expect(r.ok()).toBeFalsy()

    // B · UI: el modal de la CC muestra el anticipo y el medio legible.
    await goto(page, '/proveedores')
    await waitForApp(page)
    await page.getByPlaceholder(/Buscar/i).first().fill(`E2E184 Proveedor ${ts}`)
    await page.getByTitle(/Cuenta corriente/i).first().click()
    const saldoUI = page.getByTestId('cc-proveedor-saldo')
    await expect(saldoUI).toContainText('Anticipo a favor', { timeout: 15000 })
    await expect(saldoUI).toContainText('2.000')
    await expect(page.getByText('Transferencia $1.000').first()).toBeVisible()
    await expect(page.getByText(/\[\{"tipo"/)).toHaveCount(0)
  } finally {
    await request.patch(`${SUPABASE_URL}/rest/v1/proveedores?id=eq.${prov.id}`, { headers, data: { activo: false } })
  }
})

// Mig 475 / C-22 (GO 06/10): el envío lo cobra el proveedor (suma a la deuda) o un tercero (gasto aparte, no suma).
test('envío de la OC: el del proveedor suma a lo que se le debe; el de un tercero no', async ({ page, request }) => {
  test.setTimeout(90_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const get = async (path: string) => (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers })).json()
  const post = async (tabla: string, data: object) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/${tabla}`, { headers, data })
    expect(r.ok(), `insert ${tabla}: ${await r.text()}`).toBeTruthy()
    return (await r.json())[0]
  }
  const [suc] = await get(`sucursales?select=id,tenant_id&id=eq.${NORTE}`)
  const [me] = await get('users?select=id&limit=1')
  const [prod] = await get('productos?select=id&activo=eq.true&limit=1')
  const prov = await post('proveedores', { tenant_id: suc.tenant_id, nombre: `E2E184 Envío ${Date.now()}` })
  const resumen = async () => (await rpc(request, headers, 'fn_proveedor_cc_resumen', { p_proveedor_id: prov.id })).json()
  try {
    const nueva = async (envio: number, aCargo: 'proveedor' | 'tercero') => {
      const oc = await post('ordenes_compra', { tenant_id: suc.tenant_id, proveedor_id: prov.id, numero: 0, estado: 'enviada', sucursal_id: suc.id,
        moneda: 'ARS', tiene_envio: true, costo_envio: envio, envio_a_cargo: aCargo })
      await post('orden_compra_items', { orden_compra_id: oc.id, producto_id: prod.id, cantidad: 10, precio_unitario: 900 })
      return oc
    }
    const a = await nueva(1000, 'proveedor')   // 9.000 + 1.000
    const b = await nueva(500, 'tercero')      // 9.000 (el envío no)
    expect(num((await resumen()).pendiente_ocs?.ARS), 'pendiente: envío del proveedor sí, el del tercero no').toBe(19000)

    for (const [oc, envio] of [[a, 1000], [b, 500]] as const) {
      const rec = await post('recepciones', { tenant_id: suc.tenant_id, oc_id: oc.id, proveedor_id: prov.id, estado: 'confirmada', sucursal_id: suc.id })
      const base = { tenant_id: suc.tenant_id, recepcion_id: rec.id, moneda: 'ARS', fecha: new Date().toISOString().slice(0, 10), sucursal_id: suc.id, usuario_id: me.id }
      await post('gastos', { ...base, descripcion: 'Compra E2E184', monto: 9000, categoria: 'Compras' })
      await post('gastos', { ...base, oc_envio_id: oc.id, descripcion: 'Envío E2E184', monto: envio, categoria: 'Fletes' })
    }
    expect(num((await resumen()).saldo?.ARS), 'deuda = compras + envío del proveedor (no el del tercero)').toBe(19000)

    // El envío no se registra dos veces (otra recepción de la misma OC).
    const dup = await request.post(`${SUPABASE_URL}/rest/v1/gastos`, { headers, data: {
      tenant_id: suc.tenant_id, oc_envio_id: a.id, descripcion: 'Envío dup', monto: 1000, moneda: 'ARS', categoria: 'Fletes',
      fecha: new Date().toISOString().slice(0, 10), sucursal_id: suc.id, usuario_id: me.id } })
    expect(dup.ok(), 'el envío de una OC se registra una sola vez').toBeFalsy()
  } finally {
    await request.patch(`${SUPABASE_URL}/rest/v1/proveedores?id=eq.${prov.id}`, { headers, data: { activo: false } })
  }
})
