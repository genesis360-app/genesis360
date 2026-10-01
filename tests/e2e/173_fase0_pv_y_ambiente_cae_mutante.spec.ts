/**
 * 173_fase0_pv_y_ambiente_cae_mutante.spec.ts
 * E2E MUTANTE (AFIP homologación) — Fase 0 de "Empezar de cero", mig 453 + EF `emitir-factura` (REGLA #0).
 *
 * El caso de El Tilo (29/09): un negocio cuyo punto de venta NO es el 1. Todos los tests facturaban en el PV 1, por eso
 * los errores de PV eran invisibles.
 *  A · Factura B emitida desde el POS en el PV 2 → la venta queda con `punto_venta = 2` y `cae_ambiente =
 *      'homologacion'`, y el PDF imprime 0002 (antes imprimía el PRIMER PV del emisor: 0001).
 *  B · NC emitida desde el PV 1 sobre esa factura → ARCA la acepta porque `CbtesAsoc` referencia el PV 2 de la factura
 *      (antes armaba el PV de la NC) y la NC queda sellada `nc_cae_ambiente = 'homologacion'`.
 *  C · El CAE ya no se puede tocar desde el navegador (PATCH de cae / numero / ambiente → rechazado).
 *
 * Corre con el tenant multi-CUIT (proyecto `ri`): el PV 2 se crea para el test y se desactiva al final. La devolución
 * se inserta por REST solo para tener qué acreditar en la NC (no mueve stock: `devolucion_items` no tiene triggers).
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, irAlPOS, SUPABASE_URL } from './helpers/fixtures'

const EMISOR_RI = process.env.E2E_MULTICUIT_EMISOR_RI ?? ''

async function venderYAbrirModal(page: Page) {
  await irAlPOS(page)
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await buscador.fill('SKU TEST')
  const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /SKU TEST/i }).first()
  await expect(prod, '[173] "SKU TEST" no disponible en el POS').toBeVisible({ timeout: 15000 })
  await prod.click()
  await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })
  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  await page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first().selectOption('Efectivo')
  const monto = page.getByPlaceholder(/^Monto$/i).first()
  await monto.fill('100000')
  await monto.blur()
  const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
  await expect(finalizar).toBeEnabled({ timeout: 5000 })
  await finalizar.click()
  await expect(page.getByRole('heading', { name: /¿Emitir comprobante\?/ }), '[173] no apareció el modal de facturar').toBeVisible({ timeout: 20000 })
  const emisorSel = page.locator('label:has-text("Emisor (CUIT)") + div select')
  if (EMISOR_RI && await emisorSel.isVisible().catch(() => false)) {
    await emisorSel.selectOption(EMISOR_RI)
    const override = page.getByText(/Voy a emitir con un CUIT/)
    if (await override.isVisible().catch(() => false)) await override.click()
  }
}

test.describe('Fase 0 — la factura guarda su PV y el ambiente del CAE (mig 453, homologación)', () => {
  test('PV 2: sellado, PDF 0002, NC desde PV 1 referencia el PV 2, CAE intocable', async ({ page, request }) => {
    test.setTimeout(300_000)
    expect(EMISOR_RI, 'falta E2E_MULTICUIT_EMISOR_RI').toBeTruthy()
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const h = { ...headers, Prefer: 'return=representation' }
    const [s] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
    const tid = s.tenant_id as string

    // PV 2 del emisor RI (se reactiva si quedó de una corrida anterior).
    const existentes = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/puntos_venta_afip?select=id&emisor_id=eq.${EMISOR_RI}&numero=eq.2`, { headers })).json()) as any[]
    let pv2Id: string
    if (existentes.length) {
      pv2Id = existentes[0].id
      await request.patch(`${SUPABASE_URL}/rest/v1/puntos_venta_afip?id=eq.${pv2Id}`, { headers, data: { activo: true } })
    } else {
      const r = await request.post(`${SUPABASE_URL}/rest/v1/puntos_venta_afip`, {
        headers: h, data: { tenant_id: tid, emisor_id: EMISOR_RI, numero: 2, nombre: 'E2E 173', activo: true },
      })
      expect(r.ok(), `[173] no se pudo crear el PV 2: ${await r.text()}`).toBe(true)
      pv2Id = ((await r.json()) as any[])[0].id
    }

    try {
      // ── A · Factura B en el PV 2 desde el POS ─────────────────────────────────────────────────────────
      await venderYAbrirModal(page)
      await page.getByRole('button', { name: /^Factura B$/ }).click()
      const pvSel = page.locator('label:has-text("Punto de venta") + div select').first()
      await expect(pvSel, '[173A] el modal no ofrece elegir el punto de venta').toBeVisible({ timeout: 10000 })
      await pvSel.selectOption('2')
      await page.getByRole('button', { name: /Emitir Factura B/ }).click()
      await expect(page.getByText(/Factura B emitida/).first(), '[173A] la Factura B no se emitió en el PV 2').toBeVisible({ timeout: 60000 })

      const [venta] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/ventas?select=id,cae,numero_comprobante,punto_venta,cae_ambiente&tenant_id=eq.${tid}&cae=not.is.null&order=created_at.desc&limit=1`,
        { headers })).json()) as any[]
      expect(venta, '[173A] no encontré la venta facturada').toBeTruthy()
      expect(venta.punto_venta, '[173A] la factura no guardó su punto de venta').toBe(2)
      expect(venta.cae_ambiente, '[173A] la factura no guardó el ambiente del CAE').toBe('homologacion')

      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar PDF/ }).click()])
      expect(dl.suggestedFilename(), '[173A] el PDF no imprime el PV en que se emitió (0002)').toMatch(/^Factura_B_0002-\d{8}/)

      // ── C · el CAE no se toca desde el navegador ──────────────────────────────────────────────────────
      for (const data of [{ cae: null }, { numero_comprobante: '99999999' }, { cae_ambiente: 'produccion' }, { punto_venta: 1 }]) {
        const r = await request.patch(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${venta.id}`, { headers, data })
        expect(r.ok(), `[173C] se pudo modificar ${Object.keys(data)[0]} de una factura emitida`).toBe(false)
        expect(await r.text()).toContain('solo lo escribe la emisión del comprobante')
      }
      const [intacta] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?select=cae,punto_venta&id=eq.${venta.id}`, { headers })).json()) as any[]
      expect(intacta).toEqual({ cae: venta.cae, punto_venta: 2 })

      // ── B · NC desde el PV 1 sobre la factura del PV 2 ────────────────────────────────────────────────
      const [item] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/venta_items?select=producto_id,cantidad,precio_unitario&venta_id=eq.${venta.id}&limit=1`, { headers })).json()) as any[]
      const rd = await request.post(`${SUPABASE_URL}/rest/v1/devoluciones`, {
        headers: h, data: { tenant_id: tid, venta_id: venta.id, origen: 'facturada', motivo: 'E2E 173', monto_total: Number(item.precio_unitario) },
      })
      expect(rd.ok(), `[173B] no se pudo crear la devolución: ${await rd.text()}`).toBe(true)
      const devId = ((await rd.json()) as any[])[0].id
      const ri = await request.post(`${SUPABASE_URL}/rest/v1/devolucion_items`, {
        headers, data: { devolucion_id: devId, producto_id: item.producto_id, cantidad: 1, precio_unitario: Number(item.precio_unitario) },
      })
      expect(ri.ok(), `[173B] no se pudo crear el ítem de la devolución: ${await ri.text()}`).toBe(true)

      const ef = await request.post(`${SUPABASE_URL}/functions/v1/emitir-factura`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: { venta_id: venta.id, tenant_id: tid, tipo_comprobante: 'NC-B', punto_venta: 1, devolucion_id: devId, emisor_id: EMISOR_RI },
      })
      const efBody = await ef.text()
      expect(ef.ok(), `[173B] ARCA rechazó la NC (¿CbtesAsoc con el PV equivocado?): ${efBody}`).toBe(true)
      const [dev] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/devoluciones?select=nc_cae,nc_punto_venta,nc_cae_ambiente&id=eq.${devId}`, { headers })).json()) as any[]
      expect(dev.nc_cae, '[173B] la NC no quedó con CAE').toBeTruthy()
      expect(dev.nc_punto_venta).toBe(1)
      expect(dev.nc_cae_ambiente, '[173B] la NC no guardó el ambiente del CAE').toBe('homologacion')
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/puntos_venta_afip?id=eq.${pv2Id}`, { headers, data: { activo: false } })
    }
  })
})
