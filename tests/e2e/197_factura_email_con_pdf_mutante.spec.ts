/**
 * 197_factura_email_con_pdf_mutante.spec.ts
 * Al emitir una factura, el mail al cliente sale CON el PDF adjunto (reporte de GO 2026-10-09: el mail automático lo
 * mandaba la EF `emitir-factura` sin adjunto). Ahora lo manda el navegador (mismo envío que "Enviar por email") y la EF
 * no manda el suyo (`cliente_envia_email: true`).
 *
 * Mismo recorrido que el 21 (venta directa → modal "¿Emitir comprobante?" → CAE de homologación). Como la venta es a
 * consumidor final, se simula que el cliente tiene email interceptando la consulta `ventas?select=clientes(email)`, y se
 * intercepta `send-email` (no se manda nada a Resend): se verifica que llegue tipo `factura_emitida` con un PDF adjunto,
 * y que a la EF se le pidió no mandar el suyo.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { visible } from './helpers/fixtures'

test.describe('Factura por email con PDF (mutante)', () => {
  test('al emitir, el mail al cliente lleva la factura en PDF', async ({ page }) => {
    test.setTimeout(120000)
    let pidioSinMailEF = false
    await page.route('**/functions/v1/emitir-factura', async route => {
      try { pidioSinMailEF = JSON.parse(route.request().postData() ?? '{}').cliente_envia_email === true } catch { /* */ }
      await route.continue()
    })
    await page.route(/\/rest\/v1\/ventas\?select=clientes%28email%29/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientes: { email: 'cliente.e2e@example.com' } }) }))
    let mail: any = null
    await page.route('**/functions/v1/send-email', async route => {
      const b = JSON.parse(route.request().postData() ?? '{}')
      if (b.type === 'factura_emitida') mail = b
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')

    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    const hayProducto = await visible(primerProducto, 5000)
    test.skip(!hayProducto, 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()

    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Elegir caja si hay selector
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // 3) Pago en efectivo cubriendo de sobra
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('100000')
    await montoInput.blur()

    // 4) Finalizar venta directa (despachada)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // El carrito se limpia (venta creada)
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // 5) Modal post-despacho "¿Emitir comprobante?" (solo si facturación está configurada)
    const modal = page.getByRole('heading', { name: /¿Emitir comprobante\?/ })
    const apareceModal = await modal.isVisible({ timeout: 6000 }).catch(() => false)
    test.skip(!apareceModal, 'Facturación no configurada en el tenant de prueba (no aparece el modal)')

    // 6) Elegir un tipo de comprobante disponible y emitir. El set ofrecido depende de
    //    condicion_iva_emisor del tenant (Monotributista→C, RI→A/B) y "Factura A" se
    //    deshabilita sin CUIT, así que tomamos el primer botón de tipo habilitado en vez de
    //    asumir Factura C (evita romper si el tenant de DEV cambia de condición fiscal).
    const tipoBtn = page.locator('button:not([disabled])', { hasText: /^Factura [ABC]$/ }).first()
    await expect(tipoBtn).toBeVisible({ timeout: 6000 })
    const letra = ((await tipoBtn.textContent()) ?? '').match(/Factura ([ABC])/)?.[1] ?? 'C'
    await tipoBtn.click()
    await page.getByRole('button', { name: new RegExp(`Emitir Factura ${letra}`) }).click()

    // 7) Verificar el CAE real de AFIP en el toast de éxito (la llamada a AFIP tarda)
    await expect(page.getByText(new RegExp(`Factura ${letra} emitida — CAE:`))).toBeVisible({ timeout: 30000 })

    // 8) El mail sale desde el navegador, con el PDF adjunto
    await expect.poll(() => mail, { timeout: 30000, message: '[197] no se mandó el mail de la factura' }).not.toBeNull()
    expect(mail.to, '[197] al email del cliente').toBe('cliente.e2e@example.com')
    expect(Array.isArray(mail.attachments) && mail.attachments.length, '[197] el mail tiene que llevar la factura adjunta').toBe(1)
    expect(mail.attachments[0].filename, '[197] el adjunto es un PDF').toMatch(/\.pdf$/i)
    expect(String(mail.attachments[0].content).length, '[197] el PDF no está vacío').toBeGreaterThan(1000)
    expect(pidioSinMailEF, '[197] a la EF se le pide que no mande el mail sin adjunto').toBe(true)
  })
})
