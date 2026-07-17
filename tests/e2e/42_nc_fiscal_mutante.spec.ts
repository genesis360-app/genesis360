/**
 * 42_nc_fiscal_mutante.spec.ts
 * E2E MUTANTE — Nota de Crédito electrónica AFIP (REGLA #0 fiscal).
 *
 * Valida el flujo "Devolver → Emitir NC" en su pieza fiscal: a partir de una venta
 * FACTURADA con CAE que tiene una devolución registrada, emite la NC electrónica
 * (Edge Function `emitir-factura` con `devolucion_id`), que arma el CbtesAsoc
 * referenciando la factura original (AFIP 10197 si falta) y guarda `nc_cae` en
 * `devoluciones`. Aserción POSITIVA (toast "NC-C emitida — CAE:").
 *
 * 🌱 SIEMBRA SU PROPIA PRECONDICIÓN (2026-07-15). Antes dependía de una devolución
 * sembrada a mano en DEV: la PRIMERA corrida la consumía (le escribía `nc_cae`) y a partir
 * de ahí el spec quedaba ROJO para siempre, hasta que alguien sembrara otra a mano — y
 * encima asserteaba en vez de skipear, contra lo que decía su propio docstring. Ahora, si
 * no hay una devolución pendiente de NC sobre la venta fixture, el spec la crea por API
 * (tenant-scoped, con el token del owner: hay policies `dev_tenant_insert`/`devitem_tenant_insert`).
 * Insertar en `devoluciones` NO tiene triggers → no toca stock ni caja: solo crea el papel
 * que la emisión fiscal necesita. Así el spec es REPETIBLE.
 *
 * EMITE una NC de homologación por corrida (sin valor fiscal) — intencional (mutante),
 * como el spec 21. La llamada a AFIP homologación puede ser lenta → timeout generoso.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const E2E_EMAIL = process.env.E2E_EMAIL
const E2E_PASSWORD = process.env.E2E_PASSWORD

const VENTA_NUMERO = '239'                                        // Factura C #31 con CAE
const VENTA_ID = 'ab21cbfd-e898-485a-b7da-830884194202'           // la misma venta #239 (DEV)
const TENANT = '3769b1db-10f4-46a6-bc7f-eb669307730d'             // Almacén Jorgito (DEV)
const PRODUCTO_ID = 'afdfe8e1-6d66-4d68-87df-83e28968556a'
const MONTO = 1200

async function loginToken(request: any): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })
  expect(res.ok(), 'login e2e falló (revisar E2E_EMAIL/E2E_PASSWORD)').toBeTruthy()
  return (await res.json()).access_token as string
}

/** Deja garantizada una devolución `facturada` sin `nc_cae` sobre la venta fixture. */
async function sembrarDevolucionPendiente(request: any) {
  const token = await loginToken(request)
  const headers = {
    Authorization: `Bearer ${token}`, apikey: ANON!,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  }

  const yaHay = await request.get(
    `${SUPABASE_URL}/rest/v1/devoluciones?venta_id=eq.${VENTA_ID}&nc_cae=is.null&select=id`,
    { headers },
  )
  expect(yaHay.ok(), 'no se pudo consultar devoluciones (¿RLS/token?)').toBeTruthy()
  if (((await yaHay.json()) as unknown[]).length > 0) return   // ya hay una pendiente

  const devRes = await request.post(`${SUPABASE_URL}/rest/v1/devoluciones`, {
    headers,
    data: {
      tenant_id: TENANT, venta_id: VENTA_ID, origen: 'facturada',
      motivo: 'Fixture e2e NC (spec 42) — sembrada por el propio spec',
      monto_total: MONTO,
    },
  })
  expect(devRes.ok(), `no se pudo sembrar la devolución fixture: ${await devRes.text()}`).toBeTruthy()
  const devId = (await devRes.json())[0].id as string

  const itemRes = await request.post(`${SUPABASE_URL}/rest/v1/devolucion_items`, {
    headers,
    data: { devolucion_id: devId, producto_id: PRODUCTO_ID, cantidad: 1, precio_unitario: MONTO },
  })
  expect(itemRes.ok(), `no se pudo sembrar el item de la devolución: ${await itemRes.text()}`).toBeTruthy()
}

test.describe('Nota de Crédito electrónica (mutante)', () => {
  test.skip(!SUPABASE_URL || !ANON || !E2E_EMAIL || !E2E_PASSWORD,
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD en el entorno.')

  test('devolución de venta facturada → emite NC-C → CAE de AFIP homologación', async ({ page, request }) => {
    // 0) Precondición propia: garantizar una devolución pendiente de NC.
    await sembrarDevolucionPendiente(request)

    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Tab Historial + buscar la venta facturada por número
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(500)
    await page.getByPlaceholder(/Buscar por N° o cliente/i).fill(VENTA_NUMERO)
    await page.waitForTimeout(600)

    // 2) Abrir el detalle de la venta (primera fila filtrada). El query de historial puede
    //    tardar en cargar → esperar a que la fila exista antes de clickear.
    // ⚠ `isVisible({timeout})` NO espera (ignora el timeout, devuelve el estado inmediato) →
    // este spec se SKIPEABA en silencio cuando el filtro tardaba >0ms. `waitFor` sí espera.
    // Y la venta #239 es fixture PERMANENTE: si no está, es precondición rota → FALLA ruidosa,
    // no skip (la lección de los 19 test.skip decididos con isVisible()).
    const fila = page.locator('div.divide-y > div').filter({ hasText: /\$/ }).first()
    const hayFila = await fila.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
    expect(
      hayFila,
      `No se encontró la venta #${VENTA_NUMERO} en el historial — es fixture permanente del tenant e2e; revisar, no skipear.`,
    ).toBeTruthy()
    await fila.click()
    await page.waitForTimeout(1500) // el detalle dispara la query de devoluciones (async)

    // 3) El detalle muestra el colapsable "Devoluciones (N)" → expandir
    const devolucionesToggle = page.getByRole('button', { name: /Devoluciones \(\d+\)/ }).first()
    await expect(devolucionesToggle, 'la venta fixture no muestra devoluciones (¿falló la siembra?)')
      .toBeVisible({ timeout: 8000 })
    await devolucionesToggle.click()
    await page.waitForTimeout(400)

    // 4) Botón "Emitir NC" (aparece con origen=facturada + venta con CAE + sin nc_cae).
    //    Ya no es un skip: la precondición la sembramos nosotros, así que si no está, es un bug.
    const emitirNcBtn = page.getByRole('button', { name: /^Emitir NC$/ }).first()
    await expect(emitirNcBtn, 'no hay devolución pendiente de NC pese a la siembra (¿facturación deshabilitada?)')
      .toBeVisible({ timeout: 6000 })
    await emitirNcBtn.click()

    // 5) Modal "Emitir Nota de Crédito" → confirmar emisión (la letra la fija la factura: NC-C)
    await expect(page.getByRole('heading', { name: /Emitir Nota de Crédito/ })).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Emitir NC-C/ }).click()

    // 6) CAE real de AFIP homologación (la llamada externa tarda — timeout generoso)
    await expect(page.getByText(/NC-C emitida.*CAE:/)).toBeVisible({ timeout: 45000 })
    await expect(page.getByText(/Error al emitir NC/i)).not.toBeVisible()
  })
})
