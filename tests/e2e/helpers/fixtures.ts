/**
 * Helpers de FIXTURES para los e2e — GARANTIZAN precondiciones en vez de skipearlas.
 *
 * ─── Por qué existe este archivo (2026-07-15) ──────────────────────────────────────────
 * La suite era NO DETERMINÍSTICA: dos corridas seguidas del mismo código contra la misma DB
 * daban fallas DISTINTAS (corrida A: rojo el 85, verdes 28/33/55 · corrida B: verde el 85,
 * rojos 28/33/55). Con `workers: 1` + `fullyParallel: false` no es una race: los specs
 * comparten un tenant DEV mutable y **asumen precondiciones que no establecen**.
 *
 * Y el resto se degradaba a "verde por skip": 33 de 261 tests se auto-skipeaban cuando su
 * fixture no estaba ("No hay productos vendibles en el tenant de prueba" ×14, "Presupuesto
 * fixture $7.777 no encontrado (re-sembrar el SQL)"). Una suite así puede erosionarse hasta
 * no probar NADA y seguir reportando verde — inaceptable para la red de seguridad de lo
 * fiscal/contable/inventario (REGLA #0): una regresión real se descarta como "el flake de
 * siempre".
 *
 * ─── La regla ──────────────────────────────────────────────────────────────────────────
 * Un spec NO debe skipearse porque le falta un fixture: debe SEMBRARLO (patrón ya probado
 * en el spec 42, que siembra su propia devolución por API con el token del owner) o FALLAR
 * RUIDOSO con un mensaje accionable. `test.skip` queda reservado para lo que es legítimamente
 * opcional del ENTORNO (flags `E2E_KIT_DESARMAR`/`E2E_CAJA_AJENA`/`E2E_CAJA_CIERRE_DIF`,
 * credenciales de rol ausentes), nunca para "el estado de DEV no es el que yo esperaba".
 */
import { Page, APIRequestContext, expect } from '@playwright/test'
import { goto, waitForApp } from './navigation'

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL
export const ANON = process.env.VITE_SUPABASE_ANON_KEY

// ─── Auth / REST ────────────────────────────────────────────────────────────────────────

/** Login por API con las credenciales e2e del OWNER → access_token (para sembrar vía PostgREST). */
export async function loginToken(
  request: APIRequestContext,
  email = process.env.E2E_EMAIL,
  password = process.env.E2E_PASSWORD,
): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON!, 'Content-Type': 'application/json' },
    data: { email, password },
  })
  expect(res.ok(), `login e2e falló para "${email}" (revisar E2E_EMAIL/E2E_PASSWORD)`).toBeTruthy()
  return (await res.json()).access_token as string
}

/**
 * Token de la sesión ya autenticada EN EL BROWSER. Preferilo sobre `loginToken` cuando el
 * spec ya está logueado por `storageState`: usa exactamente el mismo bearer que la app, así
 * la siembra respeta la RLS con la identidad real del test (no un service_role).
 */
export async function tokenDesdeBrowser(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))
    if (!key) return null
    try { return JSON.parse(localStorage.getItem(key)!)?.access_token ?? null } catch { return null }
  })
  expect(token, 'No se encontró el access_token de la sesión en localStorage').toBeTruthy()
  return token as string
}

export function restHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    apikey: ANON!,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

// ─── Caja ───────────────────────────────────────────────────────────────────────────────

/**
 * Deja la caja `nombre` ABIERTA, venga como venga (self-healing e idempotente).
 *
 * 🛑 El bug que arregla (spec 28, probado con el `error-context.md` del fallo): el spec
 * clickeaba "Abrir caja" y **rellenaba "Monto inicial" a ciegas**. En la corrida masiva la
 * caja ya estaba abierta por un spec anterior, el modal nunca aparecía y el `fill` se colgaba
 * 30s. El snapshot del fallo mostraba la sesión YA abierta ("Arqueo requerido antes de
 * cerrar", "Movimientos de la sesión").
 *
 * ⚠ La trampa fina: `staleTime: 0` es global en React Query → la app pinta el CACHÉ VIEJO y
 * refetchea en background. O sea que un botón "Abrir caja" puede estar visible sobre una caja
 * que YA está abierta. Por eso acá nunca se confía en la primera lectura: si el modal no
 * aparece tras el click, se re-chequea el estado real antes de fallar.
 */
