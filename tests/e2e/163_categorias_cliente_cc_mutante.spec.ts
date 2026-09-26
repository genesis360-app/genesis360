/**
 * 163_categorias_cliente_cc_mutante.spec.ts
 * E2E MUTANTE — Categorías de clientes, etapa 1 (mig 442): la categoría con cuenta corriente.
 *
 * Reglas (relevamiento de Fede + B-6 de GO + decisiones de GO del 2026-09-26):
 *  · D1: Cliente > Categoría > Negocio. Un cliente SIN valores propios hereda la CC de su categoría.
 *  · B-6: asignación masiva desde la pantalla, con resumen previo, en una sola operación.
 *  · Plazo: UNA regla, calculada por el servidor → la venta CC vence a hoy + plazo de la categoría.
 *  · CC habilitada: sin CC efectiva, el POS no ofrece "Cuenta Corriente".
 *
 * A · Clientes → Categorías → "Asignar a clientes" (paso 1 elegir, paso 2 resumen, Guardar) → queda asignada; la ficha
 *     del cliente muestra lo que rige y de dónde sale ("de la categoría").
 * B · POS: ese cliente (sin CC propia) tiene "Cuenta Corriente" POR SU CATEGORÍA; la venta CC queda con
 *     vencimiento = hoy + 12 (plazo de la categoría), no los días del negocio. Anti-vacío: un cliente sin categoría ni
 *     CC propia NO tiene la opción.
 *
 * Es el primer e2e que ejerce una venta a CC en el POS de punta a punta (los 46/72 dependen de fixtures sin sembrar).
 * Crea categoría y 2 clientes propios (los deja inactivos) y una venta real de 1 Coca Cola 1.5L (−1 u de stock, como
 * los specs 55/72).
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, irAlPOS, SUPABASE_URL } from './helpers/fixtures'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

async function elegirClientePOS(page: Page, nombre: string) {
  await page.getByRole('button', { name: /Cliente registrado/i }).click()
  const search = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
  await expect(search).toBeVisible({ timeout: 5000 })
  await search.fill(nombre)
  const btn = page.getByRole('button', { name: new RegExp(nombre, 'i') }).first()
  await expect(btn).toBeVisible({ timeout: 8000 })
  await btn.click()
}

test.describe('Categorías de clientes — la categoría con cuenta corriente (mutante)', () => {
  test('asignar desde la pantalla → la CC se hereda en la ficha y en el POS, con el vencimiento del servidor', async ({ page, request }) => {
    test.setTimeout(240_000)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const headers = restHeaders(await tokenDesdeBrowser(page))
    const h = { ...headers, Prefer: 'return=representation' }
    const [s] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
    const tid = s.tenant_id
    const ts = Date.now()
    const nombreCat = `E2E Cat163 ${ts}`
    const cliCon = `E2E Cli163 Con ${ts}`
    const cliSin = `E2E Cli163 Sin ${ts}`

    const cat = await request.post(`${SUPABASE_URL}/rest/v1/categorias_cliente`, {
      headers: h, data: { tenant_id: tid, nombre: nombreCat, cc_habilitada: true, cc_limite: 10_000_000, cc_plazo_dias: 12, cc_enforcement_politica: 'avisar' },
    })
    expect(cat.ok(), `[163] no se pudo crear la categoría: ${await cat.text()}`).toBe(true)
    const catId = ((await cat.json()) as any[])[0].id
    const mk = async (nombre: string, n: number) => {
      const r = await request.post(`${SUPABASE_URL}/rest/v1/clientes`, {
        headers: h, data: { tenant_id: tid, nombre, dni: String(ts).slice(-8) + n, telefono: '11' + String(ts).slice(-8), condicion_iva_receptor: 'CF' },
      })
      expect(r.ok(), `[163] no se pudo crear el cliente: ${await r.text()}`).toBe(true)
      return ((await r.json()) as any[])[0].id as string
    }
    const idCon = await mk(cliCon, 1)
    const idSin = await mk(cliSin, 2)
    let ventaId: string | null = null

    try {
      // ── A · asignación masiva desde la pantalla ─────────────────────────────────────────────────────────
      await goto(page, '/clientes?tab=categorias')
      await waitForApp(page)
      const fila = page.locator(`[data-categoria="${nombreCat}"]`)
      await expect(fila, '[163] la categoría no aparece en el panel').toBeVisible({ timeout: 15000 })
      await fila.getByTitle('Asignar a clientes').click()
      await page.getByPlaceholder('Buscar cliente por nombre o DNI').fill(cliCon)
      await page.locator(`[data-asignar-cliente="${cliCon}"] input[type=checkbox]`).check()
      await page.getByRole('button', { name: /^Continuar$/ }).click()
      await expect(page.locator('[data-resumen-asignacion]')).toContainText('1 cliente')
      await page.getByRole('button', { name: /^Guardar$/ }).click()
      await expect(page.getByText(new RegExp(`asignada a 1 cliente`)).first()).toBeVisible({ timeout: 10000 })
      const [asig] = (await (await request.get(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${idCon}&select=categoria_cliente_id,cuenta_corriente_habilitada`, { headers })).json()) as any[]
      expect(asig.categoria_cliente_id, '[163] la asignación no quedó guardada').toBe(catId)
      expect(asig.cuenta_corriente_habilitada, '[163] el cliente no tenía que tener CC propia').toBeNull()

      // La ficha muestra lo que rige y de dónde sale.
      await goto(page, '/clientes')
      await waitForApp(page)
      await page.getByPlaceholder(/Buscar/i).first().fill(cliCon)
      const filaCli = page.locator('div', { hasText: cliCon }).filter({ has: page.getByTitle('Editar cliente') }).last()
      await filaCli.getByTitle('Editar cliente').click()
      const efectivo = page.locator('[data-cc-efectivo]')
      await expect(efectivo).toContainText('habilitada (de la categoría)', { timeout: 10000 })
      await expect(efectivo).toContainText('12 días')
      await page.keyboard.press('Escape')

      // ── B · POS ─────────────────────────────────────────────────────────────────────────────────────────
      await page.evaluate(id => localStorage.setItem('sucursal-id', id), NORTE)
      await irAlPOS(page)
      const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
      await buscador.fill('Coca Cola 1.5L')
      const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /Coca Cola 1\.5L/i }).first()
      await expect(prod, '[163] Coca Cola 1.5L no disponible en el POS').toBeVisible({ timeout: 15000 })
      await prod.click()
      await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })

      // Anti-vacío: sin categoría ni CC propia → sin "Cuenta Corriente".
      await elegirClientePOS(page, cliSin)
      await page.waitForTimeout(1500)
      expect(await page.locator('option[value="Cuenta Corriente"]').count(), '[163] a un cliente sin CC se le ofreció Cuenta Corriente').toBe(0)
      await page.getByTitle('Quitar cliente').click()

      // Con CC por su categoría → la opción aparece y la venta pasa.
      await elegirClientePOS(page, cliCon)
      const medio = page.locator('select').filter({ has: page.locator('option[value="Cuenta Corriente"]') }).first()
      await expect(medio, '[163] el cliente con CC por su categoría no tiene la opción').toBeVisible({ timeout: 8000 })
      await medio.selectOption('Cuenta Corriente')
      const monto = page.getByPlaceholder(/^Monto$/i).first()
      // El total del carrito = precio vigente del producto (1 unidad), leído de la base.
      const [pv] = (await (await request.get(`${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent('Coca Cola 1.5L Original')}&select=precio_venta&limit=1`, { headers })).json()) as any[]
      await monto.fill(String(Number(pv.precio_venta)))
      await monto.blur()
      // Con varias cajas abiertas el POS pide elegir en cuál registrar (aunque la venta sea 100% CC).
      const selCaja = page.locator('select').filter({ has: page.locator('option', { hasText: 'Seleccioná una caja' }) }).first()
      if (await selCaja.isVisible().catch(() => false)) await selCaja.selectOption({ label: 'Caja1' })
      const despachar = page.getByRole('button', { name: /Despachar \(cuenta corriente\)/i })
      await expect(despachar).toBeEnabled({ timeout: 5000 })
      await despachar.click()

      await expect.poll(async () => {
        const vs = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?cliente_id=eq.${idCon}&select=id,es_cuenta_corriente,fecha_vencimiento_cc&order=created_at.desc&limit=1`, { headers })).json()) as any[]
        ventaId = vs[0]?.id ?? null
        return vs[0] ?? null
      }, { timeout: 20000, message: '[163] la venta a CC no se registró' }).not.toBeNull()
      const [v] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?id=eq.${ventaId}&select=es_cuenta_corriente,fecha_vencimiento_cc`, { headers })).json()) as any[]
      expect(v.es_cuenta_corriente).toBe(true)
      const hoyAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
      const dias = Math.round((Date.parse(`${v.fecha_vencimiento_cc}T12:00:00Z`) - Date.parse(`${hoyAR}T12:00:00Z`)) / 86_400_000)
      expect(dias, '[163] el vencimiento tenía que ser hoy + 12 (plazo de la categoría), puesto por el servidor').toBe(12)
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/clientes?id=in.(${idCon},${idSin})`, { headers, data: { activo: false } })
      await request.patch(`${SUPABASE_URL}/rest/v1/categorias_cliente?id=eq.${catId}`, { headers, data: { activo: false } })
    }
  })
})
