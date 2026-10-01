/**
 * 168_importador_clientes_todo_o_nada_mutante.spec.ts
 * E2E MUTANTE — Importador de clientes en dos pasos, TODO O NADA (D3-a, mig 448 `fn_importar_clientes`).
 *
 *  A · actualizar un cliente existente con una celda VACÍA no borra su dato (antes sí) y la celda con valor se escribe.
 *  B · DNI que ya es de OTRO cliente → error con motivo, sin botón de carga.
 *  C · todo o nada: la vista previa da limpio, pero antes de cargar alguien toma uno de esos emails → la base rechaza,
 *      informa la fila y no queda creado ninguno.
 *  D · dos filas que caen sobre el mismo cliente existente → error en ambas.
 *
 * Datos propios con timestamp; al final se desactivan.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

type H = Record<string, string>

async function abrirImportador(page: Page) {
  await goto(page, '/clientes')
  await waitForApp(page)
  const headers = restHeaders(await tokenDesdeBrowser(page))
  const [s] = (await (await page.request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })).json()) as any[]
  await page.getByRole('button', { name: /acciones/i }).first().click()
  await page.getByRole('menuitem', { name: /^Importar$/ }).or(page.getByRole('button', { name: /^Importar$/ })).first().click()
  await expect(page.getByRole('heading', { name: /Importar clientes/ })).toBeVisible()
  return { headers, tid: s.tenant_id as string }
}

async function subir(page: Page, rows: Record<string, unknown>[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Clientes')
  await page.locator('input[type="file"][accept*=".xlsx"]').first().setInputFiles({
    name: `e2e168_${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
}

async function crearCliente(request: APIRequestContext, headers: H, tid: string, datos: Record<string, unknown>) {
  const r = await request.post(`${SUPABASE_URL}/rest/v1/clientes`, {
    headers: { ...headers, Prefer: 'return=representation' }, data: { tenant_id: tid, ...datos },
  })
  expect(r.ok(), await r.text()).toBe(true)
  return ((await r.json()) as any[])[0] as { id: string }
}

const leer = async (request: APIRequestContext, headers: H, filtro: string) =>
  (await (await request.get(`${SUPABASE_URL}/rest/v1/clientes?${filtro}&select=id,nombre,dni,telefono,email,notas`, { headers })).json()) as any[]

async function desactivar(request: APIRequestContext, headers: H, filtro: string) {
  await request.patch(`${SUPABASE_URL}/rest/v1/clientes?${filtro}`, { headers, data: { activo: false, dni: null, email: null } })
}

const dniDe = (ts: number, n: number) => String(70_000_000 + ((ts / 10 + n) % 9_000_000)).slice(0, 8)

test.describe('Importador de clientes — dos pasos, todo o nada (D3-a)', () => {
  test('A · una celda vacía no borra el dato del cliente existente; la que trae valor se escribe', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrirImportador(page)
    const ts = Date.now()
    const dni = dniDe(ts, 1)
    const c = await crearCliente(request, headers, tid, { nombre: `E2E 168A ${ts}`, dni, email: `e2e168a${ts}@x.com`, notas: 'nota vieja' })
    try {
      await subir(page, [{ nombre: `E2E 168A ${ts}`, dni, telefono: '11 4444-1234', email: '', notas: '' }])
      await page.getByText(/Procesar todos/).click()
      await page.getByRole('button', { name: /^Cargar 1 clientes/ }).click({ timeout: 15000 })
      await expect(page.getByText(/0 creados · 1 actualizados/).first()).toBeVisible({ timeout: 15000 })
      const [r] = await leer(request, headers, `id=eq.${c.id}`)
      expect(r.telefono).toBe('11 4444-1234')
      expect(r.email, '[168A] la celda vacía borró el email').toBe(`e2e168a${ts}@x.com`)
      expect(r.notas, '[168A] la celda vacía borró las notas').toBe('nota vieja')
    } finally {
      await desactivar(request, headers, `id=eq.${c.id}`)
    }
  })

  test('B · la fila es un cliente (por DNI) pero trae el email de OTRO: error con motivo y sin botón de carga', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrirImportador(page)
    const ts = Date.now()
    const dni = dniDe(ts, 2)
    const email = `e2e168b${ts}@x.com`
    const y = await crearCliente(request, headers, tid, { nombre: `E2E 168B Y ${ts}`, dni })
    const x = await crearCliente(request, headers, tid, { nombre: `E2E 168B X ${ts}`, email })
    try {
      await subir(page, [{ nombre: `E2E 168B Y ${ts}`, dni, email }])
      await expect(page.getByText(new RegExp(`El email ya es de otro cliente \\(E2E 168B X ${ts}\\)`))).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(/Hay 1 fila con error/)).toBeVisible()
      await expect(page.getByRole('button', { name: /^Cargar \d+ clientes/ })).toHaveCount(0)
    } finally {
      await desactivar(request, headers, `id=in.(${y.id},${x.id})`)
    }
  })

  test('C · todo o nada: si la base rechaza una fila, no se crea ninguno', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrirImportador(page)
    const ts = Date.now()
    const filas = [1, 2, 3].map(n => ({ nombre: `E2E 168C ${n} ${ts}`, email: `e2e168c${n}_${ts}@x.com` }))
    let intruso: { id: string } | null = null
    try {
      await subir(page, filas)
      await expect(page.getByRole('button', { name: /^Cargar 3 clientes/ })).toBeVisible({ timeout: 15000 })
      intruso = await crearCliente(request, headers, tid, { nombre: `E2E 168C intruso ${ts}`, email: filas[2].email })
      await page.getByRole('button', { name: /^Cargar 3 clientes/ }).click()
      const alerta = page.getByRole('alert')
      await expect(alerta).toContainText('No se cargó nada', { timeout: 15000 })
      await expect(alerta).toContainText('Fila 4: ya existe otro cliente con ese email')
      expect(await leer(request, headers, `nombre=like.E2E 168C *${ts}&nombre=not.like.*intruso*`), '[168C] no tenía que crearse ninguno').toHaveLength(0)
    } finally {
      await desactivar(request, headers, `nombre=like.E2E 168C *${ts}`)
    }
  })

  test('D · dos filas que son el mismo cliente existente: error en ambas', async ({ page, request }) => {
    test.setTimeout(90_000)
    const { headers, tid } = await abrirImportador(page)
    const ts = Date.now()
    const dni = dniDe(ts, 4)
    const c = await crearCliente(request, headers, tid, { nombre: `E2E 168D ${ts}`, dni })
    try {
      await subir(page, [{ nombre: `E2E 168D ${ts}`, dni }, { nombre: `E2E 168D ${ts}`, notas: 'otra' }])
      await expect(page.getByText(/Las filas 2, 3 son el mismo cliente/).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(/Hay 2 filas con error/)).toBeVisible()
    } finally {
      await desactivar(request, headers, `id=eq.${c.id}`)
    }
  })
})
