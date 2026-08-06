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
import { Page, APIRequestContext, Locator, expect } from '@playwright/test'
import { goto, waitForApp } from './navigation'

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL
export const ANON = process.env.VITE_SUPABASE_ANON_KEY

/**
 * ¿Aparece `locator` dentro de `timeout`? A diferencia de `locator.isVisible()` (NO
 * auto-espera: lee el estado INMEDIATO e ignora el timeout — la trampa documentada en
 * `garantizarCajaAbierta`), esto SÍ espera el resultado real. Usar para campos OPCIONALES
 * donde "no está" es un resultado legítimo (no un error) — para campos obligatorios, usar
 * `expect(locator).toBeVisible()` directo, que además falla con un mensaje claro si no aparece.
 */
export async function visible(l: Locator, timeout: number): Promise<boolean> {
  return l.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)
}

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
  // `false` siempre. Hay que usar `waitFor` (helper `visible()` del tope del archivo), que sí espera.
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
  // El diálogo de "abrir con diferencia" es OPCIONAL (solo aparece si el monto no matchea el
  // arqueo anterior) — esperar su resultado real en vez de una apuesta de tiempo fijo.
  const dif = page.getByRole('button', { name: /Sí, abrir con diferencia/ })
  if (await visible(dif, 2000)) await dif.click()

  // POSITIVO: la caja quedó realmente abierta (no asumir que el click alcanzó)
  await expect(sesionAbierta).toBeVisible({ timeout: 10000 })
}

// ─── Inventario / Ingreso real ──────────────────────────────────────────────────────────

/**
 * Ingreso REAL de stock por UI (Inventario → Agregar stock → Ingreso) para un producto que
 * YA existe (creado por REST antes de llamar esto, con precio conocido). Extraído del patrón
 * probado en el spec 101 — no hace un INSERT directo a `inventario_lineas`: respeta el flujo
 * real (ubicación, estado, sucursal, trigger de `stock_actual`) para que el producto quede
 * visible/vendible en el POS igual que si lo cargara un operador real (backlog Fede Fase A/C,
 * specs 115/116 — necesitan un producto NUEVO con precio/empaque a medida, no uno del catálogo
 * real como hacía el spec 54).
 *
 * `estadoNombre`, si se pasa, selecciona ESE estado por label exacto — necesario cuando el test
 * depende de que sea `es_disponible_venta=true` para que el producto aparezca en el POS (sin
 * esto, el combo deja el default de la primera opción, que puede no ser vendible).
 */
export async function ingresoRealPorUI(
  page: Page,
  opts: { nombreProducto: string; cantidad: number; estadoNombre?: string },
): Promise<void> {
  const { nombreProducto, cantidad, estadoNombre } = opts
  await goto(page, '/inventario')
  await waitForApp(page)
  await page.getByRole('button', { name: 'Agregar stock' }).first().click()
  // Los `expect(...).toBeVisible()` de abajo YA auto-esperan al resultado real — no hace falta
  // un sleep fijo antes (quedaba un `waitForTimeout` colgado sin ningún efecto real).
  const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
  await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
  expect(
    await ingresoBtn.isEnabled(),
    '[fixtures] "Ingreso" deshabilitado (límite de plan alcanzado) — no se puede sembrar stock para este spec',
  ).toBe(true)
  await ingresoBtn.click()

  const buscadorIngreso = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
  await expect(buscadorIngreso).toBeVisible({ timeout: 6000 })
  await buscadorIngreso.fill(nombreProducto)
  const modalIngreso = page.locator('div.fixed.inset-0').filter({ has: buscadorIngreso }).first()
  const filaProducto = modalIngreso.getByText(nombreProducto).first()
  // El buscador debouncea antes de refetchear — esperar la fila real (nombre único con
  // timestamp, no puede matchear una fila vieja) en vez de una apuesta de tiempo fijo.
  await expect(
    filaProducto,
    `[fixtures] "${nombreProducto}" no apareció en el buscador de Ingreso tras escribirlo`,
  ).toBeVisible({ timeout: 8000 })
  await filaProducto.click()

  const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
  if (await visible(sucSelect, 3000)) {
    const vals = await sucSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (vals.length > 0) await sucSelect.selectOption(vals[0])
  }

  const estadoSelect = page.locator('xpath=//label[contains(.,"Estado")]/following::select[1]')
  if (await visible(estadoSelect, 3000)) {
    if (estadoNombre) {
      await estadoSelect.selectOption({ label: estadoNombre })
    } else {
      const vals = await estadoSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length > 0) await estadoSelect.selectOption(vals[0])
    }
  }

  const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
  if (await visible(ubicSelect, 3000)) {
    const vals = await ubicSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    if (vals.length > 0) await ubicSelect.selectOption(vals[0])
  }

  await page.locator('input[type="number"][placeholder="0"]').first().fill(String(cantidad))
  await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
  await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })
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
 *
 * 🔎 Investigado 2026-08-04, sin repro en vivo (no se forzó otra corrida masiva completa —
 * ya le exigió bastante carga a DEV esta sesión). El redirect a Dashboard más plausible del
 * código (`AppLayout.tsx`, useEffect "Restricciones de rutas por rol") es el branch
 * `user.permisos_custom['ventas'] === 'no_ver'` → navega a `firstAllowed?.to ?? '/dashboard'`.
 * **Descartado**: los 3 usuarios e2e de DEV (`e2e@genesis360.test`, `.sup@`, `-multicuit@`)
 * tienen `rol_custom_id = null` ahora mismo — no hay un rol custom restrictivo colgado de una
 * corrida anterior. Dato real, no descartado por sospecha: consultado contra la DB.
 * Hallazgo de código sin confirmar como causa (candidato para la próxima vez que se reproduzca):
 * ese mismo useEffect depende de `[pathname, user?.rol, user?.permisos_custom]` y solo hace
 * `if (!user) return` — a diferencia del useEffect hermano de arriba (rutas de modo avanzado),
 * que además espera `tenant` (`if (!tenant || modoAvanzado) return`). Si `user` queda seteado
 * antes de que `tenant`/`permisos_custom` terminen de resolverse, es la única ventana del código
 * donde el efecto podría evaluar con datos a medio cargar. Sin reproducción real no se puede
 * confirmar ni arreglar a ciegas.
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

