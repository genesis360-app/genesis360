/**
 * 149_anulacion_reintegro_usd_vuelto_mutante.spec.ts
 * E2E MUTANTE — 🛑 REGLA #0 (2026-09-14): el reintegro al anular una venta se reconstruye con la misma
 * cuenta que usó el cobro (`calcularReintegroAnulacion`, src/lib/ventasValidation.ts).
 *
 * Caso A — venta cobrada con Efectivo USD: los dólares tienen que SALIR de la Caja USD
 *   (`egreso_devolucion_sena`, moneda USD). Con el código viejo caían como `egreso_informativo`
 *   "[Efectivo USD]" en la caja en pesos y la Caja USD quedaba inflada, sin ningún aviso.
 * Caso B — venta en efectivo con vuelto ($1.500 entregados por una venta de $1.234): el egreso es el
 *   NETO que quedó en la caja ($1.234). Con el código viejo salían $1.500.
 * Caso C — venta pagada con Crédito a favor: el crédito VUELVE al saldo del cliente (`anulacion_venta`,
 *   `creditoARestituirPorAnulacion`) y la caja no se toca. Con el código viejo el cliente perdía el crédito.
 *
 * La venta, su asiento de cobro y la solicitud de anulación se siembran por REST: lo que se prueba es
 * la anulación, no el cobro (que ya cubren otros specs). La anulación se ejecuta por UI, aprobando la
 * autorización, que es el mismo camino que usa el spec 137.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta } from './helpers/fixtures'

type Ctx = { request: any; headers: Record<string, string>; tenantId: string; userId: string }
type Movimiento = { tipo: string; monto: number | string; moneda: string; sesion_id: string; concepto: string }

async function contexto(page: any, request: any): Promise<Ctx> {
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)
  const userRes = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers })
  expect(userRes.ok(), `[149] no se pudo leer el usuario: ${await userRes.text()}`).toBe(true)
  const userId = (await userRes.json()).id as string
  const rowRes = await request.get(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id`, { headers })
  const [row] = (await rowRes.json()) as Array<{ tenant_id: string }>
  expect(row?.tenant_id, '[149] el usuario de prueba no tiene negocio').toBeTruthy()
  return { request, headers, tenantId: row.tenant_id, userId }
}

/** Id de la sesión abierta de la caja `nombre`; si no hay ninguna, la abre por REST con apertura 0. */
async function sesionAbierta(c: Ctx, nombre: string, moneda: 'ARS' | 'USD'): Promise<string> {
  const cajaRes = await c.request.get(
    `${SUPABASE_URL}/rest/v1/cajas?nombre=eq.${encodeURIComponent(nombre)}&select=id,sucursal_id,moneda`,
    { headers: c.headers },
  )
  const [caja] = (await cajaRes.json()) as Array<{ id: string; sucursal_id: string | null; moneda: string }>
  expect(caja, `[149] no existe la caja "${nombre}" en el negocio de prueba (precondición de infraestructura)`).toBeTruthy()
  expect(caja.moneda, `[149] la caja "${nombre}" debía ser en ${moneda}`).toBe(moneda)

  const abiertaRes = await c.request.get(
    `${SUPABASE_URL}/rest/v1/caja_sesiones?caja_id=eq.${caja.id}&estado=eq.abierta&select=id`,
    { headers: c.headers },
  )
  const [abierta] = (await abiertaRes.json()) as Array<{ id: string }>
  if (abierta) return abierta.id

  const alta = await c.request.post(`${SUPABASE_URL}/rest/v1/caja_sesiones`, {
    headers: c.headers,
    data: {
      tenant_id: c.tenantId, caja_id: caja.id, usuario_id: c.userId, abierta_por: c.userId,
      monto_apertura: 0, estado: 'abierta', moneda, sucursal_id: caja.sucursal_id,
    },
  })
  expect(alta.ok(), `[149] no se pudo abrir la caja "${nombre}": ${await alta.text()}`).toBe(true)
  return ((await alta.json()) as Array<{ id: string }>)[0].id
}

