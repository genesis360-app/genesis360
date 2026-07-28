/**
 * 112_reasignar_stock_variante_mutante.spec.ts
 * E2E MUTANTE — Stock "SIN VARIANTE ASIGNADA" y su reparto (rediseño UoM Fase 4, mig 309).
 *
 * 🛑 REGLA #0 (INVENTARIO): esta operación MUEVE STOCK entre SKUs. Lo que este spec protege es
 * que NO se pierda ni se duplique una sola unidad, y que todo quede trazado.
 *
 * Escenario (todo sembrado por el propio spec, sin depender del estado de DEV):
 *   · Producto standalone con 17 unidades repartidas en 2 LPN.
 *   · Se le crean 2 variantes → pasa a ser AGRUPADOR y su stock queda "sin variante asignada".
 *   · Se reparte: LPN-A (10) → 6 a Rojo + 4 a Azul (parcial: parte la línea) · LPN-B (7) → 7 a
 *     Rojo (entero: RE-APUNTA el LPN, conserva su etiqueta física).
 *   · Se verifica en DB: la madre queda en 0, los hijos suman EXACTAMENTE lo repartido, el LPN-B
 *     conservó su lpn, el LPN-A quedó desactivado en 0 y hay un PAR de movimientos_stock por
 *     asignación (neto CERO, tipo `reasignacion_variante` — NO `ajuste_rebaje`, que el Dashboard
 *     contaría como merma).
 *   · NEGATIVOS server-side: reserva, sobre-asignación y destino que no es hijo.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Stock sin variante asignada (mutante)', () => {
  test('el reparto conserva cada unidad, traza el movimiento y rechaza lo inválido', async ({ page, request }) => {
    test.setTimeout(120000)
    const sello = Date.now()
    const nombreMadre = `E2E SinVariante ${sello}`

    // ── 1) Producto madre por UI ────────────────────────────────────────────────────────
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreMadre)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const madreRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreMadre)}&select=id,tenant_id,sku`,
      { headers },
    )
    const [madre] = (await madreRes.json()) as Array<{ id: string; tenant_id: string; sku: string }>
    expect(madre, '[112] no se encontró la madre recién creada').toBeTruthy()

    // Sucursal para las líneas (la primera del tenant)
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,nombre&limit=1`, { headers })
    const [sucursal] = (await sucRes.json()) as Array<{ id: string; nombre: string }>
    expect(sucursal, '[112] el tenant de prueba no tiene sucursales').toBeTruthy()

    // ── 2) Stock: 10 en LPN-A + 7 en LPN-B ──────────────────────────────────────────────
    const lpnA = `E2E112-A-${sello}`
    const lpnB = `E2E112-B-${sello}`
    const lineasRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: [
        { tenant_id: madre.tenant_id, producto_id: madre.id, lpn: lpnA, cantidad: 10, sucursal_id: sucursal.id, activo: true },
        { tenant_id: madre.tenant_id, producto_id: madre.id, lpn: lpnB, cantidad: 7, sucursal_id: sucursal.id, activo: true },
      ],
    })
    expect(lineasRes.ok(), `[112] no se pudo sembrar el stock: ${await lineasRes.text()}`).toBe(true)
    const lineas = (await lineasRes.json()) as Array<{ id: string; lpn: string }>
    const idA = lineas.find(l => l.lpn === lpnA)!.id
    const idB = lineas.find(l => l.lpn === lpnB)!.id

    const stockDe = async (id: string) => {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=stock_actual`, { headers })
      return Number(((await r.json()) as Array<{ stock_actual: number }>)[0]?.stock_actual ?? 0)
    }
    expect(await stockDe(madre.id), '[112] la madre tiene que arrancar con 17').toBe(17)

    // ── 3) Dos variantes hijo ───────────────────────────────────────────────────────────
    const crearHijo = async (dif: string) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
        headers: { ...headers, Prefer: 'return=representation' },
        data: {
          tenant_id: madre.tenant_id, nombre: dif, sku: `${madre.sku}-${dif.toUpperCase()}`,
          producto_padre_id: madre.id, variante_diferenciador: dif,
          precio_venta: 100, precio_costo: 50, unidad_medida: 'unidad', activo: true,
        },
      })
      expect(res.ok(), `[112] no se pudo crear la variante ${dif}: ${await res.text()}`).toBe(true)
      return ((await res.json()) as Array<{ id: string }>)[0].id
    }
    const rojoId = await crearHijo('Rojo')
    const azulId = await crearHijo('Azul')

    // La madre pasó a agrupador y su stock quedó "sin variante asignada": SIGUE contando.
    expect(await stockDe(madre.id), '[112] el stock de la madre no desaparece al crear variantes').toBe(17)

    const reasignar = (asignaciones: unknown[]) =>
      request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_reasignar_stock_variante`, {
        headers, data: { p_madre_id: madre.id, p_asignaciones: asignaciones },
      })

    // ── 4) 🛑 NEGATIVOS server-side — ninguno debe mover una sola unidad ─────────────────
    const sobre = await reasignar([{ linea_id: idA, hijo_id: rojoId, cantidad: 99 }])
    expect(sobre.ok(), '[112] repartir más unidades de las que tiene el LPN debe rechazarse').toBe(false)

    const noHijo = await reasignar([{ linea_id: idA, hijo_id: madre.id, cantidad: 1 }])
    expect(noHijo.ok(), '[112] un destino que no es variante de esta madre debe rechazarse').toBe(false)

    // Reserva: el LPN está comprometido con un pedido → no se puede mover
    await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${idA}`, {
      headers, data: { cantidad_reservada: 3 },
    })
    const conReserva = await reasignar([{ linea_id: idA, hijo_id: rojoId, cantidad: 1 }])
    expect(conReserva.ok(), '[112] un LPN con unidades reservadas debe rechazarse').toBe(false)
    await request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${idA}`, {
      headers, data: { cantidad_reservada: 0 },
    })

    expect(await stockDe(madre.id), '[112] tras 3 rechazos NO se movió ni una unidad').toBe(17)
    expect(await stockDe(rojoId), '[112] el hijo sigue en 0 tras los rechazos').toBe(0)

    // ── 5) POSITIVO — el reparto real ───────────────────────────────────────────────────
    const okRes = await reasignar([
      { linea_id: idA, hijo_id: rojoId, cantidad: 6 },   // parcial: parte el LPN
      { linea_id: idA, hijo_id: azulId, cantidad: 4 },
      { linea_id: idB, hijo_id: rojoId, cantidad: 7 },   // entero a un solo hijo: re-apunta el LPN
    ])
    expect(okRes.ok(), `[112] el reparto válido falló: ${await okRes.text()}`).toBe(true)

    // 🛑 Conservación: 17 antes = 17 después, repartidos entre los hijos
    const stockMadre = await stockDe(madre.id)
    const stockRojo = await stockDe(rojoId)
    const stockAzul = await stockDe(azulId)
    expect(stockMadre, '[112] la madre queda sin stock sin asignar').toBe(0)
    expect(stockRojo, '[112] Rojo = 6 (parcial) + 7 (LPN entero)').toBe(13)
    expect(stockAzul, '[112] Azul = 4').toBe(4)
    expect(stockMadre + stockRojo + stockAzul, '🛑 [112] NO se puede perder ni crear una unidad').toBe(17)

    // El LPN entero conservó su etiqueta física y cambió de dueño (misma caja, bien identificada)
    const lineaBRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${idB}&select=lpn,producto_id,cantidad,activo`, { headers },
    )
    const [lineaB] = (await lineaBRes.json()) as Array<{ lpn: string; producto_id: string; cantidad: number; activo: boolean }>
    expect(lineaB.lpn, '[112] el LPN re-apuntado conserva su etiqueta').toBe(lpnB)
    expect(lineaB.producto_id, '[112] el LPN entero ahora es del hijo').toBe(rojoId)
    expect(Number(lineaB.cantidad)).toBe(7)

    // El LPN partido quedó en 0 y DESACTIVADO (que ningún picker lo ofrezca como disponible)
    const lineaARes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${idA}&select=cantidad,activo`, { headers },
    )
    const [lineaA] = (await lineaARes.json()) as Array<{ cantidad: number; activo: boolean }>
    expect(Number(lineaA.cantidad), '[112] el LPN partido quedó vacío').toBe(0)
    expect(lineaA.activo, '[112] un LPN en 0 no puede quedar activo').toBe(false)

    // ── 6) Trazabilidad: un PAR de movimientos por asignación, neto CERO ─────────────────
    const movsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/movimientos_stock?producto_id=in.(${madre.id},${rojoId},${azulId})` +
        `&select=producto_id,tipo,cantidad&tipo=eq.reasignacion_variante`,
      { headers },
    )
    const movs = (await movsRes.json()) as Array<{ producto_id: string; tipo: string; cantidad: number }>
    expect(movs, '[112] 3 asignaciones × 2 lados = 6 movimientos').toHaveLength(6)

    const salidas = movs.filter(m => m.producto_id === madre.id).reduce((s, m) => s + Number(m.cantidad), 0)
    const entradas = movs.filter(m => m.producto_id !== madre.id).reduce((s, m) => s + Number(m.cantidad), 0)
    expect(salidas, '[112] la madre entregó 17').toBe(17)
    expect(entradas, '🛑 [112] los hijos recibieron exactamente lo que entregó la madre').toBe(salidas)

    // El tipo NO puede ser un ajuste: el Dashboard cuenta `ajuste_rebaje` como MERMA y esto
    // no es una pérdida — el neto es cero.
    const mermasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/movimientos_stock?producto_id=eq.${madre.id}&tipo=eq.ajuste_rebaje&select=id`,
      { headers },
    )
    expect((await mermasRes.json()) as unknown[],
      '🛑 [112] reasignar NO puede registrarse como merma').toHaveLength(0)

    // ── 7) Ya no queda nada por repartir ────────────────────────────────────────────────
    const vacio = await reasignar([{ linea_id: idB, hijo_id: azulId, cantidad: 1 }])
    expect(vacio.ok(), '[112] el LPN ya no pertenece a la madre: debe rechazarse').toBe(false)
  })
})
