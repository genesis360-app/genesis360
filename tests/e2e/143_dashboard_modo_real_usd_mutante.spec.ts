/**
 * 143_dashboard_modo_real_usd_mutante.spec.ts
 * E2E MUTANTE — G1, "modo real" del Dashboard (3ra opción del filtro Moneda, pedido de Fede).
 *
 * Cubre DOS cosas de la misma tanda:
 *
 *  1) 🐛 REGLA #0 — el área Gastos sumaba dólares como si fueran pesos. `gastos.moneda` (mig 379)
 *     existe desde hace rato pero la query del Dashboard ni la leía: un gasto de US$100 sumaba
 *     $100 al total. El test siembra un gasto en USD y compara el total ANTES y DESPUÉS: el
 *     delta tiene que ser el monto por la COTIZACIÓN, no el número pelado. Si el fix regresara,
 *     el delta daría exactamente el monto en dólares (el valor decoy) y el test lo caza.
 *
 *  2) El modo "Real" no convierte: el número en pesos vuelve a ser el de antes de sembrar (los
 *     dólares salen de ahí) y los dólares aparecen APARTE, en su moneda, en la leyenda del KPI.
 *
 * Siembra por REST y limpia al final. Un gasto NO dispara movimiento de caja por trigger (lo
 * escribe la app), así que la siembra no mueve plata.
 *
 *   npx dotenv -e tests/e2e/.env.test.local -- playwright test 143 --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const MONTO_USD = 777          // decoy: si el fix regresa, el delta en pesos da exactamente esto
const TOLERANCIA = 2           // los KPI redondean a 0 decimales

async function irAGastosMetricas(page: Page) {
  await page.getByRole('button', { name: 'Gastos', exact: true }).first().click()
  await page.getByRole('button', { name: 'Métricas', exact: true }).first().click()
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
}

/** Lee el número del KPI "Total Salidas Operativas" (el <p> que sigue al título). */
async function totalSalidas(page: Page): Promise<number> {
  const card = page.locator('div', { has: page.getByText('Total Salidas Operativas', { exact: true }) }).last()
  const valor = card.locator('p.text-3xl').first()
  await expect(valor).toBeVisible({ timeout: 15000 })
  await expect(valor).not.toHaveText('—', { timeout: 15000 })
  const txt = (await valor.innerText()).trim()
  // "$1.234.567" / "U$D 1.234" → número
  const n = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
  expect(Number.isFinite(n), `no pude leer el total de salidas de "${txt}"`).toBeTruthy()
  return n
}

async function elegirMoneda(page: Page, label: string) {
  await page.getByRole('button', { name: /Filtros/i }).first().click()
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.keyboard.press('Escape')
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
}

