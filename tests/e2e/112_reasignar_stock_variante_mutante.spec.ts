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

test.describe('Stock sin variante asignada — SERIALIZADOS (mutante)', () => {
  test('cada serie va a la variante elegida, la vendida no se toca y los rechazos no mueven nada', async ({ page, request }) => {
    test.setTimeout(120000)
    const sello = Date.now()
    const nombreMadre = `E2E SerieVar ${sello}`

    await goto(page, '/productos')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ id: string; tenant_id: string }>
    expect(suc, '[112s] el tenant de prueba no tiene sucursales').toBeTruthy()

    // 1) Madre SERIALIZADA + 2 hijos serializados
    const crearProd = async (extra: Record<string, unknown>) => {
      const res = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
        headers: { ...headers, Prefer: 'return=representation' },
        data: {
          tenant_id: suc.tenant_id, precio_venta: 1000, precio_costo: 500,
          unidad_medida: 'unidad', activo: true, stock_minimo: 0, tiene_series: true, ...extra,
        },
      })
      expect(res.ok(), `[112s] no se pudo crear el producto: ${await res.text()}`).toBe(true)
      return ((await res.json()) as Array<{ id: string }>)[0].id
    }
    const madreId = await crearProd({ nombre: nombreMadre, sku: `E2E-SER-${sello}` })
    const hijo4G = await crearProd({ nombre: 'x', sku: `E2E-SER-4G-${sello}`, producto_padre_id: madreId, variante_diferenciador: '4G' })
    const hijo5G = await crearProd({ nombre: 'x', sku: `E2E-SER-5G-${sello}`, producto_padre_id: madreId, variante_diferenciador: '5G' })

    // 🛑 Que una madre SERIALIZADA pueda volverse agrupadora es justo lo que la mig 312 bloqueaba
    // y la 313 habilitó: sin el reparto por series sería un callejón sin salida (stock ni vendible
    // ni reasignable).

    // 2) Un LPN con 3 series activas + 1 ya vendida (activo=false)
    const lineaRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: suc.tenant_id, producto_id: madreId, lpn: `E2E-SER-LPN-${sello}`, cantidad: 0, sucursal_id: suc.id, activo: true },
    })
    const [linea] = (await lineaRes.json()) as Array<{ id: string; lpn: string }>

    const seriesRes = await request.post(`${SUPABASE_URL}/rest/v1/inventario_series`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: [
        { tenant_id: suc.tenant_id, producto_id: madreId, linea_id: linea.id, nro_serie: `SN-A-${sello}`, activo: true },
        { tenant_id: suc.tenant_id, producto_id: madreId, linea_id: linea.id, nro_serie: `SN-B-${sello}`, activo: true },
        { tenant_id: suc.tenant_id, producto_id: madreId, linea_id: linea.id, nro_serie: `SN-C-${sello}`, activo: true },
        { tenant_id: suc.tenant_id, producto_id: madreId, linea_id: linea.id, nro_serie: `SN-VENDIDA-${sello}`, activo: false },
      ],
    })
    expect(seriesRes.ok(), `[112s] no se pudieron sembrar las series: ${await seriesRes.text()}`).toBe(true)
    const series = (await seriesRes.json()) as Array<{ id: string; nro_serie: string }>
    const idDe = (frag: string) => series.find(s => s.nro_serie.startsWith(frag))!.id

    const stockDe = async (id: string) => {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/productos?id=eq.${id}&select=stock_actual`, { headers })
      return Number(((await r.json()) as Array<{ stock_actual: number }>)[0]?.stock_actual ?? 0)
    }
    // 🛑 El stock de un serializado son sus SERIES activas — la vendida no cuenta
    expect(await stockDe(madreId), '[112s] la madre arranca con 3 (la vendida no cuenta)').toBe(3)

    const reasignar = (asignaciones: unknown[]) =>
      request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_reasignar_stock_variante`, {
        headers, data: { p_madre_id: madreId, p_asignaciones: asignaciones },
      })

    // 3) 🛑 NEGATIVOS — ninguno puede mover una serie
    const vendida = await reasignar([{ linea_id: linea.id, hijo_id: hijo4G, series: [idDe('SN-VENDIDA')] }])
    expect(vendida.ok(), '[112s] una serie YA VENDIDA no se puede reasignar (es historial)').toBe(false)

    const duplicada = await reasignar([
      { linea_id: linea.id, hijo_id: hijo4G, series: [idDe('SN-A')] },
      { linea_id: linea.id, hijo_id: hijo5G, series: [idDe('SN-A')] },
    ])
    expect(duplicada.ok(), '[112s] la misma serie no puede ir a dos variantes').toBe(false)

    const sinSeries = await reasignar([{ linea_id: linea.id, hijo_id: hijo4G, cantidad: 2 }])
    expect(sinSeries.ok(), '[112s] en serializados no se puede repartir por cantidad a ciegas').toBe(false)

    expect(await stockDe(madreId), '[112s] tras los rechazos no se movió nada').toBe(3)

    // 4) POSITIVO — A y B a 4G, C a 5G
    const okRes = await reasignar([
      { linea_id: linea.id, hijo_id: hijo4G, series: [idDe('SN-A'), idDe('SN-B')] },
      { linea_id: linea.id, hijo_id: hijo5G, series: [idDe('SN-C')] },
    ])
    expect(okRes.ok(), `[112s] el reparto por series falló: ${await okRes.text()}`).toBe(true)

    // 🛑 Conservación: 3 antes = 3 después
    const sMadre = await stockDe(madreId), s4G = await stockDe(hijo4G), s5G = await stockDe(hijo5G)
    expect(sMadre, '[112s] la madre queda sin series sin asignar').toBe(0)
    expect(s4G, '[112s] 4G se quedó con 2 series').toBe(2)
    expect(s5G, '[112s] 5G se quedó con 1 serie').toBe(1)
    expect(sMadre + s4G + s5G, '🛑 [112s] no se puede perder ni crear una serie').toBe(3)

    // 5) Cada serie quedó bajo el SKU correcto — y la VENDIDA sigue en la madre
    const finalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_series?nro_serie=like.*${sello}&select=nro_serie,producto_id,activo`, { headers },
    )
    const finales = (await finalRes.json()) as Array<{ nro_serie: string; producto_id: string; activo: boolean }>
    const duenoDe = (frag: string) => finales.find(s => s.nro_serie.startsWith(frag))!.producto_id
    expect(duenoDe('SN-A'), '[112s] SN-A quedó en 4G').toBe(hijo4G)
    expect(duenoDe('SN-B'), '[112s] SN-B quedó en 4G').toBe(hijo4G)
    expect(duenoDe('SN-C'), '[112s] SN-C quedó en 5G').toBe(hijo5G)
    expect(duenoDe('SN-VENDIDA'),
      '🛑 [112s] la serie vendida NO se re-etiqueta: pertenece al historial del SKU con el que se vendió')
      .toBe(madreId)

    // 6) Coherencia serie↔línea: ninguna serie puede colgar de un LPN de otro producto
    const cohRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_series?nro_serie=like.*${sello}&select=nro_serie,producto_id,inventario_lineas(producto_id)`, { headers },
    )
    const coh = (await cohRes.json()) as Array<{ nro_serie: string; producto_id: string; inventario_lineas: { producto_id: string } }>
    coh.forEach(c => expect(c.inventario_lineas.producto_id,
      `🛑 [112s] ${c.nro_serie} cuelga de un LPN de otro producto`).toBe(c.producto_id))

    // 7) Trazabilidad: par de movimientos con neto cero
    const movsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/movimientos_stock?producto_id=in.(${madreId},${hijo4G},${hijo5G})&tipo=eq.reasignacion_variante&select=producto_id,cantidad`,
      { headers },
    )
    const movs = (await movsRes.json()) as Array<{ producto_id: string; cantidad: number }>
    expect(movs, '[112s] 2 asignaciones × 2 lados = 4 movimientos').toHaveLength(4)
    const salidas = movs.filter(m => m.producto_id === madreId).reduce((s, m) => s + Number(m.cantidad), 0)
    const entradas = movs.filter(m => m.producto_id !== madreId).reduce((s, m) => s + Number(m.cantidad), 0)
    expect(salidas).toBe(3)
    expect(entradas, '🛑 [112s] neto cero').toBe(salidas)

    // Cleanup
    const ids = [madreId, hijo4G, hijo5G]
    for (const t of ['inventario_series', 'movimientos_stock', 'inventario_lineas', 'producto_presentaciones', 'alertas']) {
      await request.delete(`${SUPABASE_URL}/rest/v1/${t}?producto_id=in.(${ids.join(',')})`, { headers })
    }
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?producto_padre_id=eq.${madreId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/alertas?producto_id=eq.${madreId}`, { headers })
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${madreId}`, { headers })
  })
})