// ─── RRHH / nómina ──────────────────────────────────────────────────────────────────────

/**
 * Garantiza que exista al menos UNA liquidación del período corriente SIN gasto generado
 * (precondición del spec 37: sin eso, el botón "Generar gasto" no existe).
 *
 * 🛑 El spec 37 era ONE-SHOT y se rompía solo — la trampa del spec 42 otra vez: genera la
 * nómina del mes Y su gasto, así que **consume su propia precondición**. Probado con la DB el
 * 2026-07-16: período 2026-07 → 5 liquidaciones, **las 5 ya con `gasto_id`, 0 pendientes** →
 * el spec quedaba ROJO el resto de julio (determinístico, no flake) hasta que cambiara el mes.
 *
 * 🛡 Cómo se libera una, y por qué es seguro (REGLA #0 — esto genera GASTOS):
 * se borra el gasto de una liquidación y el FK `rrhh_salarios_gasto_id_fkey`, que es
 * **ON DELETE SET NULL** (verificado en la DB), desliga la liquidación **atómicamente**. O sea
 * que el escenario peligroso —quedarse con el gasto huérfano y que el spec genere un SEGUNDO
 * gasto para el mismo sueldo (gasto DUPLICADO)— es **imposible por construcción**: no lo evita
 * este código, lo evita la DB. Es revertir el efecto de la corrida anterior, no inventar plata.
 *
 * Tres redes más:
 *  1. **Sólo se borra un gasto `pendiente`** → no tiene movimiento de caja, así que no puede
 *     dejar un asiento huérfano. Si estuviera `pagado` (lo paga el spec 50) NO se toca.
 *  2. Sólo del **período corriente** y sólo de los que cuelgan de `rrhh_salarios` (los generó
 *     exactamente este flujo).
 *  3. El trigger `trg_gastos_periodo_cerrado` **bloquea el DELETE si el período contable está
 *     cerrado** (`fecha <= ultimo_cierre_hasta`) → si alguien cierra el período, esto falla
 *     ruidoso en vez de tocar historia contable.
 */