export async function garantizarCajaAbierta(
  page: Page,
  opts: { caja?: string; montoInicial?: number } = {},
): Promise<void> {
  const { caja = 'Caja1', montoInicial = 5000 } = opts

  await goto(page, '/caja')
  await waitForApp(page)

  const pill = page.getByRole('button', { name: new RegExp(`${caja}\\b`) }).first()
  expect(
    await pill.isVisible().catch(() => false),
    `[fixtures] No existe la caja "${caja}" en /caja del tenant de prueba. ` +
      `Precondición de infraestructura, no del test: crearla en DEV.`,
  ).toBeTruthy()
  await pill.click()

  // Dejar que el refetch en background termine antes de leer el estado (ver nota staleTime).
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const sesionAbierta = page.getByRole('heading', { name: /Movimientos de la sesión/i }).first()
  const btnAbrir = page.getByRole('button', { name: /^Abrir caja$/ }).first()

  // Esperar a que la UI muestre UNA de las dos señales (ni a medio render, ni a medio refetch)
  await expect
    .poll(
      async () => {
        if (await sesionAbierta.isVisible().catch(() => false)) return 'abierta'
        if (await btnAbrir.isVisible().catch(() => false)) return 'cerrada'
        return 'indefinido'
      },
      {
        timeout: 10000,
        message: `[fixtures] /caja no mostró ni la sesión abierta ni el botón "Abrir caja" para "${caja}"`,
      },
    )
    .not.toBe('indefinido')

  if (await sesionAbierta.isVisible().catch(() => false)) return // ya estaba abierta → nada que hacer

  await btnAbrir.click()

  // ⚠ `locator.isVisible()` NO auto-espera: devuelve el estado INMEDIATO e ignora `timeout`.
  // Usarlo acá preguntaba por el modal a los ~0ms del click (todavía sin renderizar) y contestaba
  // `false` siempre. Hay que usar `waitFor`, que sí espera.
  const visible = (l: ReturnType<Page['locator']>, timeout: number) =>
    l.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)

  const montoInput = page.locator('xpath=//label[contains(.,"Monto inicial")]/following::input[1]')
  if (!(await visible(montoInput, 5000))) {
    // El botón era STALE (caché viejo de React Query): la caja ya estaba abierta de verdad.
    if (await visible(sesionAbierta, 3000)) return
    throw new Error(
      `[fixtures] "Abrir caja" no abrió el modal de apertura para "${caja}" y la caja tampoco ` +
        `figura abierta. Estado de /caja inesperado — revisar el screenshot del fallo.`,
    )
  }

  await montoInput.fill(String(montoInicial))
  await page.getByRole('button', { name: /Confirmar apertura|Sí, abrir con diferencia/ }).first().click()
  await page.waitForTimeout(500)
  const dif = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
  if (await dif.isVisible().catch(() => false)) await dif.click()

  // POSITIVO: la caja quedó realmente abierta (no asumir que el click alcanzó)
  await expect(sesionAbierta).toBeVisible({ timeout: 10000 })
}

// ─── POS / productos ────────────────────────────────────────────────────────────────────

/**
 * Agrega el primer producto vendible al carrito del POS y devuelve el total del carrito.
 *
 * Reemplaza al `test.skip(!prod.isVisible(), 'No hay productos vendibles en el tenant de
 * prueba')` que estaba **copy-pasteado en 8+ specs**: que no haya producto vendible NO es
 * motivo para dar verde por skip — es una falla de precondición y tiene que gritar.
 *
 * Además valida que realmente estemos en el POS antes de buscar: en la corrida masiva se vio
 * a `/ventas` renderizar el DASHBOARD (spec 55), y el síntoma era un críptico "element not
 * found" del buscador. Un mensaje que dice qué se esperaba y qué se renderizó ahorra la hora
 * de diagnóstico que costó encontrarlo.
 */
export async function irAlPOS(page: Page): Promise<void> {
  await goto(page, '/ventas')
  await waitForApp(page)

  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  if (await buscador.isVisible({ timeout: 8000 }).catch(() => false)) return

  // No está el POS → decir QUÉ se renderizó en su lugar (el redirect a /dashboard es un
  // síntoma real observado, todavía sin causa raíz identificada).
  const url = page.url()
  const h1 = await page.locator('h1').first().innerText().catch(() => '(sin h1)')
  const pareceDashboard = await page
    .getByRole('heading', { name: /La Balanza|El Mix de Caja/i })
    .first()
    .isVisible()
    .catch(() => false)
  throw new Error(
    `[fixtures] Se esperaba el POS en /ventas pero no apareció el buscador de productos. ` +
      `URL="${url}" h1="${h1}"${pareceDashboard ? ' — ¡renderizó el DASHBOARD! (redirect inesperado)' : ''}`,
  )
}

/**
 * Agrega al carrito el primer producto vendible. Falla ruidoso si no hay ninguno.
 *
 * 🛑 Sin sleeps fijos — y ésta es LA causa raíz de que la suite fuera no determinística.
 * El patrón original era `fill(busqueda)` + `waitForTimeout(1000)` + leer el resultado con
 * `isVisible()` (que NO auto-espera). Ese segundo alcanza con la máquina ociosa (spec
 * aislado) y NO alcanza bajo la carga de la suite completa → el mismo test pasa o falla
 * según cuán ocupada esté la máquina, y las fallas se mueven de corrida en corrida.
 * Había **243 `waitForTimeout` fijos en 69 specs**: cada uno es una apuesta a que el
 * browser responda en X ms.
 *
 * Acá se espera el RESULTADO (locator auto-esperante), no el reloj.
 */
export async function agregarPrimerProductoAlCarrito(page: Page, busqueda = 'a'): Promise<void> {
  const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
  await expect(buscador).toBeVisible({ timeout: 8000 })
  await buscador.fill(busqueda)

  const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
  const aparecio = await prod
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  expect(
    aparecio,
    `[fixtures] El POS no devolvió ningún producto vendible para "${busqueda}" en 15s. ` +
      `Si el tenant SÍ tiene stock, sospechar de la sucursal seleccionada (el stock filtra por ` +
      `sucursal_id) o de que el buscador todavía estaba debounceando. ` +
      `Antes esto era un test.skip: se salteaba en silencio y la suite daba verde.`,
  ).toBeTruthy()

  await prod.click()
  // POSITIVO: el carrito acusa recibo (auto-espera, sin sleep)
  await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 8000 })
}

/** Lee el total del carrito del POS como número. */
export async function totalDelCarrito(page: Page): Promise<number> {
  const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent()
  const total =
    parseFloat((totalTxt ?? '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
  expect(total, '[fixtures] el total del carrito quedó en 0 — el producto no se agregó').toBeGreaterThan(0)
  return total
}
