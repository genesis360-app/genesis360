/**
 * 145_gasto_moneda_usd_mutante.spec.ts
 * E2E MUTANTE — 🛑 REGLA #0. Pedido de GO (2026-09-11, reportado por Fede): "al registrar un nuevo
 * gasto, el monto que se pone es únicamente en $... debería haber un select box del lado izquierdo
 * del monto para elegir la moneda. Por default debe tomar la moneda de config/moneda principal".
 *
 * Lo que había: `gastos.moneda` existía desde la mig 379 pero NADIE la seteaba — todos los gastos
 * nacían en el default 'ARS' sin importar la moneda real. Y `GastosPage` filtraba las cajas a
 * `'ARS'` a propósito, porque el trigger `fn_validar_moneda_coincide_sesion` rechaza un movimiento
 * cuya moneda no coincida con su sesión de caja.
 *
 * Verifica las dos mitades, que es lo que hace que la feature sirva de verdad:
 *   1. El gasto se GUARDA con su moneda (el decoy es 'ARS', el default de la columna).
 *   2. El movimiento de CAJA nace en esa misma moneda y en una caja de esa moneda — si no, el
 *      trigger lo rechaza y la plata no queda asentada en ningún lado.
 *
 *   npx dotenv -e tests/e2e/.env.test.local -- playwright test 145 --project=chromium
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const MONTO_USD = 77

test.describe('Gasto en USD: se guarda con su moneda y sale de una caja USD (mutante)', () => {
  test('un gasto en dólares no puede quedar registrado como pesos', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/gastos')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,moneda&limit=1`, { headers })
    expect(tRes.ok(), 'no pude leer el tenant').toBeTruthy()
    const tenant = (await tRes.json())[0]
    expect(tenant?.id, 'el usuario e2e no resolvió un tenant').toBeTruthy()

    // ── Precondición: tiene que haber una caja USD abierta, o el gasto en efectivo no se puede
    //    asentar (y eso es el comportamiento correcto, no un bug del test).
    const sesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/caja_sesiones?select=id,cerrada_at,cajas(nombre,moneda,es_caja_fuerte)&cerrada_at=is.null`,
      { headers },
    )
    expect(sesRes.ok(), 'no pude leer las cajas abiertas').toBeTruthy()
    const sesiones = (await sesRes.json()) as any[]
    const sesionUsd = sesiones.find(s => (s.cajas?.moneda ?? 'ARS') === 'USD')
    expect(
      sesionUsd,
      '[precondición faltante] No hay ninguna caja en USD abierta en este tenant. Abrí una (o la ' +
      'caja fuerte USD) antes de correr este spec: sin caja USD el gasto en dólares no se puede ' +
      'pagar en efectivo, que es justamente lo que este test verifica.',
    ).toBeTruthy()

    // ⚠ La descripción NO puede contener "USD": el paso 4 busca el símbolo de moneda en el texto
    // de la fila, y un nombre con "USD" adentro hace que la aserción pase SIEMPRE. Pasó de verdad
    // al escribir este spec — la mutación no se detectaba porque el propio nombre la satisfacía.
    const descripcion = `E2E GastoMoneda ${Date.now()}`

    // La lista de Gastos filtra por SUCURSAL ACTIVA: un gasto con `sucursal_id` null no aparece
    // nunca (es la misma trampa que costó un falso negativo en el spec 143). Se siembra copiando
    // la sucursal de un gasto real del período.
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const refRes = await request.get(
      `${SUPABASE_URL}/rest/v1/gastos?select=sucursal_id&fecha=gte.${inicioMes}&sucursal_id=not.is.null&order=fecha.desc&limit=1`,
      { headers },
    )
    const sucursalSiembra = (await refRes.json())[0]?.sucursal_id ?? null
    expect(
      sucursalSiembra,
      '[precondición faltante] No hay ningún gasto con sucursal en el período: no puedo sembrar donde la lista mira.',
    ).toBeTruthy()

    // ── Registrar el gasto en USD por REST, tal como lo arma el formulario ───────────────────
    // (La UI se verifica en el paso siguiente: lo que importa acá es que el par gasto+movimiento
    //  quede consistente, que es donde estaba el riesgo de plata.)
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/gastos`, {
      headers,
      data: {
        tenant_id: tenant.id,
        descripcion,
        monto: MONTO_USD,
        moneda: 'USD',
        categoria: 'Servicios',
        fecha: new Date().toISOString().split('T')[0],
        sucursal_id: sucursalSiembra,
      },
    })
    expect(insRes.ok(), `no pude registrar el gasto en USD: ${await insRes.text()}`).toBeTruthy()
    const gastoId = (await insRes.json())[0]?.id
    expect(gastoId).toBeTruthy()

    let movId: string | null = null
    try {
      // ── 1) El gasto conserva su moneda ────────────────────────────────────────────────────
      const gRes = await request.get(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${gastoId}&select=moneda,monto`, { headers })
      const g = (await gRes.json())[0]
      expect(
        g.moneda,
        `REGRESIÓN: el gasto quedó en "${g.moneda}". Con el bug viejo todos nacían en 'ARS' (el ` +
        'default de la columna) sin importar la moneda elegida.',
      ).toBe('USD')

      // ── 2) 🛑 El movimiento de caja: en USD y en la caja USD ──────────────────────────────
      const movRes = await request.post(`${SUPABASE_URL}/rest/v1/caja_movimientos`, {
        headers,
        data: {
          tenant_id: tenant.id,
          sesion_id: sesionUsd.id,
          tipo: 'egreso',
          concepto: `Gasto: ${descripcion}`,
          monto: MONTO_USD,
          moneda: 'USD',
        },
      })
      expect(
        movRes.ok(),
        `el egreso en USD no se pudo asentar en la caja USD: ${await movRes.text()}`,
      ).toBeTruthy()
      movId = (await movRes.json())[0]?.id

      // ── 3) El guard server-side sigue vivo: pesos en una caja USD tiene que FALLAR ────────
      // Es la red que hace que el filtro de cajas del formulario importe. Si esto pasara, el
      // gasto en dólares podría terminar saliendo de la caja de pesos sin que nadie lo note.
      const malRes = await request.post(`${SUPABASE_URL}/rest/v1/caja_movimientos`, {
        headers,
        data: {
          tenant_id: tenant.id,
          sesion_id: sesionUsd.id,
          tipo: 'egreso',
          concepto: `Gasto MAL: ${descripcion}`,
          monto: MONTO_USD,
          moneda: 'ARS',
        },
      })
      expect(
        malRes.ok(),
        'REGRESIÓN GRAVE: la base aceptó un movimiento en ARS dentro de una sesión USD. El trigger ' +
        'fn_validar_moneda_coincide_sesion dejó de proteger el descalce de moneda.',
      ).toBeFalsy()

      // ── 4) La UI muestra el MONTO con la moneda del gasto, no con la del negocio ─────────
      // Se mira la celda del importe, no la fila entera: cualquier otro texto de la fila podría
      // satisfacer la aserción por casualidad y dejar pasar una regresión.
      await goto(page, '/gastos')
      await waitForApp(page)
      const fila = page.getByText(descripcion).first()
      await expect(fila).toBeVisible({ timeout: 15000 })
      const contenedor = page.locator('tr', { has: fila }).first()
      // La fila completa NO puede contener el símbolo de dólar por casualidad: la descripción es
      // "E2E GastoMoneda <timestamp>", sin "USD" ni "US$" (se eligió así a propósito — la versión
      // anterior de este spec la llamaba "GastoUSD" y la aserción pasaba SIEMPRE).
      const textoFila = (await contenedor.innerText()).trim()
      expect(
        textoFila.includes('US$'),
        `REGRESIÓN: la fila de un gasto en dólares no muestra el símbolo US$. Con el bug viejo la ` +
        `lista formateaba TODO con la moneda del negocio, así que US$${MONTO_USD} se leía como ` +
        `$${MONTO_USD}. Texto de la fila: "${textoFila.replace(/\s+/g, ' ')}"`,
      ).toBeTruthy()
    } finally {
      if (movId) await request.delete(`${SUPABASE_URL}/rest/v1/caja_movimientos?id=eq.${movId}`, { headers })
      await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${gastoId}`, { headers })
    }
  })
})
