/**
 * 170_importador_proveedores_mutante.spec.ts
 * E2E MUTANTE — Importar proveedores desde la pantalla de Proveedores (mig 450 `fn_importar_proveedores`, D3-a).
 *
 *  A · alta con CUIT/condición IVA/CBU: se guardan normalizados (CUIT y CBU solo dígitos, condición con el código).
 *  B · proveedor existente (cargado a mano con guiones en el CUIT) → se detecta por CUIT; actualizar escribe solo las
 *      celdas con valor (el email que tenía queda).
 *  C · CUIT con dígito verificador mal, CBU inválido, condición IVA desconocida → error con motivo, sin carga.
 *  D · todo o nada: el proveedor a actualizar se borra entre la vista previa y la carga → no queda creado el otro.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

// CUIT válido a partir de 10 dígitos (calcula el verificador; salta los que darían DV 10).
function cuitDe(base10: string): string {
  const p = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const r = 11 - (p.reduce((a, w, i) => a + w * Number(base10[i]), 0) % 11)
  const dv = r === 11 ? 0 : r === 10 ? 9 : r
  return base10 + dv
}
function cbuValidoDe(b7: string, c13: string) {
  const dv = (d: string, p: number[]) => (10 - (p.reduce((a, w, i) => a + w * Number(d[i]), 0) % 10)) % 10
  return b7 + dv(b7, [7, 1, 3, 9, 7, 1, 3]) + c13 + dv(c13, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])
}

async function abrir(page: Page) {
  await goto(page, '/proveedores')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [s] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  await page.getByRole('button', { name: /acciones/i }).first().click()
  await page.getByRole('menuitem', { name: /^Importar$/ }).or(page.getByRole('button', { name: /^Importar$/ })).first().click()
  await expect(page.getByRole('heading', { name: /Importar proveedores/ })).toBeVisible()
  return { headers, tid: s.tenant_id as string }
}

async function subir(page: Page, rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Proveedores')
  await page.locator('input[type="file"][accept*=".xlsx"]').first().setInputFiles({
    name: `e2e170_${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
}

const leer = async (request: APIRequestContext, headers: H, filtro: string) =>
  (await (await request.get(`${SUPABASE_URL}/rest/v1/proveedores?${filtro}&select=id,nombre,cuit,condicion_iva,cbu,telefono,email,plazo_pago_dias,tipo`, { headers })).json()) as any[]

const desactivar = (request: APIRequestContext, headers: H, filtro: string) =>
  request.patch(`${SUPABASE_URL}/rest/v1/proveedores?${filtro}`, { headers, data: { activo: false } })

test.describe('Importar proveedores (D3-a, mig 450)', () => {
  test('A · alta con CUIT, condición IVA y CBU normalizados', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers } = await abrir(page)
    const ts = Date.now()
    const cuit = cuitDe(`30${String(ts).slice(-8)}`)
    const cbu = cbuValidoDe('0110599', String(ts).slice(-13).padStart(13, '0'))
    try {
      await subir(page, [{
        nombre: `E2E 170A ${ts}`, razon_social: `E2E 170A SRL ${ts}`,
        cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`, condicion_iva: 'Responsable Inscripto',
        cbu: `${cbu.slice(0, 8)} ${cbu.slice(8)}`, plazo_pago_dias: 30, telefono: '11 5555-0000', tipo: 'servicio',
      }])
      await page.getByRole('button', { name: /^Cargar 1 proveedores/ }).click({ timeout: 15000 })
      await expect(page.getByText(/1 creados · 0 actualizados/).first()).toBeVisible({ timeout: 15000 })
      const [p] = await leer(request, headers, `nombre=eq.E2E 170A ${ts}`)
      expect(p).toMatchObject({ cuit, condicion_iva: 'responsable_inscripto', cbu, plazo_pago_dias: 30, tipo: 'servicio' })
    } finally {
      await desactivar(request, headers, `nombre=eq.E2E 170A ${ts}`)
    }
  })

  test('B · existente por CUIT (con guiones en la base): actualiza solo las celdas con valor', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page)
    const ts = Date.now()
    const cuit = cuitDe(`30${String(ts + 1).slice(-8)}`)
    const r = await request.post(`${SUPABASE_URL}/rest/v1/proveedores`, {
      headers: { ...headers, Prefer: 'return=representation' },
      data: { tenant_id: tid, nombre: `E2E 170B ${ts}`, cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`, email: `e2e170b${ts}@x.com` },
    })
    expect(r.ok(), await r.text()).toBe(true)
    const id = ((await r.json()) as any[])[0].id
    try {
      await subir(page, [{ nombre: 'Otro nombre en el archivo', cuit, telefono: '11 4444-0000', email: '' }])
      await expect(page.getByText(new RegExp(`Ya existe \\(E2E 170B ${ts}\\)`))).toBeVisible({ timeout: 15000 })
      await page.getByText(/Procesar todos/).click()
      await page.getByRole('button', { name: /^Cargar 1 proveedores/ }).click()
      await expect(page.getByText(/0 creados · 1 actualizados/).first()).toBeVisible({ timeout: 15000 })
      const [p] = await leer(request, headers, `id=eq.${id}`)
      expect(p.telefono).toBe('11 4444-0000')
      expect(p.email, '[170B] la celda vacía borró el email').toBe(`e2e170b${ts}@x.com`)
    } finally {
      await desactivar(request, headers, `id=eq.${id}`)
    }
  })

  test('C · CUIT, CBU y condición IVA inválidos: error con motivo, sin carga', async ({ page }) => {
    await abrir(page)
    await subir(page, [
      { nombre: 'X1', cuit: '30-71234567-0' },
      { nombre: 'X2', cbu: '0110599520000001234560' },
      { nombre: 'X3', condicion_iva: 'No responsable' },
    ])
    await expect(page.getByText(/CUIT "30-71234567-0" inválido/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/CBU "0110599520000001234560" inválido/)).toBeVisible()
    await expect(page.getByText(/Condición IVA "No responsable" no válida/)).toBeVisible()
    await expect(page.getByText(/Hay 3 filas con error/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cargar \d+ proveedores/ })).toHaveCount(0)
  })

  test('D · todo o nada: si el proveedor a actualizar desaparece, no se crea el otro', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrir(page)
    const ts = Date.now()
    const r = await request.post(`${SUPABASE_URL}/rest/v1/proveedores`, {
      headers: { ...headers, Prefer: 'return=representation' }, data: { tenant_id: tid, nombre: `E2E 170D viejo ${ts}` },
    })
    const id = ((await r.json()) as any[])[0].id
    try {
      await subir(page, [{ nombre: `E2E 170D viejo ${ts}`, telefono: '1' }, { nombre: `E2E 170D nuevo ${ts}` }])
      await page.getByText(/Procesar todos/).click({ timeout: 15000 })
      await expect(page.getByRole('button', { name: /^Cargar 2 proveedores/ })).toBeVisible()
      const del = await request.delete(`${SUPABASE_URL}/rest/v1/proveedores?id=eq.${id}`, { headers })
      expect(del.ok(), await del.text()).toBe(true)
      await page.getByRole('button', { name: /^Cargar 2 proveedores/ }).click()
      await expect(page.getByRole('alert')).toContainText('No se cargó nada', { timeout: 15000 })
      expect(await leer(request, headers, `nombre=eq.E2E 170D nuevo ${ts}`), '[170D] no tenía que crearse el nuevo').toHaveLength(0)
    } finally {
      await desactivar(request, headers, `nombre=like.E2E 170D*${ts}`)
    }
  })
})