export async function garantizarLiquidacionSinGasto(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const token = await tokenDesdeBrowser(page)
  const headers = restHeaders(token)

  const hoy = new Date()
  const periodo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`

  // ¿Ya hay una liquidación sin gasto? → precondición satisfecha, no tocar nada.
  const pend = await request.get(
    `${SUPABASE_URL}/rest/v1/rrhh_salarios?periodo=eq.${periodo}&gasto_id=is.null&select=id`,
    { headers },
  )
  expect(pend.ok(), `[fixtures] no se pudo consultar rrhh_salarios: ${await pend.text()}`).toBeTruthy()
  if (((await pend.json()) as unknown[]).length > 0) return

  // Todas consumidas por corridas anteriores → liberar UNA revirtiendo su propio efecto.
  const conGasto = await request.get(
    `${SUPABASE_URL}/rest/v1/rrhh_salarios?periodo=eq.${periodo}&gasto_id=not.is.null` +
      `&select=id,gasto_id,gastos(id,estado_pago,descripcion)`,
    { headers },
  )
  expect(conGasto.ok(), `[fixtures] no se pudo consultar las liquidaciones: ${await conGasto.text()}`).toBeTruthy()
  const filas = (await conGasto.json()) as Array<{
    id: string
    gasto_id: string
    gastos?: { id: string; estado_pago: string; descripcion: string } | null
  }>

  const liberable = filas.find(f => f.gastos?.estado_pago === 'pendiente')
  expect(
    liberable,
    `[fixtures] No hay ninguna liquidación de ${periodo} liberable: o no hay ninguna, o todas ` +
      `sus gastos ya están PAGADOS (${filas.length} con gasto). Un gasto pagado NO se borra ` +
      `(tiene movimiento de caja y borrarlo lo dejaría huérfano — REGLA #0). ` +
      `Sembrar una liquidación nueva a mano o esperar al mes siguiente.`,
  ).toBeTruthy()

  const del = await request.delete(`${SUPABASE_URL}/rest/v1/gastos?id=eq.${liberable!.gasto_id}`, { headers })
  expect(
    del.ok(),
    `[fixtures] no se pudo borrar el gasto pendiente "${liberable!.gastos?.descripcion}" para ` +
      `liberar la precondición: ${await del.text()}`,
  ).toBeTruthy()

  // POSITIVO: la liquidación quedó realmente desligada (el FK SET NULL hizo lo suyo)
  const verif = await request.get(
    `${SUPABASE_URL}/rest/v1/rrhh_salarios?id=eq.${liberable!.id}&select=id,gasto_id`,
    { headers },
  )
  const [fila] = (await verif.json()) as Array<{ gasto_id: string | null }>
  expect(
    fila?.gasto_id,
    `[fixtures] se borró el gasto pero rrhh_salarios.gasto_id NO quedó en NULL — el ON DELETE ` +
      `SET NULL no actuó. FRENAR: sin eso el spec generaría un gasto DUPLICADO para el mismo sueldo.`,
  ).toBeNull()
}

/** Lee el total del carrito del POS como número. */
export async function totalDelCarrito(page: Page): Promise<number> {
  const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent()
  const total =
    parseFloat((totalTxt ?? '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
  expect(total, '[fixtures] el total del carrito quedó en 0 — el producto no se agregó').toBeGreaterThan(0)
  return total
}

// ─── Empaque / presentaciones (rediseño UoM Fase 5, mig 310) ────────────────────────────

/**
 * Siembra el ÁRBOL de presentaciones de un producto vía la RPC real `fn_presentaciones_guardar`.
 *
 * Reemplaza al patrón viejo (crear `producto_estructuras` + `fn_estructura_guardar_niveles`):
 * desde la mig 310 `producto_presentaciones` es la FUENTE DE VERDAD del empaque y la RPC vieja
 * quedó sin GRANT a `authenticated` (mig 311). El padre se referencia por índice ANTERIOR del
 * array, así que la cadena no puede tener ciclos.
 *
 * `lineas` describe cada presentación por su equivalencia RESUELTA en unidades base:
 *   [{ etiqueta: 'Caja-12', factor_base: 12, padre_idx: 0 }]
 * La base (factor 1, `padre_idx: null`) se antepone sola si no viene en la lista.
 */
export async function sembrarPresentaciones(
  request: APIRequestContext,
  token: string,
  productoId: string,
  etiquetaBase: string,
  lineas: Array<{ etiqueta: string; factor_base: number; padre_idx?: number | null; nombre_empaque_id?: string | null }>,
): Promise<void> {
  const headers = restHeaders(token)
  const payload = [
    { padre_idx: null, nombre_empaque_id: null, etiqueta: etiquetaBase, factor_base: 1 },
    ...lineas.map(l => ({
      padre_idx: l.padre_idx === undefined ? 0 : l.padre_idx,
      nombre_empaque_id: l.nombre_empaque_id ?? null,
      etiqueta: l.etiqueta,
      factor_base: l.factor_base,
    })),
  ]
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_presentaciones_guardar`, {
    headers,
    data: { p_producto_id: productoId, p_lineas: payload },
  })
  expect(
    res.ok(),
    `[fixtures] fn_presentaciones_guardar falló al sembrar el empaque de ${productoId}: ${await res.text()}`,
  ).toBe(true)
}

/** Presentaciones de un producto, ordenadas por factor (base primero). */
export async function leerPresentaciones(
  request: APIRequestContext,
  token: string,
  productoId: string,
): Promise<Array<{ id: string; etiqueta: string; factor_base: number; es_base: boolean; padre_linea_id: string | null }>> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${productoId}` +
      `&order=factor_base&select=id,etiqueta,factor_base,es_base,padre_linea_id`,
    { headers: restHeaders(token) },
  )
  return (await res.json()) as any
}
