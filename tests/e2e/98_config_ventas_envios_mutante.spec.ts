/**
 * 98_config_ventas_envios_mutante.spec.ts
 * E2E MUTANTE del backlog Config Ventas/Envíos (Fede/GO 2026-07-19, migs 279-281).
 *
 * Cubre los dos puntos que tocan PLATA (REGLA #0):
 *  1. Descuento por método de pago (metodos_pago.config.descuento): se siembra una promo
 *     del 10% en Efectivo por API, se completa una venta REAL en el POS y se verifica en DB
 *     que (a) ventas.promo_pago quedó registrado y (b) la suma de venta_items.subtotal es
 *     EXACTAMENTE el total cobrado (el prorrateo fiscal G0.6 plegó el descuento en las líneas
 *     → factura/NC/Libro IVA consistentes).
 *  2. Envío gratis condicional (tenants.envio_gratis_reglas v2): se siembra una regla de
 *     monto mínimo $1, se activa "Incluir envío" en el POS y se verifica el banner + costo $0.
 *  3. Campos requeridos del cliente (mig 280): email obligatorio → el alta rápida sin email
 *     se rechaza con el mensaje correcto.
 *
 * Siembra y restaura su PROPIA precondición vía PostgREST con el token del browser
 * (metodología fixtures.ts — nunca test.skip por estado de DEV).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

async function tenantId(request: any, token: string): Promise<string> {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/users?select=tenant_id&id=eq.${JSON.parse(atob(token.split('.')[1])).sub}`, {
    headers: restHeaders(token),
  })
  const rows = await res.json()
  expect(rows.length, 'No se pudo resolver el tenant del usuario e2e').toBeGreaterThan(0)
  return rows[0].tenant_id
}

test.describe('Backlog Config Ventas/Envíos (mutante)', () => {

  test('promo por método de pago: venta real con 10% off en Efectivo, prorrateo fiscal verificado en DB', async ({ page, request }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const tid = await tenantId(request, token)

    // ── Siembra: promo 10% sin restricciones en Efectivo (guardando el config previo) ──
    const metodoRes = await request.get(
      `${SUPABASE_URL}/rest/v1/metodos_pago?select=id,config&tenant_id=eq.${tid}&nombre=eq.Efectivo&limit=1`,
      { headers: restHeaders(token) },
    )
    const metodos = await metodoRes.json()
    expect(metodos.length, 'El tenant e2e no tiene método "Efectivo" — precondición de infraestructura').toBeGreaterThan(0)
    const configPrevio = metodos[0].config
    const patch = async (config: any) => {
      const r = await request.patch(`${SUPABASE_URL}/rest/v1/metodos_pago?id=eq.${metodos[0].id}`, {
        headers: restHeaders(token), data: { config },
      })
      expect(r.ok()).toBeTruthy()
    }
    await patch({ ...(configPrevio ?? {}), descuento: { pct: 10, tope: null, dias: null, desde: null, hasta: null } })

    try {
      // Recargar para que el POS lea la promo recién sembrada
      await goto(page, '/ventas')
      await waitForApp(page)

      // 1) Agregar un producto al carrito
      const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
      await expect(buscador).toBeVisible({ timeout: 8000 })
      await buscador.fill('a')
      await page.waitForTimeout(1000)
      const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
      await primerProducto.waitFor({ state: 'visible', timeout: 8000 })
      await primerProducto.click()
      await page.waitForTimeout(600)
      await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

      // 2) Elegir caja si corresponde
      const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
      if (await cajaSelect.isVisible().catch(() => false)) {
        const values = await cajaSelect.locator('option').evaluateAll(
          opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
        )
        if (values.length > 0) await cajaSelect.selectOption(values[0])
      }

      // 3) Efectivo — el selector ya muestra la promo y al elegirlo aparece la línea verde
      const tipoSelect = page.locator('select')
        .filter({ has: page.locator('option', { hasText: /Efectivo/ }) }).first()
      await tipoSelect.selectOption('Efectivo')
      await expect(page.getByText(/🏷 Promo Efectivo \(10%\)/).first()).toBeVisible({ timeout: 5000 })

      const montoInput = page.getByPlaceholder(/^Monto$/i).first()
      await montoInput.fill('1000000')
      await montoInput.blur()
      await page.waitForTimeout(300)

      // 4) Venta directa
      const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
      await expect(finalizar).toBeEnabled({ timeout: 5000 })
      await finalizar.click()
      await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

      // 5) REGLA #0 — verificar la venta en DB: promo registrada y prorrateo exacto
      const ventaRes = await request.get(
        `${SUPABASE_URL}/rest/v1/ventas?select=id,total,promo_pago,venta_items(subtotal)&tenant_id=eq.${tid}&order=created_at.desc&limit=1`,
        { headers: restHeaders(token) },
      )
      const [venta] = await ventaRes.json()
      expect(venta, 'No se encontró la venta recién creada').toBeTruthy()
      expect(venta.promo_pago, 'ventas.promo_pago debía registrar la promo aplicada (mig 281)').toBeTruthy()
      expect(venta.promo_pago[0]).toMatchObject({ metodo: 'Efectivo', pct: 10 })
      expect(venta.promo_pago[0].monto).toBeGreaterThan(0)
      const sumaItems = (venta.venta_items as any[]).reduce((s, i) => s + Number(i.subtotal), 0)
      expect(
        Math.abs(sumaItems - Number(venta.total)),
        `Σ venta_items.subtotal (${sumaItems}) ≠ ventas.total (${venta.total}) — el prorrateo fiscal no plegó la promo`,
      ).toBeLessThan(0.05)
    } finally {
      await patch(configPrevio ?? {})
    }
  })

  test('envío gratis condicional: regla por monto mínimo pone el costo en $0 con banner', async ({ page, request }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const tid = await tenantId(request, token)

    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=envio_gratis_reglas&id=eq.${tid}`, { headers: restHeaders(token) })
    const reglasPrevias = (await tRes.json())[0]?.envio_gratis_reglas ?? {}
    const patchTenant = async (envio_gratis_reglas: any) => {
      const r = await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, {
        headers: restHeaders(token), data: { envio_gratis_reglas },
      })
      expect(r.ok()).toBeTruthy()
    }
    await patchTenant({ reglas: [{ montoMinimo: 1 }] })

    try {
      await goto(page, '/ventas')
      await waitForApp(page)

      const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
      await buscador.fill('a')
      await page.waitForTimeout(1000)
      const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
      await primerProducto.waitFor({ state: 'visible', timeout: 8000 })
      await primerProducto.click()
      await page.waitForTimeout(600)

      // Activar "Incluir envío" → la regla aplica (total ≥ $1) → banner + costo $0
      await page.getByText(/^Incluir envío$/).click()
      await expect(page.getByText(/Envío gratis/).first()).toBeVisible({ timeout: 5000 })
      // Con costo $0 el resumen NO muestra la línea "Envío +$..." (costoEnvioNum > 0 la gatea).
      // (No se lee el input por placeholder: "$/km" comparte el placeholder "0.00" con "Costo".)
      await page.waitForTimeout(1500)  // dejar asentar geocoding/autocálculo — no deben pisar el $0
      await expect(page.getByText('Envío', { exact: true })).not.toBeVisible()
    } finally {
      await patchTenant(reglasPrevias)
      // limpiar el carrito recargando (no se registró venta)
    }
  })

  test('campos requeridos del cliente: email obligatorio bloquea el alta rápida sin email', async ({ page, request }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const tid = await tenantId(request, token)

    const tRes = await request.get(`${SUPABASE_URL}/rest/v1/tenants?select=cliente_campos_requeridos,cliente_creacion_inline&id=eq.${tid}`, { headers: restHeaders(token) })
    const prev = (await tRes.json())[0]
    const patchTenant = async (data: any) => {
      const r = await request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, { headers: restHeaders(token), data })
      expect(r.ok()).toBeTruthy()
    }
    await patchTenant({ cliente_campos_requeridos: { dni: false, telefono: false, email: true }, cliente_creacion_inline: true })

    try {
      await goto(page, '/ventas')
      await waitForApp(page)

      // Abrir el alta rápida: tab "Cliente registrado" → botón "+ Registrar cliente nuevo"
      await page.getByRole('button', { name: /cliente registrado/i }).first().click().catch(() => {})
      await page.getByRole('button', { name: /registrar cliente nuevo/i }).first().click()
      await page.getByPlaceholder(/nombre completo/i).fill('Cliente E2E Sin Email')
      // El placeholder de email debe marcar el asterisco de requerido
      await expect(page.getByPlaceholder('Email *')).toBeVisible({ timeout: 3000 })
      await page.getByRole('button', { name: /^Guardar$/ }).click()
      await expect(page.getByText(/email es obligatorio/i).first()).toBeVisible({ timeout: 5000 })
    } finally {
      await patchTenant({ cliente_campos_requeridos: prev?.cliente_campos_requeridos ?? null, cliente_creacion_inline: prev?.cliente_creacion_inline ?? true })
    }
  })
})
