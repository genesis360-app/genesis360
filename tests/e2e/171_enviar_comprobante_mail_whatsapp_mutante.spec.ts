/**
 * 171_enviar_comprobante_mail_whatsapp_mutante.spec.ts
 * Enviar el ticket / la factura por Mail o WhatsApp (pedido de GO 2026-10-01, mig 451).
 *
 *  A · BUG de PROD: el cliente tiene email en su ficha → al finalizar la venta, Enviar → Mail lo trae PRECARGADO
 *      (antes aparecía vacío y había que tipearlo de nuevo).
 *  B · Enviar → WhatsApp abre el chat del cliente (su teléfono) con el mensaje y un link /c/<código>; el link abre SIN
 *      sesión, muestra el comprobante y baja el PDF.
 *  C · 🛑 REGLA #0: aunque la foto guardada traiga un CAE inventado, la página pública muestra el CAE REAL de la venta.
 *  D · link inexistente → "no está disponible"; la tabla no se puede leer ni con sesión ni sin sesión.
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { agregarPrimerProductoAlCarrito, garantizarCajaAbierta, restHeaders, tokenDesdeBrowser, SUPABASE_URL, ANON } from './helpers/fixtures'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

async function venderConClienteNuevo(page: Page, email: string, telefono: string) {
  await garantizarCajaAbierta(page)
  await goto(page, '/ventas')
  await waitForApp(page)
  await agregarPrimerProductoAlCarrito(page)
  await page.getByRole('button', { name: /cliente registrado/i }).first().click().catch(() => {})
  await page.getByRole('button', { name: /registrar cliente nuevo/i }).first().click()
  await page.getByPlaceholder(/nombre completo/i).fill(`E2E 171 ${Date.now()}`)
  const dni = page.getByPlaceholder(/^DNI/)
  await dni.fill(String(Date.now()).slice(-8))
  await page.getByPlaceholder(/^Teléfono/).fill(telefono)
  await page.getByPlaceholder(/^Email/).fill(email)
  await page.getByRole('button', { name: /^Guardar$/ }).click()
  await expect(page.getByText('Cliente registrado').first()).toBeVisible({ timeout: 8000 })

  const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent()
  const totalNum = parseFloat((totalTxt ?? '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
  const medio = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
  await medio.selectOption('Efectivo')
  const monto = page.getByPlaceholder(/^Monto$/i).first()
  if (await monto.isVisible().catch(() => false)) { await monto.fill(String(totalNum)); await monto.blur() }
  const caja = page.locator('label:has-text("Registrar en caja") + select')
  if (await caja.isVisible().catch(() => false)) {
    const vals = await caja.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (vals.length) await caja.selectOption(vals[0])
  }
  await page.getByRole('button', { name: /^Venta directa$/ }).last().click()
  await expect(page.getByText(/Venta finalizada/i).first()).toBeVisible({ timeout: 10000 })
  // Si el negocio factura, el POS ofrece emitir comprobante encima del ticket.
  const saltar = page.getByRole('button', { name: /^Saltar$/ })
  if (await saltar.isVisible({ timeout: 4000 }).catch(() => false)) await saltar.click()
}

test.describe('Enviar comprobante por Mail o WhatsApp', () => {
  test('A + B · ticket: Mail precarga el email del cliente; WhatsApp abre su chat con el link al comprobante', async ({ page, context, browser }) => {
    test.setTimeout(120_000)
    const email = `e2e171_${Date.now()}@ejemplo.com`
    await venderConClienteNuevo(page, email, '011 15-4444-5555')

    // A — Mail
    await page.locator('button[aria-haspopup="menu"]', { hasText: 'Enviar' }).click()
    await page.getByRole('menuitem', { name: 'Mail' }).click()
    await expect(page.getByPlaceholder('email@cliente.com'), '[171A] el email del cliente no vino precargado').toHaveValue(email)

    // B — WhatsApp
    await page.locator('button[aria-haspopup="menu"]', { hasText: 'Enviar' }).click()
    const [wa] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'WhatsApp' }).click(),
    ])
    await expect.poll(() => wa.url(), { timeout: 15000 }).toContain('api.whatsapp.com/send')
    const url = new URL(wa.url())
    expect(url.searchParams.get('phone')).toBe('5491144445555')
    const texto = url.searchParams.get('text') ?? ''
    expect(texto).toMatch(/Te enviamos el comprobante de tu compra de .+ \(Venta /)
    const link = texto.match(/https?:\/\/\S+\/c\/[0-9a-f]{32}/)?.[0]
    expect(link, '[171B] el mensaje no trae el link').toBeTruthy()
    await wa.close()

    // El link abre SIN sesión (contexto nuevo, sin storageState) y baja el PDF.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const p = await anon.newPage()
      await p.goto(`${BASE}/c/${link!.split('/c/')[1]}`)
      await expect(p.getByText('Comprobante de compra')).toBeVisible({ timeout: 15000 })
      await expect(p.getByText('Total')).toBeVisible()
      const [pdf] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Descargar PDF/ }).click()])
      expect(pdf.suggestedFilename()).toMatch(/^Ticket_.*\.pdf$/)
    } finally {
      await anon.close()
    }
  })

  test('C · REGLA #0: la página pública muestra el CAE real aunque la foto traiga uno inventado', async ({ page, browser }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const [venta] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/ventas?cae=not.is.null&select=id,tenant_id,cae&order=created_at.desc&limit=1`, { headers })).json()) as any[]
    test.skip(!venta, 'No hay ventas con CAE en el negocio de prueba')
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
    // Como la app (supabase-js .insert sin .select): sin pedir la fila de vuelta — no hay permiso de lectura, a propósito.
    const ins = await page.request.post(`${SUPABASE_URL}/rest/v1/comprobantes_compartidos`, {
      headers: { ...headers, Prefer: 'return=minimal' }, data: { token, tenant_id: venta.tenant_id, tipo: 'factura', venta_id: venta.id,
        datos: { tipo_comprobante: 'A', punto_venta: 1, numero_comprobante: 99999, cae: '11111111111111', total: 1, items: [] } },
    })
    expect(ins.ok(), await ins.text()).toBe(true)
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const p = await anon.newPage()
      await p.goto(`${BASE}/c/${token}`)
      await expect(p.getByText(`CAE ${venta.cae}`)).toBeVisible({ timeout: 15000 })
      await expect(p.getByText('CAE 11111111111111')).toHaveCount(0)
    } finally {
      await anon.close()
    }
  })

  test('D · link inexistente y tabla inaccesible', async ({ page, browser, request }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const p = await anon.newPage()
      await p.goto(`${BASE}/c/${'0'.repeat(32)}`)
      await expect(p.getByText('Este link no está disponible')).toBeVisible({ timeout: 15000 })
    } finally {
      await anon.close()
    }
    // Sin sesión: no se puede leer la tabla.
    const sinSesion = await request.get(`${SUPABASE_URL}/rest/v1/comprobantes_compartidos?select=token&limit=1`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
    })
    expect(sinSesion.ok() ? ((await sinSesion.json()) as unknown[]).length : 0).toBe(0)
    // Con sesión tampoco (no hay policy de SELECT).
    await goto(page, '/ventas')
    await waitForApp(page)
    const conSesion = await request.get(`${SUPABASE_URL}/rest/v1/comprobantes_compartidos?select=token&limit=1`, {
      headers: restHeaders(await tokenDesdeBrowser(page)),
    })
    expect(conSesion.ok() ? ((await conSesion.json()) as unknown[]).length : 0).toBe(0)
  })
})
