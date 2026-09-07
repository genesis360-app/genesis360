/**
 * 142_resiliencia_backend_degradado.spec.ts
 * E2E — **Tanda D, escenarios D2 a D5**: cómo se comporta la app cuando el backend NO está sano.
 *
 * Por qué existe: hasta el 2026-09-06 las 142 specs e2e eran **todas funcionales** y corrían siempre
 * contra un backend sano. Verificado con grep: ninguna usaba `page.route`, `setOffline` ni
 * `page.clock`. Un bug que solo aparece cuando el backend falla era, por construcción, invisible —
 * y así se nos escapó D1 (el bucle de reintentos de sesión que tumbó la base de DEV).
 *
 * Estos tests **no necesitan romper el backend de verdad**: interceptan la red del browser, así que
 * son deterministas, no le agregan carga a DEV y no dependen de que algo esté caído.
 *
 * Foto de datos: cualquier tenant con sesión de DUEÑO (proyecto `chromium`). No mutan nada.
 *
 * ── Números MEDIDOS el 2026-09-06 (calibración: se corrió con los presupuestos en 0 para ver el
 * valor real, y así saber que el techo no está tan holgado que no detecte nada) ──
 *   D3 · 30 s quieto con el backend devolviendo 503 →  **0** requests   (techo 20)
 *   D4 · offline forzando revalidación             →  **0** requests   (techo  5)
 *   D5 · al despertar la pestaña                   → **14** requests   (techo 60)
 *
 * O sea: la app se porta BIEN en condiciones degradadas. El caso anómalo era D1, y estaba en
 * auth-js, no en la capa de React Query. Estos techos son barandas anti-regresión, no descripciones
 * de un problema: si alguien saca el `retry: 1` global, cambia el `networkMode` o mete un
 * `refetchInterval` agresivo, saltan acá.
 *
 * ⚠ Todos los presupuestos vienen con un control **anti-falso-verde** (`toBeGreaterThan(0)`): sin
 * eso un intercept mal escrito hace pasar el test por vacío. Pasó de verdad mientras se escribía
 * esta spec — D4 daba verde con 0 requests fallidas porque, con la pantalla quieta, la app no pide
 * nada y el corte de red no ejercitaba nada.
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

/** Endpoint del refresco de sesión — el que en D1 se reintentaba sin freno. */
const REFRESCO = '**/auth/v1/token?grant_type=refresh_token*'
/** Cualquier consulta de datos (PostgREST). */
const DATOS = '**/rest/v1/**'

/** Marca la sesión guardada como ya vencida, para forzar el refresco al cargar. */
async function vencerSesionGuardada(page: Page) {
  await page.addInitScript(() => {
    try {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))
      if (!key) return
      const raw = localStorage.getItem(key)
      if (!raw) return
      const ses = JSON.parse(raw)
      ses.expires_at = Math.floor(Date.now() / 1000) - 3600      // venció hace una hora
      ses.expires_in = 0
      localStorage.setItem(key, JSON.stringify(ses))
    } catch { /* si no hay sesión guardada, el test lo detecta igual */ }
  })
}

