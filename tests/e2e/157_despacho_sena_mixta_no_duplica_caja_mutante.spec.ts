/**
 * 157 — UAT 57.9 · 🛑 REGLA #0: despachar una reserva con seña MIXTA (pesos + USD) no vuelve a sumar
 * la seña a la caja en pesos (mutante).
 *
 * El escenario figuraba como "✅ código — sin e2e": verificado leyendo `VentasPage`, nunca ejecutado.
 *
 * El bug (2026-09-14): al despachar, el código pregunta si la seña YA fue asentada en caja al reservar
 * (`VentasPage.tsx`, ~línea 5045). Esa consulta usaba `.maybeSingle()`, que **con DOS filas devuelve
 * error y `data: null`** — y una seña mixta asienta exactamente dos: una en la caja en pesos y otra en
 * la Caja USD. Se leía "la seña no está en caja" y se la volvía a sumar al ingreso en pesos, dólares
 * incluidos. Ahora es `.limit(1)` + "¿existe al menos una?".
 *
 * Cómo se reproduce sin depender del POS: la reserva y sus dos asientos de seña se siembran por REST
 * (mismo patrón que el spec 149). La venta va **sin ítems** a propósito — el despacho recorre
 * `for (const item of items ?? [])`, así que sin ítems no rebaja stock ni puede fallar por faltante, y
 * el flujo llega igual al bloque de caja, que es lo único bajo prueba. Y `monto_pagado = total` para
 * que no quede saldo: así "Finalizar" despacha directo, sin pasar por el modal de cobro.
 *
 * Aserción mutante: después de despachar NO puede existir ningún `ingreso` con concepto `Venta #N`.
 * Con el código viejo aparecía uno por el monto de la seña en pesos.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, garantizarCajaAbierta } from './helpers/fixtures'

const SENA_ARS = 7000
const SENA_USD = 5

test.describe('Ventas — despacho de reserva con seña mixta (REGLA #0, mutante)', () => {
  // 🚧 NO CERRADO — queda documentado en vez de perderse. Todo lo de arriba funciona (la reserva se
  // siembra, las dos señas quedan asentadas, la fila aparece en el Historial y la ficha se abre),
  // pero el despacho no se puede disparar desde acá:
  //
  //   Sembrar una venta `reservada` hace que se cree un **Pedido** automáticamente, y mientras ese
  //   pedido está activo `VentasPage` reemplaza "Finalizar (rebaja stock)" por el aviso "Esta venta
  //   tiene el Pedido #N en curso — la mercadería todavía se está preparando en depósito". Es
  //   deliberado, no un bug. Peor: `pedidoActivoVenta` es una query async, así que en el PRIMER
  //   render el botón sí existe — el click entra, no hace nada, y el fallo aparece después como
  //   "la venta no llegó a despacharse", lejos de la causa.
  //
  // Para cerrarlo hay dos caminos, los dos más largos que este spec:
  //   (a) entregar el pedido primero (Pedidos → Picking) y recién ahí finalizar la venta, o
  //   (b) sembrar la reserva de modo que no genere pedido, si es que se puede.
  //
  // Se deja `skip` para no romper el CI. El escenario sigue figurando como "código — sin e2e" en
  // `tests/specs/uat-modo-basico.md` (57.9).
  test.skip('la seña ya asentada no se vuelve a sumar a la caja en pesos (57.9)', async ({ page, request }) => {
    test.setTimeout(150000)

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const userId = ((await (await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers })).json()) as { id: string }).id
    const [me] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=tenant_id`, { headers },
    )).json()) as Array<{ tenant_id: string }>
    expect(me?.tenant_id, '[157] el usuario de prueba no tiene negocio').toBeTruthy()
    const tenantId = me.tenant_id

    // La caja en pesos TIENE que estar abierta: el bloque bajo prueba corre `if (_sesionId)`.
    await garantizarCajaAbierta(page)

    /** Sesión abierta de una caja por nombre; si no hay, la abre por REST (patrón del spec 149). */
    const sesionAbierta = async (nombre: string, moneda: 'ARS' | 'USD'): Promise<string> => {
      const [caja] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/cajas?nombre=eq.${encodeURIComponent(nombre)}&select=id,sucursal_id,moneda`,
        { headers },
      )).json()) as Array<{ id: string; sucursal_id: string | null; moneda: string }>
      expect(caja, `[157] no existe la caja "${nombre}" en el negocio de prueba (precondición de infraestructura)`).toBeTruthy()
      expect(caja.moneda, `[157] la caja "${nombre}" debía ser en ${moneda}`).toBe(moneda)
      const [abierta] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/caja_sesiones?caja_id=eq.${caja.id}&estado=eq.abierta&select=id`, { headers },
      )).json()) as Array<{ id: string }>
      if (abierta) return abierta.id
      const alta = await request.post(`${SUPABASE_URL}/rest/v1/caja_sesiones`, {
        headers,
        data: {
          tenant_id: tenantId, caja_id: caja.id, usuario_id: userId, abierta_por: userId,
          monto_apertura: 0, estado: 'abierta', moneda, sucursal_id: caja.sucursal_id,
        },
      })
      expect(alta.ok(), `[157] no se pudo abrir la caja "${nombre}": ${await alta.text()}`).toBe(true)
      return ((await alta.json()) as Array<{ id: string }>)[0].id
    }

    const sesionArs = await sesionAbierta('Caja1', 'ARS')
    const sesionUsd = await sesionAbierta('Caja USD', 'USD')

    const COTIZACION = 1400
    const TOTAL = SENA_ARS + SENA_USD * COTIZACION   // sin saldo: la seña cubre el total

    // 🛑 La venta TIENE que nacer en la sucursal que el Historial está filtrando. La primera versión
    // la sembraba sin `sucursal_id` y la fila nunca aparecía en la lista (el filtro de sucursal la
    // dejaba afuera), con un fallo que parecía de locator y era de datos. Se lee del mismo lugar que
    // usa `useSucursalFilter`, así coincide con lo que el navegador tiene seleccionado.
    // 🛑 La venta tiene que nacer en la MISMA sucursal por la que filtra el Historial, o la fila no
    // aparece nunca y el fallo parece de locator. Dos intentos fallidos antes de entender esto:
    //   1º sin `sucursal_id` → el filtro la dejaba afuera.
    //   2º leyendo `localStorage('sucursal-id')` con fallback a `sucursales?limit=1` → el localStorage
    //      vino vacío y la API devuelve "Sucursal Sur" PRIMERO, así que sembraba en Sur mientras la
    //      pantalla filtraba por Norte.
    // Ahora no se depende ni del localStorage previo ni del orden de la API: se elige una sucursal,
    // se fuerza en el filtro (que es de donde lo lee `useSucursalFilter`) y se siembra con ese id.
    const sucursales = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/sucursales?activo=eq.true&select=id,nombre`, { headers },
    )).json()) as Array<{ id: string; nombre: string }>
    expect(sucursales?.length, '[157] el negocio de prueba necesita al menos una sucursal activa').toBeGreaterThan(0)
    const sucursalId = sucursales[0].id
    await page.evaluate(id => localStorage.setItem('sucursal-id', id), sucursalId)

    // `formatTicket` cae en el fallback `#N` mientras la sucursal no tenga `codigo` configurado
    // (verificado en el negocio de prueba: el Historial muestra "#837", no "COD-0837").
    const ventaRes = await request.post(`${SUPABASE_URL}/rest/v1/ventas`, {
      headers,
      data: {
        tenant_id: tenantId, estado: 'reservada', subtotal: TOTAL, total: TOTAL,
        monto_pagado: TOTAL, cotizacion_usd: COTIZACION, usuario_id: userId,
        sucursal_id: sucursalId,
        reservado_at: new Date().toISOString(),
        medio_pago: JSON.stringify([
          { tipo: 'Efectivo', monto: SENA_ARS },
          { tipo: 'Efectivo USD', monto: SENA_USD * COTIZACION, monto_usd: SENA_USD },
        ]),
      },
    })
    expect(ventaRes.ok(), `[157] no se pudo sembrar la reserva: ${await ventaRes.text()}`).toBe(true)
    const [venta] = (await ventaRes.json()) as Array<{ id: string; numero: number }>

    const creados: string[] = []
    try {
      // 🛑 Las DOS filas de seña: son las que hacían devolver `null` a `.maybeSingle()`.
      for (const asiento of [
        { sesion_id: sesionArs, monto: SENA_ARS, moneda: 'ARS' },
        { sesion_id: sesionUsd, monto: SENA_USD, moneda: 'USD' },
      ]) {
        const res = await request.post(`${SUPABASE_URL}/rest/v1/caja_movimientos`, {
          headers,
          data: {
            tenant_id: tenantId, sesion_id: asiento.sesion_id, tipo: 'ingreso_reserva',
            concepto: `Seña Venta #${venta.numero}`, monto: asiento.monto, moneda: asiento.moneda,
            usuario_id: userId,
          },
        })
        expect(res.ok(), `[157] no se pudo sembrar la seña en ${asiento.moneda}: ${await res.text()}`).toBe(true)
        creados.push(((await res.json()) as Array<{ id: string }>)[0].id)
      }

      // Control de partida: la consulta que hace la app encuentra DOS filas (el escenario del bug).
      const previos = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/caja_movimientos?tenant_id=eq.${tenantId}&tipo=eq.ingreso_reserva` +
          `&concepto=eq.${encodeURIComponent(`Seña Venta #${venta.numero}`)}&select=id`,
        { headers },
      )).json()) as Array<{ id: string }>
      expect(previos, '[157] el escenario necesita las DOS señas asentadas (pesos + dólares)').toHaveLength(2)

      // ── Despachar por UI ──
      await goto(page, '/ventas?tab=historial')
      await waitForApp(page)
      const fila = page.locator('div.cursor-pointer').filter({ hasText: `#${venta.numero}` }).first()
      await expect(
        fila,
        `[157] no apareció la reserva #${venta.numero} en el Historial. Si el negocio filtra por ` +
          `sucursal, una venta sembrada sin sucursal_id puede quedar fuera de la lista.`,
      ).toBeVisible({ timeout: 15000 })
      await fila.click()

      const finalizar = page.getByRole('button', { name: /Finalizar \(rebaja stock\)/ })
      await expect(finalizar, '[157] no apareció "Finalizar (rebaja stock)" en la ficha de la reserva').toBeVisible({ timeout: 10000 })
      await finalizar.click()

      // POSITIVO: la venta quedó despachada de verdad (si no, lo de abajo no probaría nada).
      await expect.poll(async () => {
        const [v] = (await (await request.get(
          `${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}&select=estado`, { headers },
        )).json()) as Array<{ estado: string }>
        return v?.estado
      }, { timeout: 20000, message: '[157] la venta no llegó a despacharse' }).toBe('despachada')

      // 🛑 LA ASERCIÓN: la seña NO se volvió a sumar a la caja en pesos.
      const movs = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/caja_movimientos?tenant_id=eq.${tenantId}&tipo=eq.ingreso` +
          `&concepto=eq.${encodeURIComponent(`Venta #${venta.numero}`)}&select=id,monto,moneda`,
        { headers },
      )).json()) as Array<{ id: string; monto: number | string; moneda: string }>
      creados.push(...movs.map(m => m.id))
      expect(
        movs,
        `🛑 [157] la seña se volvió a asentar en la caja en pesos al despachar (era el bug de 57.9). ` +
          `Movimientos encontrados: ${JSON.stringify(movs)}`,
      ).toHaveLength(0)
    } finally {
      for (const id of creados) {
        await request.delete(`${SUPABASE_URL}/rest/v1/caja_movimientos?id=eq.${id}`, { headers })
      }
      // Por las dudas, barrer cualquier movimiento que el despacho haya dejado con este número.
      await request.delete(
        `${SUPABASE_URL}/rest/v1/caja_movimientos?tenant_id=eq.${tenantId}` +
          `&concepto=like.*Venta%20%23${venta.numero}`,
        { headers },
      )
      await request.delete(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, { headers })
    }
  })
})