/** Venta despachada + (opcional) su asiento de cobro en caja + la solicitud de anulación pendiente. */
async function sembrarVentaConSolicitud(c: Ctx, v: {
  total: number
  medioPago: object[]
  cotizacionUsd?: number
  clienteId?: string
  asiento?: { sesionId: string; monto: number; moneda: 'ARS' | 'USD' }
}): Promise<{ id: string; numero: number }> {
  const ventaRes = await c.request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
    headers: c.headers,
    data: {
      tenant_id: c.tenantId, estado: 'despachada', subtotal: v.total, total: v.total,
      medio_pago: JSON.stringify(v.medioPago), monto_pagado: v.total, usuario_id: c.userId,
      despachado_at: new Date().toISOString(),
      ...(v.cotizacionUsd ? { cotizacion_usd: v.cotizacionUsd } : {}),
      ...(v.clienteId ? { cliente_id: v.clienteId } : {}),
    },
  })
  expect(ventaRes.ok(), `[149] no se pudo sembrar la venta: ${await ventaRes.text()}`).toBe(true)
  const [venta] = (await ventaRes.json()) as Array<{ id: string; numero: number }>

  if (v.asiento) {
    const asiento = await c.request.post(`${SUPABASE_URL}/rest/v1/caja_movimientos`, {
      headers: c.headers,
      data: {
        tenant_id: c.tenantId, sesion_id: v.asiento.sesionId, tipo: 'ingreso', concepto: `Venta #${venta.numero}`,
        monto: v.asiento.monto, moneda: v.asiento.moneda, usuario_id: c.userId,
      },
    })
    expect(asiento.ok(), `[149] no se pudo sembrar el cobro en caja: ${await asiento.text()}`).toBe(true)
  }

  const aut = await c.request.post(`${SUPABASE_URL}/rest/v1/autorizaciones`, {
    headers: c.headers,
    data: {
      tenant_id: c.tenantId, modulo: 'ventas', tipo: 'eliminar_venta_despachada', estado: 'pendiente',
      solicitado_por: c.userId,
      datos_cambio: {
        venta_id: venta.id, venta_numero: venta.numero, total: v.total, estado: 'despachada',
        cliente_nombre: null, motivo: 'E2E 149 — reintegro al anular',
      },
    },
  })
  expect(aut.ok(), `[149] no se pudo sembrar la solicitud de anulación: ${await aut.text()}`).toBe(true)
  return venta
}

async function aprobarAnulacion(page: any, numero: number): Promise<void> {
  await goto(page, '/ventas?tab=autorizaciones')
  await waitForApp(page)
  const filaAut = page.locator('div').filter({ hasText: `#${numero}` })
    .filter({ has: page.getByRole('button', { name: /Aprobar/i }) }).last()
  await expect(filaAut, `[149] no apareció la autorización de la venta #${numero}`).toBeVisible({ timeout: 10000 })
  await filaAut.getByRole('button', { name: /Aprobar/i }).click()
  const confirmar = page.getByRole('alertdialog').getByRole('button', { name: /^Confirmar$/i })
  await expect(confirmar, '[149] no apareció el diálogo de confirmación al aprobar').toBeVisible({ timeout: 5000 })
  await confirmar.click()
  await expect(page.getByText(/Anulación aprobada y ejecutada/i)).toBeVisible({ timeout: 15000 })
}

/** Movimientos que asentó la anulación: `Dev. seña Venta #N` y `[medio] Dev. seña Venta #N`. */
async function movimientosDeLaAnulacion(c: Ctx, numero: number): Promise<Movimiento[]> {
  // Termina en "#N": no matchea #N0, #N1…
  const res = await c.request.get(
    `${SUPABASE_URL}/rest/v1/caja_movimientos?concepto=like.*Dev.%20se%C3%B1a%20Venta%20%23${numero}` +
      '&select=tipo,monto,moneda,sesion_id,concepto',
    { headers: c.headers },
  )
  expect(res.ok(), `[149] no se pudo leer caja_movimientos: ${await res.text()}`).toBe(true)
  return (await res.json()) as Movimiento[]
}

