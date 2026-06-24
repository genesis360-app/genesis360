/**
 * 83_todos_medios_pago_mutante.spec.ts
 * E2E MUTANTE — vender con CADA medio de pago directo sin errores (REGLA #0, plata/caja).
 *
 * Regresión tras el fix G0.6 (v1.88.0/1.89.0): confirma que registrar una venta directa funciona con
 * todos los medios de pago directos (Efectivo, Tarjeta débito/crédito, Transferencia, Mercado Pago, …)
 * y que el efecto en caja es el correcto (Efectivo → `ingreso`; no-efectivo → `ingreso_informativo`).
 * Lee dinámicamente las opciones del selector de medio del POS y crea una venta por cada una (salta
 * Cuenta Corriente / Crédito a favor, que requieren cliente — cubiertos por specs 28/73).
 *
 * Aserción POSITIVA por medio (carrito se limpia = venta creada). MUTANTE (crea ventas + rebaja stock;
 * quedan como evidencia UAT). GATE: E2E_MEDIOS_PAGO=1. OWNER (chromium) contra DEV (Almacén Jorgito).
 * El desglose de caja (ingreso vs ingreso_informativo por medio) se verifica aparte con supabase db query.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const EXCLUIR = /cuenta corriente|crédito a favor|credito a favor/i

test.describe('Todos los medios de pago directos (mutante)', () => {
  test.skip(process.env.E2E_MEDIOS_PAGO !== '1', 'Mutante de ventas (E2E_MEDIOS_PAGO!=1).')

  test('vender una vez por cada medio de pago directo → todas se registran sin error', async ({ page }) => {
    test.setTimeout(180000)
    await goto(page, '/ventas')
    await waitForApp(page)

    // Descubrir las opciones del selector de medio (agregando un producto para que aparezca el selector)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a'); await page.waitForTimeout(900)
    const primer = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primer.isVisible().catch(() => false)), 'No hay productos vendibles')
    await primer.click(); await page.waitForTimeout(500)

    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await expect(tipoSelect).toBeVisible({ timeout: 6000 })
    const medios = (await tipoSelect.locator('option').allTextContents())
      .map(s => s.trim()).filter(Boolean).filter(m => !EXCLUIR.test(m) && !/seleccion|elegí|medio/i.test(m))

    expect(medios.length).toBeGreaterThan(0)
    const fallidos: string[] = []

    for (const medio of medios) {
      // (re)cargar POS limpio para cada medio
      await goto(page, '/ventas'); await waitForApp(page)
      const b = page.getByPlaceholder(/buscar por nombre/i).first()
      await b.fill('a'); await page.waitForTimeout(900)
      const p = page.locator('div.absolute.top-full button, div.grid > button').first()
      if (!(await p.isVisible().catch(() => false))) { fallidos.push(`${medio} (sin producto)`); continue }
      await p.click(); await page.waitForTimeout(500)

      // caja (si hay más de una abierta)
      const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
      if (await cajaSelect.isVisible().catch(() => false)) {
        const vals = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
        if (vals.length) await cajaSelect.selectOption(vals[0])
      }

      // Leer el Total exacto del POS (los no-efectivo deben cubrirlo EXACTO; no admiten vuelto).
      const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent().catch(() => null)
      const totalNum = totalTxt ? totalTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.') : '0'

      const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
      await sel.selectOption({ label: medio })
      await page.waitForTimeout(300)
      const monto = page.getByPlaceholder(/^Monto$/i).first()
      if (await monto.isVisible().catch(() => false)) { await monto.fill(totalNum); await monto.blur(); await page.waitForTimeout(300) }

      // finalizar
      const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
      if (!(await finalizar.isEnabled().catch(() => false))) { fallidos.push(`${medio} (CTA disabled)`); continue }
      await finalizar.click()

      let ok = true
      try { await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 12000 }) } catch { ok = false }
      const err = await page.getByText(/no se pudo registrar|stock insuficiente|error al/i).first().isVisible().catch(() => false)
      if (!ok || err) fallidos.push(medio)
    }

    expect(fallidos, `Medios con error: ${fallidos.join(', ')}`).toEqual([])
  })
})
