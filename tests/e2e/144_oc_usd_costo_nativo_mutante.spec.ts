/**
 * 144_oc_usd_costo_nativo_mutante.spec.ts
 * E2E MUTANTE — 🛑 REGLA #0. Bug reportado por Fede (2026-09-11): "en la orden de compra tampoco
 * permite poner el valor por unidad en USD, lo convierte automáticamente a $".
 *
 * Lo que pasaba: al elegir un producto, el form precargaba `productos.precio_costo` a secas. Para un
 * producto priceado en dólares eso es el MIRROR EN ARS (el valor que la ficha calcula para
 * margen/reportes/POS), no el costo real. Y como la OC tiene su propia `moneda`, ese número se
 * guardaba tal cual y después se mostraba como dólares: un producto de US$99,99 quedaba como una
 * orden de compra de US$150.985 — y al recibirla, generaba el gasto por ese monto.
 *
 * El DECOY es justamente el mirror (150985): si el fix regresara, el campo se precargaría con ese
 * valor en vez de 99,99, y el test lo caza.
 *
 * Siembra su propio producto en USD por REST para no depender de los que dejaron otros specs.
 *
 *   npx dotenv -e tests/e2e/.env.test.local -- playwright test 144 --project=chromium
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, elegirProductoOC } from './helpers/fixtures'

const PROVEEDOR    = 'Mayorista MAX'
const COSTO_USD    = 99.99      // el valor NATIVO, lo que la OC en dólares tiene que precargar
const MIRROR_ARS   = 150985     // DECOY: el mirror en pesos. Con el bug, esto era lo que aparecía.

test.describe('OC en USD → precarga el costo NATIVO, no el mirror en pesos (mutante)', () => {
  test('un producto de US$99,99 no puede entrar a la OC como 150.985', async ({ page, request }) => {
    test.setTimeout(120_000)

    await goto(page, '/productos')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // ── Siembra: producto priceado en DÓLARES, con su mirror en pesos cargado ────────────────
    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`, { headers })
    expect(tRes.ok(), 'no pude leer el tenant').toBeTruthy()
    const tenantId = (await tRes.json())[0]?.id
    expect(tenantId, 'el usuario e2e no resolvió un tenant').toBeTruthy()

    const sufijo = Date.now()
    const nombreProd = `E2E OCUSD ${sufijo}`
    const insRes = await request.post(`${SUPABASE_URL}/rest/v1/productos`, {
      headers,
      data: {
        tenant_id: tenantId,
        nombre: nombreProd,
        sku: `E2EOCUSD-${sufijo}`,
        precio_costo: MIRROR_ARS,       // el mirror que el bug precargaba
        precio_costo_usd: COSTO_USD,    // el valor real
        moneda_costo: 'usd',
        precio_venta: 0,
        activo: true,
      },
    })
    expect(insRes.ok(), `no pude sembrar el producto en USD: ${await insRes.text()}`).toBeTruthy()
    const prodId = (await insRes.json())[0]?.id
    expect(prodId, 'la siembra no devolvió el id del producto').toBeTruthy()

    try {
      // ── Abrir el form de OC y ponerla en DÓLARES ──────────────────────────────────────────
      await goto(page, '/proveedores')
      await waitForApp(page)
      await page.getByRole('button', { name: /Órdenes de compra|Ordenes de compra/i }).first().click()
      await page.getByRole('button', { name: /Nueva orden|Nueva OC/i }).first().click()
      await expect(page.getByRole('heading', { name: /Nueva orden de compra/i })).toBeVisible({ timeout: 8000 })

      const provSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un proveedor/i }) }).first()
      await provSel.selectOption({ label: PROVEEDOR })

      const monedaSel = page.locator('select').filter({ has: page.locator('option', { hasText: /USD — Dólares/i }) }).first()
      await monedaSel.selectOption({ label: 'USD — Dólares' })

      // ── El acto bajo prueba: elegir el producto y ver qué costo precarga ──────────────────
      await elegirProductoOC(page, `${nombreProd} (E2EOCUSD-${sufijo})`)

      const campoPrecio = page.getByPlaceholder(/^Precio unit\./).first()
      await expect(campoPrecio).toBeVisible({ timeout: 8000 })
      // Esperar a que el autocompletado escriba algo antes de leerlo.
      await expect(campoPrecio).not.toHaveValue('', { timeout: 8000 })
      const valor = parseFloat((await campoPrecio.inputValue()).replace(',', '.'))

      expect(
        Math.abs(valor - COSTO_USD) < 0.01,
        `la OC en dólares tenía que precargar el costo NATIVO (US$${COSTO_USD}) y precargó ${valor}`,
      ).toBeTruthy()

      // Mutante explícito: el bug precargaba el mirror en pesos.
      expect(
        Math.abs(valor - MIRROR_ARS) > 1,
        `REGRESIÓN: precargó ${valor} — es el mirror en ARS metido en una OC en dólares. ` +
        `Una orden de US$${COSTO_USD} quedaría registrada por US$${MIRROR_ARS}.`,
      ).toBeTruthy()

      // ── Y el total tiene que estar rotulado en dólares, no en pesos ───────────────────────
      await page.getByPlaceholder(/^Cant\./).first().fill('1')
      const total = page.getByText(/Total estimado:/i).first()
      await expect(total).toBeVisible({ timeout: 8000 })
      const totalTxt = (await total.innerText()).trim()
      expect(
        /US\$|U\$D/i.test(totalTxt),
        `el total de una OC en dólares tiene que mostrarse en dólares, y decía: "${totalTxt}"`,
      ).toBeTruthy()
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, { headers })
    }
  })
})