test.describe('Dashboard → modo "Real" y gastos en USD (mutante)', () => {
  test('un gasto en USD entra al total en pesos CONVERTIDO, y en modo Real va aparte', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // ── Contexto real: tenant y cotización vigente ──────────────────────────────
    const meRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id,cotizacion_usd&limit=1`, { headers })
    expect(meRes.ok(), 'no pude leer el tenant').toBeTruthy()
    const tenant = (await meRes.json())[0]
    expect(tenant?.id, 'el usuario e2e no resolvió un tenant').toBeTruthy()
    const cotizacion = parseFloat(String(tenant.cotizacion_usd ?? 0))
    expect(
      cotizacion > 1,
      `el tenant no tiene cotización cargada (${tenant.cotizacion_usd}) — sin ella el modo pesos no puede convertir y este test no mide nada`,
    ).toBeTruthy()

    // La sucursal de la siembra sale de un gasto REAL del período, y a propósito de uno CON
    // sucursal: el Dashboard filtra por la sucursal activa, así que un gasto con `sucursal_id`
    // null desaparece del KPI cuando hay una seleccionada (medido: el total daba exactamente la
    // suma de una sola sucursal). Una sucursal concreta cuenta en los dos casos — con esa
    // sucursal activa y con "Todas".
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const gRes = await request.get(
      `${SUPABASE_URL}/rest/v1/gastos?select=sucursal_id&fecha=gte.${inicioMes}&sucursal_id=not.is.null&order=fecha.desc&limit=1`,
      { headers },
    )
    expect(gRes.ok(), 'no pude leer un gasto de referencia del período').toBeTruthy()
    const sucursalSiembra = (await gRes.json())[0]?.sucursal_id ?? null
    expect(
      sucursalSiembra,
      'no hay ningún gasto con sucursal en el período: no puedo sembrar donde el Dashboard mira',
    ).toBeTruthy()

    // Foto explícita del estado ANTES de sembrar (nada de leer un total al azar después).
    await irAGastosMetricas(page)
    const antesArs = await totalSalidas(page)

    // ── Siembra en PESOS primero — control anti-vacío ───────────────────────────
    // Si el gasto sembrado no mueve el total (filtro de sucursal, período, RLS), el test tiene
    // que decir ESO y no fallar más adelante en una aserción de moneda que nunca se ejercitó.
    const descripcion = `E2E ModoReal USD ${Date.now()}`
    const hoy = new Date().toISOString().split('T')[0]
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/gastos`, {
      headers,
      data: {
        tenant_id: tenant.id,
        descripcion,
        monto: MONTO_USD,
        moneda: 'ARS',
        categoria: 'Servicios',
        fecha: hoy,
        sucursal_id: sucursalSiembra,
      },
    })
    expect(insRes.ok(), `no pude sembrar el gasto: ${await insRes.text()}`).toBeTruthy()
    const gastoId = (await insRes.json())[0]?.id
    expect(gastoId, 'la siembra no devolvió el id del gasto').toBeTruthy()

    try {
      await page.reload()
      await waitForApp(page)
      await irAGastosMetricas(page)
      const conGastoArs = await totalSalidas(page)
      expect(
        Math.abs((conGastoArs - antesArs) - MONTO_USD) <= TOLERANCIA,
        `el gasto sembrado (${MONTO_USD} en pesos, sucursal ${sucursalSiembra ?? 'null'}) no llegó al KPI: `
        + `el total pasó de $${antesArs.toFixed(0)} a $${conGastoArs.toFixed(0)}. `
        + 'Sin esto el resto del test no mide nada.',
      ).toBeTruthy()

      // ── 1) Ahora en dólares: el MISMO gasto tiene que entrar CONVERTIDO ───────
      const patchRes = await request.patch(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${gastoId}`, {
        headers, data: { moneda: 'USD' },
      })
      expect(patchRes.ok(), `no pude pasar el gasto a USD: ${await patchRes.text()}`).toBeTruthy()

      await page.reload()
      await waitForApp(page)
      await irAGastosMetricas(page)
      const despuesArs = await totalSalidas(page)
      const delta = despuesArs - antesArs
      const esperado = MONTO_USD * cotizacion

      expect(
        Math.abs(delta - esperado) <= Math.max(TOLERANCIA, esperado * 0.001),
        `el gasto de US$${MONTO_USD} tenía que sumar ~$${esperado.toFixed(0)} al total en pesos y sumó $${delta.toFixed(0)}`,
      ).toBeTruthy()
      // Mutante: el bug viejo sumaba el número pelado, como si un dólar valiera un peso.
      expect(
        Math.abs(delta - MONTO_USD) > TOLERANCIA,
        `REGRESIÓN: el total sumó exactamente ${MONTO_USD} — está sumando dólares como si fueran pesos`,
      ).toBeTruthy()

      // ── 2) Modo Real: los dólares salen del número en pesos y van aparte ──────
      await elegirMoneda(page, 'Real')
      const despuesReal = await totalSalidas(page)
      expect(
        Math.abs(despuesReal - antesArs) <= TOLERANCIA,
        `en modo Real el número en pesos tenía que volver a $${antesArs.toFixed(0)} (sin los dólares) y dio $${despuesReal.toFixed(0)}`,
      ).toBeTruthy()

      // Y los dólares se informan en su propia moneda, sin convertir.
      // Substring literal, no RegExp: en un string/template de JS `\$` y `\s` pierden la barra
      // y el patrón queda en /US$s?777/, que no matchea nada (pasó de verdad al escribir esto).
      await expect(page.getByText(`US$${MONTO_USD}`, { exact: false }).first())
        .toBeVisible({ timeout: 10000 })
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${gastoId}`, { headers })
    }
  })
})
