/**
 * 174_stock_sin_ubicar_avanzado_mutante.spec.ts
 * E2E MUTANTE — U-2 (decisión de GO 2026-10-01: A + B). Lo destapó el 2º cliente real: en modo AVANZADO el POS solo vende
 * stock con ubicación (y en ubicaciones habilitadas para surtido), pero el ingreso dejaba cargar stock sin ubicación y el
 * POS decía "no tiene stock" con el stock a la vista en Inventario.
 *
 *  A1 · Stock sin ubicar → el POS lo explica ("N unidades sin ubicar") y el botón lleva a Inventario filtrado.
 *  A2 · Stock en una ubicación NO habilitada para surtido → el POS lo explica y nombra la ubicación.
 *  B  · El ingreso individual en avanzado no se guarda sin ubicación (y no crea nada).
 *
 * Tenant Almacén Jorgito (avanzado). Desde la mig 455 nadie puede crear stock sin ubicación en avanzado, así que A1 lo
 * siembra con el escenario REAL en que aparece: el negocio estaba en BÁSICO (stock sin ubicar) y pasa a AVANZADO
 * (mismo update que Configuración → modo). El modo se restaura en `finally`.
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, irAlPOS, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

async function preparar(page: Page) {
  await goto(page, '/dashboard')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const sucs = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=id,nombre,tenant_id&activo=eq.true`, { headers })).json()) as any[]
  const suc = sucs.find(s => /norte/i.test(s.nombre)) ?? sucs[0]
  // La sucursal activa del POS = la sembrada (gotcha 15 de e2e).
  await page.evaluate(id => localStorage.setItem('sucursal-id', id), suc.id)
  // Estado "Disponible": está en el grupo predeterminado del POS (un estado fuera del grupo se filtra, y está bien).
  const [estado] = (await (await page.request.get(
    `${SUPABASE_URL}/rest/v1/estados_inventario?select=id&nombre=eq.Disponible&es_disponible_venta=eq.true&limit=1`, { headers })).json()) as any[]
  expect(estado, '[174] falta el estado "Disponible" en el tenant de prueba').toBeTruthy()
  return { headers, tid: suc.tenant_id as string, sucId: suc.id as string, estadoId: estado?.id as string }
}

async function crearProducto(page: Page, headers: H, tid: string, nombre: string, sku: string) {
  const r = await page.request.post(`${SUPABASE_URL}/rest/v1/productos`, {
    headers: { ...headers, Prefer: 'return=representation' },
    data: { tenant_id: tid, nombre, sku, precio_venta: 1000, precio_costo: 500, activo: true },
  })
  expect(r.ok(), `[174] no se pudo crear el producto: ${await r.text()}`).toBe(true)
  return ((await r.json()) as any[])[0].id as string
}

async function sembrarLinea(page: Page, headers: H, data: Record<string, unknown>) {
  const r = await page.request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, { headers, data })
  expect(r.ok(), `[174] no se pudo sembrar la línea: ${await r.text()}`).toBe(true)
}

async function intentarVender(page: Page, sku: string) {
  await irAlPOS(page)
  await page.getByPlaceholder(/buscar por nombre/i).first().fill(sku)
  const prod = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: sku }).first()
  await expect(prod, `[174] "${sku}" no aparece en el buscador del POS`).toBeVisible({ timeout: 15000 })
  await prod.click()
}

test.describe('U-2 — stock sin ubicar en modo avanzado (A + B)', () => {
  test('A1 · sin ubicar: el POS lo explica y lleva a Inventario filtrado', async ({ page }) => {
    test.setTimeout(120_000)
    const { headers, tid, sucId, estadoId } = await preparar(page)
    const ts = Date.now()
    const sku = `E2E174A-${ts}`
    const prodId = await crearProducto(page, headers, tid, `E2E 174 sin ubicar ${ts}`, sku)
    try {
      // Básico → stock sin ubicar → vuelve a avanzado (como un negocio que cambia de modo).
      const aBasico = await page.request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, { headers, data: { modo_operacion: 'basico' } })
      expect(aBasico.ok(), `[174A1] no se pudo pasar a básico: ${await aBasico.text()}`).toBe(true)
      try {
        await sembrarLinea(page, headers, { tenant_id: tid, producto_id: prodId, cantidad: 7, sucursal_id: sucId, estado_id: estadoId, activo: true })
      } finally {
        await page.request.patch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tid}`, { headers, data: { modo_operacion: 'avanzado' } })
      }
      await intentarVender(page, sku)
      await expect(page.getByText(/Hay\s*7 unidades sin ubicar/), '[174A1] el POS no explicó que el stock está sin ubicar').toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Este producto no tiene stock disponible')).toHaveCount(0)
      await page.getByRole('button', { name: 'Ubicarlas en Inventario' }).click()
      await expect(page).toHaveURL(/\/inventario/, { timeout: 10000 })
    } finally {
      await page.request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prodId}`, { headers, data: { activo: false } })
      await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, { headers, data: { activo: false } })
    }
  })

  test('A2 · en una ubicación no habilitada para surtido: el POS la nombra', async ({ page }) => {
    test.setTimeout(120_000)
    const { headers, tid, sucId, estadoId } = await preparar(page)
    const ts = Date.now()
    const sku = `E2E174B-${ts}`
    const ubicNombre = `E2E 174 no surtido ${ts}`
    const prodId = await crearProducto(page, headers, tid, `E2E 174 no surtido ${ts}`, sku)
    const ru = await page.request.post(`${SUPABASE_URL}/rest/v1/ubicaciones`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tid, nombre: ubicNombre, sucursal_id: sucId, disponible_surtido: false, activo: true },
    })
    expect(ru.ok(), `[174A2] no se pudo crear la ubicación: ${await ru.text()}`).toBe(true)
    const ubicId = ((await ru.json()) as any[])[0].id
    try {
      await sembrarLinea(page, headers, { tenant_id: tid, producto_id: prodId, cantidad: 4, sucursal_id: sucId, estado_id: estadoId, ubicacion_id: ubicId, activo: true })
      await intentarVender(page, sku)
      await expect(page.getByText(/no está habilitada para venta/), '[174A2] el POS no explicó que la ubicación no vende').toBeVisible({ timeout: 10000 })
      await expect(page.getByText(ubicNombre).first()).toBeVisible()
    } finally {
      await page.request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prodId}`, { headers, data: { activo: false } })
      await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, { headers, data: { activo: false } })
      await page.request.patch(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${ubicId}`, { headers, data: { activo: false } })
    }
  })

  test('B · el ingreso individual no se guarda sin ubicación', async ({ page }) => {
    test.setTimeout(120_000)
    const { headers, tid } = await preparar(page)
    const ts = Date.now()
    const nombre = `E2E 174 ingreso ${ts}`
    const prodId = await crearProducto(page, headers, tid, nombre, `E2E174C-${ts}`)
    try {
      await goto(page, '/inventario')
      await waitForApp(page)
      await page.getByRole('button', { name: 'Agregar stock' }).first().click()
      await page.getByRole('button', { name: /^Ingreso$/ }).first().click()
      const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
      await buscador.fill(nombre)
      const modal = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
      await modal.getByText(nombre).first().click()
      const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
      await expect(ubicSelect, '[174B] el ingreso en avanzado no muestra la ubicación').toBeVisible({ timeout: 8000 })
      // Si el producto no tiene ubicación habitual, el campo arranca vacío: no se presupone ninguna.
      await expect(ubicSelect).toHaveValue('')
      await page.locator('input[type="number"][placeholder="0"]').first().fill('3')
      await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
      await expect(page.getByText(/Elegí la ubicación: en modo avanzado/), '[174B] dejó ingresar sin ubicación').toBeVisible({ timeout: 10000 })
      const lineas = (await (await page.request.get(
        `${SUPABASE_URL}/rest/v1/inventario_lineas?select=id&producto_id=eq.${prodId}`, { headers })).json()) as any[]
      expect(lineas, '[174B] se creó stock sin ubicación').toHaveLength(0)
      // …y la base tampoco lo deja (mig 455), aunque se saltee la pantalla.
      const directo = await page.request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
        headers, data: { tenant_id: tid, producto_id: prodId, cantidad: 3, activo: true },
      })
      expect(directo.ok(), '[174B] la base aceptó stock sin ubicación en avanzado').toBe(false)
      expect(await directo.text()).toContain('necesita una ubicación')
      // Ni el atajo de crearla inactiva y activarla después.
      const inactiva = await page.request.post(`${SUPABASE_URL}/rest/v1/inventario_lineas`, {
        headers: { ...headers, Prefer: 'return=representation' }, data: { tenant_id: tid, producto_id: prodId, cantidad: 3, activo: false },
      })
      expect(inactiva.ok(), await inactiva.text()).toBe(true)
      const idInactiva = ((await inactiva.json()) as any[])[0].id
      const activar = await page.request.patch(`${SUPABASE_URL}/rest/v1/inventario_lineas?id=eq.${idInactiva}`, { headers, data: { activo: true } })
      expect(activar.ok(), '[174B] se pudo activar una línea sin ubicación').toBe(false)
    } finally {
      await page.request.patch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${prodId}`, { headers, data: { activo: false } })
    }
  })
})
