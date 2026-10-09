/**
 * 194_venta_con_stock_global_otra_sucursal_mutante.spec.ts
 * 🛑 REGLA #0 (inventario) — Ubicaciones GLOBALES (UAT §111, migs 488-491): una venta de Sur puede reservar stock de Norte
 * que está en una ubicación Global; la tarea de picking la hace Norte; Sur ve el avance; cuando Norte termina, el pedido de
 * Sur queda listo para entregar.
 *
 * API-only (PostgREST con tokens reales): OWNER arma la venta, `supervisor@test.com` (restringido a Norte) completa la
 * tarea y `supervisor2@test.com` (restringido a Sur) mira el avance. Se borra todo al final (borrar la venta libera la
 * reserva). Corre contra DEV (Almacén Jorgito: la ubicación "E2E Siembra" es Global y tiene stock de Norte).
 */
import { test, expect } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'
const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'

test('venta de Sur con stock de Norte en Global: reserva, tarea en Norte, avance en Sur y pedido listo', async ({ request }) => {
  test.setTimeout(90000)
  const sNorte = [process.env.E2E_SUPERVISOR_EMAIL, process.env.E2E_SUPERVISOR_PASSWORD]
  const sSur = [process.env.E2E_SUPERVISOR_SUR_EMAIL, process.env.E2E_SUPERVISOR_SUR_PASSWORD]
  test.skip(!sNorte[0] || !sNorte[1] || !sSur[0] || !sSur[1], 'Faltan credenciales de los supervisores de Norte y Sur')

  const hOwner = { ...restHeaders(await loginToken(request)), Prefer: 'return=representation' }
  const hNorte = restHeaders(await loginToken(request, sNorte[0], sNorte[1]))
  const hSur = restHeaders(await loginToken(request, sSur[0], sSur[1]))
  const url = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`
  const get = async (h: any, p: string) => (await request.get(url(p), { headers: h })).json()
  const rpc = async (h: any, fn: string, body: any) => request.post(url(`rpc/${fn}`), { headers: h, data: body })

  // Un LPN de NORTE en una ubicación GLOBAL (sucursal NULL), sin serie, con 2 libres; y uno de Norte NO Global del mismo
  // producto (si hay) para probar el rechazo.
  const globales = await get(hOwner,
    `inventario_lineas?tenant_id=eq.${TENANT}&sucursal_id=eq.${NORTE}&activo=eq.true` +
    `&select=id,lpn,producto_id,cantidad,cantidad_reservada,ubicacion_id,ubicaciones!inner(sucursal_id),productos!inner(tiene_series)` +
    `&ubicaciones.sucursal_id=is.null&productos.tiene_series=eq.false&order=cantidad.desc&limit=30`) as any[]
  const linea = globales.find(l => Number(l.cantidad) - Number(l.cantidad_reservada ?? 0) >= 2)
  test.skip(!linea, '[194] no hay un LPN de Norte en una ubicación Global con 2 libres')
  const antes = (await get(hOwner, `inventario_lineas?id=eq.${linea.id}&select=cantidad_reservada`))[0]

  let ventaId: string | null = null
  let pedidoId: string | null = null
  try {
    // Venta de SUR (presupuesto) + ítem; reservar el LPN de Norte (Global); pasar a reservada → nace el pedido.
    const rv = await request.post(url('ventas'), { headers: hOwner, data: { tenant_id: TENANT, sucursal_id: SUR, estado: 'pendiente', total: 0, notas: 'e2e 194 — stock Global de otra sucursal' } })
    expect(rv.ok(), await rv.text()).toBeTruthy()
    ventaId = (await rv.json())[0].id
    const ri = await request.post(url('venta_items'), { headers: hOwner, data: { tenant_id: TENANT, venta_id: ventaId, producto_id: linea.producto_id, cantidad: 2, precio_unitario: 0, subtotal: 0 } })
    expect(ri.ok(), await ri.text()).toBeTruthy()
    const itemId = (await ri.json())[0].id

    // La base rechaza un LPN de Norte que NO está en una Global.
    const noGlobal = (await get(hOwner,
      `inventario_lineas?tenant_id=eq.${TENANT}&sucursal_id=eq.${NORTE}&producto_id=eq.${linea.producto_id}&activo=eq.true` +
      `&select=id,cantidad,cantidad_reservada,ubicaciones!inner(sucursal_id)&ubicaciones.sucursal_id=not.is.null&limit=5`) as any[])
      .find(l => Number(l.cantidad) - Number(l.cantidad_reservada ?? 0) >= 1)
    if (noGlobal) {
      const r = await rpc(hOwner, 'fn_venta_reservar_linea', { p_venta_item_id: itemId, p_linea_id: noGlobal.id, p_cantidad: 1 })
      expect(r.ok(), '[194] un LPN de otra sucursal fuera de una Global NO se puede reservar').toBeFalsy()
      expect(await r.text()).toMatch(/otra sucursal/i)
    }

    const rr = await rpc(hOwner, 'fn_venta_reservar_linea', { p_venta_item_id: itemId, p_linea_id: linea.id, p_cantidad: 2 })
    expect(rr.ok(), await rr.text()).toBeTruthy()
    expect(await rr.json(), '[194] se reservan las 2 del LPN de Norte en la Global').toBe(2)
    const pr = await request.patch(url(`ventas?id=eq.${ventaId}`), { headers: hOwner, data: { estado: 'reservada' } })
    expect(pr.ok(), await pr.text()).toBeTruthy()
    const pedidos = await get(hOwner, `pedidos?venta_origen_id=eq.${ventaId}&select=id,estado,sucursal_id`) as any[]
    expect(pedidos, '[194] la reserva tiene que generar el pedido').toHaveLength(1)
    pedidoId = pedidos[0].id
    expect(pedidos[0].sucursal_id, '[194] el pedido es de Sur (la venta es de Sur)').toBe(SUR)

    // Lanzar: la tarea cae en NORTE, sobre el LPN reservado.
    const rl = await rpc(hOwner, 'fn_generar_tareas_picking_pedido', { p_pedido_id: pedidoId })
    expect(rl.ok(), await rl.text()).toBeTruthy()
    const tareas = await get(hOwner, `wms_tareas?pedido_id=eq.${pedidoId}&select=id,sucursal_id,lpn_origen,cantidad,estado`) as any[]
    expect(tareas, '[194] una tarea de picking').toHaveLength(1)
    expect(tareas[0].sucursal_id, '[194] la tarea es de NORTE (dueña del stock)').toBe(NORTE)
    expect(tareas[0].lpn_origen).toBe(linea.lpn)

    // Sur (restringido) no ve la tarea por la RLS, pero sí el avance por la función.
    expect(await get(hSur, `wms_tareas?pedido_id=eq.${pedidoId}&select=id`), '[194] la RLS le oculta la tarea a Sur').toHaveLength(0)
    const avance = await (await rpc(hSur, 'fn_pedido_tareas_detalle', { p_pedido_ids: [pedidoId] })).json() as any[]
    expect(avance.map(t => t.sucursal_id), '[194] Sur ve el avance (la tarea de Norte)').toEqual([NORTE])

    // Norte (restringido) ve su tarea y el pedido destino, y la completa → el pedido de Sur queda listo.
    const deNorte = await (await rpc(hNorte, 'fn_pedidos_de_mis_tareas', { p_pedido_ids: [pedidoId] })).json() as any[]
    expect(deNorte[0]?.sucursal_id, '[194] Norte sabe que el pedido es para Sur').toBe(SUR)
    const rc = await rpc(hNorte, 'fn_completar_tarea_picking', { p_tarea_id: tareas[0].id })
    expect(rc.ok(), await rc.text()).toBeTruthy()
    const ped = (await get(hOwner, `pedidos?id=eq.${pedidoId}&select=estado`))[0]
    expect(ped.estado, '[194] completó Norte (que no ve el pedido): el pedido de Sur tiene que quedar listo').toBe('listo_para_entrega')
  } finally {
    if (pedidoId) {
      await request.delete(url(`wms_tareas?pedido_id=eq.${pedidoId}`), { headers: hOwner })
      await request.delete(url(`pedido_items?pedido_id=eq.${pedidoId}`), { headers: hOwner })
      await request.delete(url(`pedidos?id=eq.${pedidoId}`), { headers: hOwner })
    }
    if (ventaId) await request.delete(url(`ventas?id=eq.${ventaId}`), { headers: hOwner })
    const despues = (await get(hOwner, `inventario_lineas?id=eq.${linea.id}&select=cantidad_reservada`))[0]
    expect(despues.cantidad_reservada, '[194] al borrar la venta la reserva se libera').toBe(antes.cantidad_reservada)
  }
})
