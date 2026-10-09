/**
 * 192_reserva_atada_a_la_venta_mutante.spec.ts
 * 🛑 REGLA #0 (inventario) — Mig 488: la reserva queda anotada por venta (`venta_item_reservas`) y se libera / rebaja
 * EXACTAMENTE lo de esa venta.
 *
 * Antes: anular una venta liberaba "las primeras reservas del producto" (de cualquier venta y sucursal) — incluso al anular
 * una venta YA DESPACHADA —, y despachar una reserva descontaba reservas ajenas. Acá, sobre UN mismo LPN:
 *   A reserva 3 y B reserva 2 → LPN reservado +5 · anular C (despachada, sin reservas) no libera nada · despachar A rebaja 3
 *   y deja las 2 de B · liberar B devuelve 2 y una segunda liberación no libera nada · el LPN vuelve a cómo estaba.
 *
 * API-only (PostgREST con el token del OWNER, como el 94). Ventas de prueba en estado presupuesto ('pendiente') para no
 * disparar el pedido automático; se borran al final (borrar la venta libera lo que quede anotado). Corre contra DEV.
 */
import { test, expect } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'
const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test('la reserva se libera y se rebaja solo para la venta que la hizo', async ({ request }) => {
  test.setTimeout(60000)
  const h = { ...restHeaders(await loginToken(request)), Prefer: 'return=representation' }
  const get = async (path: string) => (await request.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: h })).json()
  const rpc = async (fn: string, body: any) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers: h, data: body })
    expect(r.ok(), `[192] ${fn}: ${await r.text()}`).toBeTruthy()
    return r.json()
  }
  const lpn = async (id: string) => (await get(`inventario_lineas?id=eq.${id}&select=cantidad,cantidad_reservada`))[0]

  // Un LPN de Norte, ubicado, sin serie, con al menos 5 libres.
  const candidatos = await get(
    `inventario_lineas?tenant_id=eq.${TENANT}&sucursal_id=eq.${NORTE}&activo=eq.true&ubicacion_id=not.is.null` +
    `&select=id,producto_id,cantidad,cantidad_reservada,productos!inner(tiene_series)&productos.tiene_series=eq.false&order=cantidad.desc&limit=20`)
  const linea = (candidatos as any[]).find(l => Number(l.cantidad) - Number(l.cantidad_reservada ?? 0) >= 5)
  test.skip(!linea, '[192] no hay un LPN de Norte con 5 unidades libres')
  const antes = await lpn(linea.id)

  const ventaIds: string[] = []
  const crearVenta = async (estado: string, cantidad: number) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers: h, data: { tenant_id: TENANT, sucursal_id: NORTE, estado, total: 0, notas: 'e2e 192 — reserva atada a la venta' },
    })
    expect(r.ok(), `[192] crear venta ${estado}: ${await r.text()}`).toBeTruthy()
    const venta = (await r.json())[0]
    ventaIds.push(venta.id)
    const ri = await request.post(`${SUPABASE_URL}/rest/v1/venta_items`, {
      headers: h, data: { tenant_id: TENANT, venta_id: venta.id, producto_id: linea.producto_id, cantidad, precio_unitario: 0, subtotal: 0 },
    })
    expect(ri.ok(), `[192] crear ítem: ${await ri.text()}`).toBeTruthy()
    return { ventaId: venta.id as string, itemId: (await ri.json())[0].id as string }
  }

  try {
    const A = await crearVenta('pendiente', 3)
    const B = await crearVenta('pendiente', 2)
    const C = await crearVenta('despachada', 4)

    expect(await rpc('fn_venta_reservar_linea', { p_venta_item_id: A.itemId, p_linea_id: linea.id, p_cantidad: 3 })).toBe(3)
    expect(await rpc('fn_venta_reservar_linea', { p_venta_item_id: B.itemId, p_linea_id: linea.id, p_cantidad: 2 })).toBe(2)
    expect((await lpn(linea.id)).cantidad_reservada, '[192] A + B reservan 5').toBe(antes.cantidad_reservada + 5)

    // Anular una venta YA DESPACHADA no puede liberar reservas ajenas (antes liberaba las primeras del producto).
    expect(await rpc('fn_venta_liberar_reservas', { p_venta_id: C.ventaId })).toBe(0)
    expect((await lpn(linea.id)).cantidad_reservada, '[192] anular C no toca las reservas de A y B').toBe(antes.cantidad_reservada + 5)

    // Despachar A rebaja SUS 3 y deja reservadas las 2 de B.
    const consumidas = await rpc('fn_venta_consumir_reservas', { p_venta_item_id: A.itemId }) as any[]
    expect(consumidas.reduce((s, c) => s + c.cantidad, 0), '[192] se rebaja lo reservado por A').toBe(3)
    expect(consumidas[0].linea_id).toBe(linea.id)
    const trasA = await lpn(linea.id)
    expect(trasA.cantidad, '[192] el LPN baja 3').toBe(antes.cantidad - 3)
    expect(trasA.cantidad_reservada, '[192] queda reservado solo lo de B').toBe(antes.cantidad_reservada + 2)

    // Liberar B devuelve 2; una segunda liberación no libera nada (no hay doble liberación).
    expect(await rpc('fn_venta_liberar_reservas', { p_venta_id: B.ventaId })).toBe(2)
    expect(await rpc('fn_venta_liberar_reservas', { p_venta_id: B.ventaId })).toBe(0)
    expect((await lpn(linea.id)).cantidad_reservada, '[192] el LPN vuelve a su reserva original').toBe(antes.cantidad_reservada)
  } finally {
    for (const id of ventaIds) await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${id}`, { headers: h })
    // Devolver las 3 unidades que "despachó" A (la venta de prueba no existe más).
    const ahora = await lpn(linea.id)
    if (ahora.cantidad !== antes.cantidad) {
      await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${linea.id}`, {
        headers: h, data: { cantidad: antes.cantidad, activo: true },
      })
    }
  }
})
