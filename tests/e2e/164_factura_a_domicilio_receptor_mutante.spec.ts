/**
 * 164_factura_a_domicilio_receptor_mutante.spec.ts
 * E2E MUTANTE — Factura A exige el domicilio del RECEPTOR (mig 443) + observaciones del contador de El Tilo.
 *
 * Contador de El Tilo (2026-09-30): (1) la Factura A debe llevar el domicilio comercial del RECEPTOR (el cliente, no
 * el emisor ni la sucursal); (2) "Condición de venta" obligatoria; (3) "Responsable Inscripto", no "RI".
 * Decisión de GO: campo "Domicilio fiscal / comercial" en la ficha del cliente y BLOQUEAR la Factura A sin él.
 *
 * Qué prueba, con AFIP homologación real (tenant RI "Kiosco Buildi", proyecto `chromium-ri`):
 *   A. Venta a un cliente RI SIN domicilio → el modal ofrece Factura A pero la BLOQUEA (aviso + botón deshabilitado)
 *      y el SERVIDOR también la rechaza (EF `emitir-factura` llamada directo, como lo haría un bundle viejo).
 *   B. Se carga el domicilio desde la ficha del cliente (UI) → se guarda en `clientes.domicilio_fiscal`.
 *   C. Otra venta al mismo cliente → Factura A con CAE real → se descarga el PDF (evidencia en test-results/).
 *
 * Deja: 1 cliente de prueba (inactivo al final), 2 ventas de 1 u. de "SKU TEST" (una sin facturar, evidencia del
 * bloqueo) y 1 Factura A de homologación (sin valor fiscal).
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, irAlPOS, SUPABASE_URL } from './helpers/fixtures'

const EMISOR_RI = process.env.E2E_MULTICUIT_EMISOR_RI ?? ''
// CUIT público de una empresa Responsable Inscripta (Mercado Libre SRL) — solo como receptor en homologación.
const CUIT_RECEPTOR = '30-70308853-4'
const DOMICILIO = 'Av. del Libertador 14.520 Piso 3 Of. B, Martínez, San Isidro, Provincia de Buenos Aires (B1640)'
const EVIDENCIA = path.join(process.cwd(), 'test-results', 'evidencia-164')

async function elegirClientePOS(page: Page, nombre: string) {
  await page.getByRole('button', { name: /Cliente registrado/i }).click()
  const search = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
  await expect(search).toBeVisible({ timeout: 5000 })
  await search.fill(nombre)
  const btn = page.getByRole('button', { name: new RegExp(nombre, 'i') }).first()
  await expect(btn).toBeVisible({ timeout: 8000 })
  await btn.click()
}

/** Carrito con 1 "SKU TEST" al cliente, efectivo, venta directa → queda abierto el modal "¿Emitir comprobante?". */
async function venderYAbrirModal(page: Page, cliente: string) {
  await irAlPOS(page)
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await buscador.fill('SKU TEST')
  const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: /SKU TEST/i }).first()
  await expect(prod, '[164] "SKU TEST" no disponible en el POS de Kiosco Buildi').toBeVisible({ timeout: 15000 })
  await prod.click()
  await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })
  await elegirClientePOS(page, cliente)

  const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
  if (await cajaSelect.isVisible().catch(() => false)) {
    const values = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (values.length > 0) await cajaSelect.selectOption(values[0])
  }
  const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
  await tipoSelect.selectOption('Efectivo')
  const monto = page.getByPlaceholder(/^Monto$/i).first()
  await monto.fill('100000')
  await monto.blur()
  const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
  await expect(finalizar).toBeEnabled({ timeout: 5000 })
  await finalizar.click()
  await expect(page.getByRole('heading', { name: /¿Emitir comprobante\?/ }), '[164] no apareció el modal de facturar').toBeVisible({ timeout: 20000 })

  // Emisor RI (el tenant tiene uno RI y uno Monotributista; la Factura A solo existe para el RI).
  const emisorSel = page.locator('label:has-text("Emisor (CUIT)") + div select')
  if (EMISOR_RI && await emisorSel.isVisible().catch(() => false)) {
    await emisorSel.selectOption(EMISOR_RI)
    const override = page.getByText(/Voy a emitir con un CUIT/)
    if (await override.isVisible().catch(() => false)) await override.click()
  }
  await page.getByRole('button', { name: /^Factura A$/ }).click()
}

