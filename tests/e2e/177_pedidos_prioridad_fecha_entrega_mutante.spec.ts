/**
 * 177_pedidos_prioridad_fecha_entrega_mutante.spec.ts
 * E2E MUTANTE — Pedidos ordenados por fecha de entrega (pedido de GO 2026-10-02).
 *
 * La fecha de entrega acordada en la venta con envío llega al pedido (mig 465, probado con SQL). Acá: la lista de
 * Pedidos ordena por fecha de entrega (atrasado → hoy → mañana → resto → sin fecha) y marca cada uno; la fecha se ve
 * en el día correcto (antes `new Date('YYYY-MM-DD')` la mostraba un día antes en Argentina).
 * Siembra 3 pedidos con una referencia única; los cancela en `finally`.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

test('Pedidos: atrasado primero, después hoy y mañana, con su etiqueta', async ({ page }) => {
  test.setTimeout(120_000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [tipo] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/tipos_pedido?select=id,tenant_id&activo=eq.true&limit=1`, { headers })).json()) as any[]
  expect(tipo, '[177] el negocio no tiene tipos de pedido').toBeTruthy()

  const hoy = new Date()
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1)
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)
  const ref = `E2E177-${Date.now()}`
  const ids: string[] = []
  try {
    // Se crean en orden "equivocado" (mañana, hoy, ayer) para que el orden por creación no coincida con el esperado.
    for (const [suf, fecha] of [['M', manana], ['H', hoy], ['A', ayer]] as const) {
      const r = await page.request.post(`${SUPABASE_URL}/rest/v1/pedidos`, {
        headers: { ...headers, Prefer: 'return=representation' },
        data: { tenant_id: tipo.tenant_id, tipo_pedido_id: tipo.id, estado: 'confirmado', referencia: `${ref}-${suf}`,
          fecha_entrega_solicitada: iso(fecha), cliente_nombre: 'E2E 177' },
      })
      expect(r.ok(), `[177] pedido ${suf}: ${await r.text()}`).toBe(true)
      ids.push(((await r.json()) as any[])[0].id)
    }

    await page.evaluate(() => { try { localStorage.removeItem('pedidos-orden') } catch { /* */ } })
    await goto(page, '/pedidos')
    await waitForApp(page)
    await page.getByPlaceholder(/Buscar/).first().fill(ref)

    const filas = page.locator('span[title="Referencia / Nº externo"]')
    await expect(filas).toHaveCount(3, { timeout: 15000 })
    await expect(filas).toHaveText([`${ref}-A`, `${ref}-H`, `${ref}-M`])

    await expect(page.getByText(`Atrasado · ${ayer.toLocaleDateString('es-AR')}`)).toBeVisible()
    await expect(page.getByText(`Hoy · ${hoy.toLocaleDateString('es-AR')}`)).toBeVisible()
    await expect(page.getByText(`Mañana · ${manana.toLocaleDateString('es-AR')}`)).toBeVisible()

    // "Más recientes primero" vuelve al orden por creación (el último creado fue el de ayer).
    await page.getByLabel('Orden de los pedidos').selectOption('recientes')
    await expect(filas).toHaveText([`${ref}-A`, `${ref}-H`, `${ref}-M`])
  } finally {
    for (const id of ids) {
      await page.request.patch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${id}`, { headers, data: { estado: 'cancelado' } })
    }
  }
})