test.describe('Tanda D — la app con el backend degradado', () => {
  /**
   * D2 — sesión vencida con la pestaña abierta.
   * El refresh token ya no sirve (400 `invalid_grant`, respuesta DEFINITIVA del servidor, distinta
   * de un 5xx transitorio). Tiene que terminar en login limpio, y sobre todo **no** quedarse
   * martillando: es el modo de falla que originó toda esta tanda.
   */
  test('D2 — sesión vencida: termina en login limpio y sin bucle de reintentos', async ({ page }) => {
    test.setTimeout(90_000)
    let intentosRefresco = 0

    await page.route(REFRESCO, async (route) => {
      intentosRefresco++
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
      })
    })

    await vencerSesionGuardada(page)
    await goto(page, '/dashboard')

    // La app tiene que llevarnos a login por su cuenta.
    await expect(page, '[142/D2] con la sesión vencida la app debe caer en /login, no quedarse colgada')
      .toHaveURL(/\/login/, { timeout: 30_000 })

    // ⚠ Control ANTI-FALSO-VERDE: si el intercept nunca se activó, todos los presupuestos de abajo
    // se cumplen por vacío y el test no prueba nada.
    expect(intentosRefresco,
      '[142/D2] el intercept del refresco nunca se activó — el test estaría pasando por vacío',
    ).toBeGreaterThan(0)

    // Y quedarse quieta: un 400 es definitivo, reintentarlo no puede arreglar nada.
    const alLlegar = intentosRefresco
    await page.waitForTimeout(20_000)
    const despues = intentosRefresco

    expect(despues - alLlegar,
      `[142/D2] tras caer en login siguió pidiendo refrescos (${despues - alLlegar} en 20 s) — un 400 invalid_grant es definitivo`,
    ).toBeLessThanOrEqual(1)
    expect(despues,
      `[142/D2] demasiados intentos de refresco en total (${despues}) para una respuesta definitiva del servidor`,
    ).toBeLessThanOrEqual(6)
  })

  /**
   * D3 — el backend empieza a devolver 5xx mientras el usuario trabaja.
   * Lo importante NO es que la pantalla se vea linda: es que la app **no martille**. D1 nos enseñó
   * que la app puede amplificar la caída que la está rompiendo.
   */
  test('D3 — 5xx sostenido en las consultas: la app no martilla al backend caído', async ({ page }) => {
    test.setTimeout(120_000)

    // 1) Arranca sana, para que la sesión y el tenant carguen bien.
    await goto(page, '/dashboard')
    await waitForApp(page)

    // 2) Ahora el backend se cae para TODAS las consultas de datos.
    let requestsDatos = 0
    await page.route(DATOS, async (route) => {
      requestsDatos++
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Service Unavailable (simulado por el test)' }),
      })
    })

    // 3) El usuario sigue navegando, como haría de verdad.
    await goto(page, '/productos')
    await page.waitForTimeout(5_000)
    const trasNavegar = requestsDatos
    expect(trasNavegar,
      '[142/D3] el intercept de /rest/v1 nunca se activó — el presupuesto de abajo pasaría por vacío',
    ).toBeGreaterThan(0)

    // 4) Y se queda un rato en la pantalla rota.
    await page.waitForTimeout(30_000)
    const enReposo = requestsDatos - trasNavegar

    // Presupuesto: con `retry: 1` global y algunos `refetchInterval` de 30-120 s, una pantalla
    // quieta 30 s no debería generar decenas de requests. Si esto se dispara, la app está
    // amplificando la caída igual que en D1.
    expect(enReposo,
      `[142/D3] con el backend caído la app hizo ${enReposo} requests en 30 s de pantalla quieta — está martillando`,
    ).toBeLessThanOrEqual(20)

    // Y no puede quedar en blanco fingiendo que todo está bien: algo tiene que verse en pantalla.
    await expect(page.locator('body'), '[142/D3] la pantalla quedó vacía con el backend caído')
      .not.toHaveText(/^\s*$/)
  })

  /**
   * D4 — red intermitente: se corta y vuelve.
   * Lo crítico es que al reconectar la app se recupere **sola**, sin obligar a recargar y sin
   * duplicar nada.
   */
  test('D4 — red intermitente: no martilla sin red y se recupera SOLA al volver', async ({ page, context }) => {
    test.setTimeout(120_000)

    await goto(page, '/productos')
    await waitForApp(page)

    // Contador de consultas de datos reales (no se interceptan: se dejan pasar).
    let requests = 0
    const contar = (req: { url(): string }) => { if (req.url().includes('/rest/v1/')) requests++ }
    page.on('request', contar)

    // ── Sin red ──────────────────────────────────────────────────────────────────────────────
    await context.setOffline(true)
    requests = 0
    // Se fuerza actividad real (volver a la pestaña dispara la revalidación de React Query).
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
      })
      await page.waitForTimeout(4_000)
    }
    const sinRed = requests

    // HALLAZGO (medido acá): React Query usa `networkMode: 'online'` por default, así que con el
    // navegador offline **pausa** las queries en vez de dispararlas y verlas fallar. Por eso sin red
    // la app no genera tráfico. Es el comportamiento correcto — y es exactamente lo contrario de lo
    // que hacía auth-js en D1. Se afirma como propiedad para que nadie lo rompa cambiando
    // `networkMode` sin darse cuenta.
    expect(sinRed,
      `[142/D4] sin conexión la app generó ${sinRed} requests — debería pausar, no martillar (React Query networkMode 'online')`,
    ).toBeLessThanOrEqual(5)

    // ── Vuelve la red ────────────────────────────────────────────────────────────────────────
    await context.setOffline(false)
    requests = 0
    // A propósito NO se navega ni se recarga: la gracia es que se recupere sola.
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await page.waitForTimeout(10_000)
    const alVolver = requests
    page.off('request', contar)

    expect(alVolver,
      '[142/D4] al volver la conexión la app no pidió datos: no se recupera sola, el usuario tendría que recargar',
    ).toBeGreaterThan(0)

    // Y sigue usable, sin haber expulsado al usuario por un corte de red.
    await expect(page.locator('body'), '[142/D4] la app no se recuperó al volver la conexión')
      .not.toHaveText(/^\s*$/)
    expect(page.url(), '[142/D4] un corte de red no debe expulsar al usuario a login')
      .not.toMatch(/\/login/)
  })

  /**
   * D5 — pestaña dormida y reanudada.
   * El caso REAL del incidente: una pestaña abierta desde hacía días. Al volver a primer plano, la
   * app revalida — y eso no puede convertirse en una tormenta de requests.
   */
  test('D5 — pestaña dormida y reanudada: al despertar revalida sin tormenta de requests', async ({ page }) => {
    test.setTimeout(120_000)

    await goto(page, '/dashboard')
    await waitForApp(page)

    let requests = 0
    await page.route(DATOS, async (route) => { requests++; await route.continue() })

    // Dormir la pestaña: `visibilityState` no se puede setear desde Playwright, así que se
    // sobrescribe el getter y se despacha el evento, que es lo que escuchan React Query y auth-js.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true })
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(20_000)
    const dormida = requests

    // Despertar.
    requests = 0
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await page.waitForTimeout(15_000)
    const alDespertar = requests

    // Revalidar al volver ES el comportamiento correcto (`refetchOnWindowFocus: true`), así que
    // esto también es el control anti-falso-verde: si al despertar no pidiera NADA, o el intercept
    // no se activó, o la app no está revalidando y el usuario ve datos viejos.
    expect(alDespertar,
      '[142/D5] al despertar la pestaña no se pidió ningún dato — o el intercept no se activó, o la app no revalida',
    ).toBeGreaterThan(0)

    // Lo que no puede pasar es que despertar dispare una avalancha.
    expect(alDespertar,
      `[142/D5] al despertar la pestaña se dispararon ${alDespertar} requests — revalidar está bien, una tormenta no`,
    ).toBeLessThanOrEqual(60)
    expect(dormida,
      `[142/D5] con la pestaña dormida siguió pidiendo datos (${dormida} en 20 s)`,
    ).toBeLessThanOrEqual(30)
  })
})