test.describe('Ventas — reintegro al anular (REGLA #0, mutante)', () => {
  test('cobrada con Efectivo USD: los dólares salen de la Caja USD y la caja en pesos no se toca', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const c = await contexto(page, request)

    // La caja en pesos queda abierta a propósito: el código viejo la exigía y terminaba asentando ahí
    // el informativo. Así la mutación falla en la aserción del egreso, no en el guard.
    await garantizarCajaAbierta(page)
    const sesionUsd = await sesionAbierta(c, 'Caja USD', 'USD')

    const USD = 20
    const COTIZACION = 1480
    const TOTAL = USD * COTIZACION
    const venta = await sembrarVentaConSolicitud(c, {
      total: TOTAL, cotizacionUsd: COTIZACION,
      medioPago: [{ tipo: 'Efectivo USD', monto: TOTAL, monto_usd: USD }],
      asiento: { sesionId: sesionUsd, monto: USD, moneda: 'USD' },
    })

    await aprobarAnulacion(page, venta.numero)

    const movs = await movimientosDeLaAnulacion(c, venta.numero)
    const egresoUsd = movs.filter(m => m.tipo === 'egreso_devolucion_sena' && m.moneda === 'USD')
    expect(egresoUsd, `[149A] debía haber UN egreso en dólares. Movimientos: ${JSON.stringify(movs)}`).toHaveLength(1)
    expect(Number(egresoUsd[0].monto), '[149A] el egreso debía ser por los dólares cobrados').toBe(USD)
    expect(egresoUsd[0].sesion_id, '[149A] el egreso debía ir a la sesión de la Caja USD').toBe(sesionUsd)
    expect(
      movs.filter(m => m.moneda !== 'USD'),
      `[149A] la anulación no debía mover nada en pesos. Movimientos: ${JSON.stringify(movs)}`,
    ).toHaveLength(0)
  })

  test('efectivo con vuelto: sale de la caja el neto que quedó, no lo que entregó el cliente', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const c = await contexto(page, request)

    await garantizarCajaAbierta(page)
    const sesionArs = await sesionAbierta(c, 'Caja1', 'ARS')

    const TOTAL = 1234
    const ENTREGADO = 1500
    const venta = await sembrarVentaConSolicitud(c, {
      total: TOTAL,
      medioPago: [{ tipo: 'Efectivo', monto: ENTREGADO }],
      asiento: { sesionId: sesionArs, monto: TOTAL, moneda: 'ARS' },
    })

    await aprobarAnulacion(page, venta.numero)

    const movs = await movimientosDeLaAnulacion(c, venta.numero)
    const egresos = movs.filter(m => m.tipo === 'egreso_devolucion_sena')
    expect(egresos, `[149B] debía haber UN egreso. Movimientos: ${JSON.stringify(movs)}`).toHaveLength(1)
    expect(Number(egresos[0].monto), '[149B] el egreso debía ser el neto que entró a la caja, sin el vuelto').toBe(TOTAL)
    expect(egresos[0].moneda, '[149B] el egreso debía ser en pesos').toBe('ARS')
  })

  test('pagada con Crédito a favor: el crédito vuelve al saldo del cliente y la caja no se toca', async ({ page, request }) => {
    test.setTimeout(120000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const c = await contexto(page, request)

    // Caja en pesos abierta a propósito (mismo motivo que en el caso A: el guard viejo la exigía).
    await garantizarCajaAbierta(page)

    const CREDITO = 500
    const clienteRes = await c.request.post(`${SUPABASE_URL}/rest/v1/clientes`, {
      headers: c.headers,
      data: { tenant_id: c.tenantId, nombre: `E2E 149 Crédito ${Date.now()}` },
    })
    expect(clienteRes.ok(), `[149C] no se pudo crear el cliente: ${await clienteRes.text()}`).toBe(true)
    const [cliente] = (await clienteRes.json()) as Array<{ id: string }>

    const saldoInicial = await c.request.post(`${SUPABASE_URL}/rest/v1/cliente_creditos`, {
      headers: c.headers,
      data: { tenant_id: c.tenantId, cliente_id: cliente.id, monto: CREDITO, origen: 'ajuste_e2e', nota: 'E2E 149 — saldo inicial', usuario_id: c.userId },
    })
    expect(saldoInicial.ok(), `[149C] no se pudo sembrar el saldo a favor: ${await saldoInicial.text()}`).toBe(true)

    const venta = await sembrarVentaConSolicitud(c, {
      total: CREDITO, clienteId: cliente.id,
      medioPago: [{ tipo: 'Crédito a favor', monto: CREDITO }],
    })
    // El consumo del crédito, tal como lo asienta registrarVenta.
    const consumo = await c.request.post(`${SUPABASE_URL}/rest/v1/cliente_creditos`, {
      headers: c.headers,
      data: {
        tenant_id: c.tenantId, cliente_id: cliente.id, monto: -CREDITO, origen: 'consumo_venta',
        venta_id: venta.id, nota: `Aplicado en Venta #${venta.numero}`, usuario_id: c.userId,
      },
    })
    expect(consumo.ok(), `[149C] no se pudo sembrar el consumo del crédito: ${await consumo.text()}`).toBe(true)

    await aprobarAnulacion(page, venta.numero)

    const credRes = await c.request.get(
      `${SUPABASE_URL}/rest/v1/cliente_creditos?cliente_id=eq.${cliente.id}&select=origen,monto,venta_id`,
      { headers: c.headers },
    )
    const creditos = (await credRes.json()) as Array<{ origen: string; monto: number | string; venta_id: string | null }>
    const restituido = creditos.filter(m => m.origen === 'anulacion_venta' && m.venta_id === venta.id)
    expect(restituido, `[149C] debía volver UN movimiento de crédito. Ledger: ${JSON.stringify(creditos)}`).toHaveLength(1)
    expect(Number(restituido[0].monto), '[149C] debía volver el crédito completo').toBe(CREDITO)
    const saldo = creditos.reduce((a, m) => a + Number(m.monto), 0)
    expect(saldo, '[149C] el saldo a favor del cliente debía quedar como antes de la venta').toBe(CREDITO)

    const movs = await movimientosDeLaAnulacion(c, venta.numero)
    expect(movs, `[149C] el crédito no pasa por la caja. Movimientos: ${JSON.stringify(movs)}`).toHaveLength(0)
  })
})