test.describe('Factura A — domicilio del receptor obligatorio (mutante, AFIP homologación)', () => {
  test('sin domicilio se bloquea (UI + servidor); con domicilio emite y el PDF lo imprime', async ({ page, request }) => {
    test.setTimeout(300_000)
    fs.mkdirSync(EVIDENCIA, { recursive: true })
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const h = { ...headers, Prefer: 'return=representation' }
    const [s] = (await (await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
    const tid = s.tenant_id
    const cliente = `E2E Receptor164 ${Date.now()}`

    const r = await request.post(`${SUPABASE_URL}/rest/v1/clientes`, {
      headers: h, data: { tenant_id: tid, nombre: cliente, cuit_receptor: CUIT_RECEPTOR, condicion_iva_receptor: 'RI', telefono: '1100000164', dni: String(Date.now()).slice(-8) },
    })
    expect(r.ok(), `[164] no se pudo crear el cliente: ${await r.text()}`).toBe(true)
    const clienteId = ((await r.json()) as any[])[0].id

    try {
      // ── A · sin domicilio: bloqueado en la UI ─────────────────────────────────────────────────────────
      await venderYAbrirModal(page, cliente)
      await expect(page.getByText(/Factura A: falta el domicilio fiscal\/comercial del cliente/).first(),
        '[164A] no avisó que falta el domicilio del receptor').toBeVisible({ timeout: 10000 })
      await expect(page.getByRole('button', { name: /Emitir Factura A/ }), '[164A] dejó emitir la Factura A sin domicilio').toBeDisabled()
      await page.screenshot({ path: path.join(EVIDENCIA, '1-bloqueo-sin-domicilio.png') })

      // … y en el servidor (un bundle viejo o una llamada directa no pasan).
      const [venta1] = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/ventas?select=id,cae&cliente_id=eq.${clienteId}&order=created_at.desc&limit=1`, { headers })).json()) as any[]
      expect(venta1?.id, '[164A] no encontré la venta recién hecha').toBeTruthy()
      const pv = (await (await request.get(
        `${SUPABASE_URL}/rest/v1/puntos_venta_afip?select=numero&emisor_id=eq.${EMISOR_RI}&activo=eq.true&limit=1`, { headers })).json()) as any[]
      const ef = await request.post(`${SUPABASE_URL}/functions/v1/emitir-factura`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: { venta_id: venta1.id, tenant_id: tid, tipo_comprobante: 'A', punto_venta: Number(pv[0]?.numero ?? 1), emisor_id: EMISOR_RI },
      })
      const efBody = await ef.text()
      expect(ef.status(), `[164A] el servidor no rechazó la Factura A sin domicilio: ${efBody}`).toBe(400)
      expect(efBody).toContain('falta el domicilio fiscal/comercial del cliente')
      const [v1] = (await (await request.get(`${SUPABASE_URL}/rest/v1/ventas?select=cae&id=eq.${venta1.id}`, { headers })).json()) as any[]
      expect(v1.cae, '[164A] la venta quedó con CAE pese al bloqueo').toBeNull()
      await page.getByRole('button', { name: /^Saltar$/ }).click()

      // ── B · cargar el domicilio desde la ficha del cliente ────────────────────────────────────────────
      await goto(page, '/clientes')
      await waitForApp(page)
      await page.getByPlaceholder(/Buscar/i).first().fill(cliente)
      const fila = page.locator('div', { hasText: cliente }).filter({ has: page.getByTitle('Editar cliente') }).last()
      await fila.getByTitle('Editar cliente').click()
      const campo = page.getByPlaceholder('Calle y número, localidad, provincia')
      await expect(campo, '[164B] la ficha no tiene el campo de domicilio fiscal').toBeVisible({ timeout: 10000 })
      await expect(page.getByText(/Obligatorio para emitirle Factura A/).first(), '[164B] no avisó que es obligatorio para RI').toBeVisible()
      await campo.fill(DOMICILIO)
      await campo.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(EVIDENCIA, '2-ficha-cliente-domicilio.png') })
      await page.getByRole('button', { name: /^Guardar/ }).last().click()
      await expect.poll(async () => {
        const [c] = (await (await request.get(`${SUPABASE_URL}/rest/v1/clientes?select=domicilio_fiscal&id=eq.${clienteId}`, { headers })).json()) as any[]
        return c?.domicilio_fiscal
      }, { message: '[164B] el domicilio no se guardó', timeout: 10000 }).toBe(DOMICILIO)

      // ── C · con domicilio: emite con CAE real y el PDF lo imprime ─────────────────────────────────────
      await venderYAbrirModal(page, cliente)
      await expect(page.getByText(/Factura A: falta el domicilio/)).toHaveCount(0)
      await page.getByRole('button', { name: /Emitir Factura A/ }).click()
      await expect(page.getByText(/Factura A emitida/).first(), '[164C] la Factura A no se emitió').toBeVisible({ timeout: 45000 })
      await expect(page.getByText(/Error al emitir/i)).toHaveCount(0)
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar PDF/ }).click()])
      expect(dl.suggestedFilename(), '[164C] nombre del PDF').toMatch(/^Factura_A_\d{4}-\d{8}_E2E_Receptor164_\d+\.pdf$/)
      await dl.saveAs(path.join(EVIDENCIA, 'factura-A.pdf'))
    } finally {
      await request.patch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}`, { headers, data: { activo: false } })
    }
  })
})
