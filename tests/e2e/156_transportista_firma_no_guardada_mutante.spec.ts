/**
 * 156 — UAT 56.7: si la firma del receptor NO se guarda, la pantalla del transportista AVISA
 * (mutante).
 *
 * El escenario figuraba como "✅ código — sin e2e": estaba verificado leyendo `TransportistePage`,
 * nunca ejecutado. Es justo el que importa, porque el bug que arregló esa rama era **silencioso**:
 * la firma fallaba al subir, la entrega se confirmaba igual y nadie se enteraba de que el POD había
 * quedado sin firma (`subirFirma()` → `catch` → `toast.error('La firma no se guardó: …')`).
 *
 * ─── Por qué este spec no escribe NADA en la base ──────────────────────────────────────────────
 * La firma no es requerida por defecto (`tenants.pod_campos_requeridos.firma = false`), así que el
 * pad ni se renderiza. La primera versión de este spec lo activaba con un PATCH a `tenants` y lo
 * revertía en `finally`… pero cuando el test se pasó del timeout, Playwright cerró el contexto ANTES
 * del revert y **`Almacén Jorgito` quedó con `firma: true`** — config compartida por toda la suite,
 * que hace que cualquier otro spec que marque un envío como entregado empiece a exigir firma.
 *
 * Ahora se intercepta la RPC `get_envio_by_token` y se le cambia la config **en la respuesta**, o sea
 * solo dentro de este navegador: la base no se toca, no hay nada que revertir y ningún fallo puede
 * dejar residuo. Misma idea para el fallo de la firma y para frenar el cambio de estado:
 *   · `transportista-subir-archivo` falla SOLO cuando el multipart es de `tipo=firma` (si se cortara
 *     todo, no se sabría cuál de las dos subidas disparó el aviso).
 *   · `update_envio_by_token` se bloquea para que el envío NO cambie de estado. Es seguro y
 *     suficiente: en `avanzarEstado()` la firma se sube en la línea 164 y la RPC recién se llama en
 *     la 177, así que cuando la RPC se bloquea el aviso de la firma YA se mostró.
 *
 * 🛑 Contexto SIN sesión, como el 4º caso del spec 148: el transportista real entra por su link sin
 * login, y con el `storageState` del DUEÑO el test daría un falso verde.
 *
 * Mutante: si `subirFirma()` volviera a tragarse el error (sin el `catch` que avisa), el toast no
 * aparece y este test falla donde debe.
 */
import { test, expect } from '@playwright/test'
import { loginToken, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Transportista — la firma que no se guarda avisa (mutante)', () => {
  test('falla la subida de la firma → la pantalla lo dice y no queda en silencio (56.7)', async ({ browser, request }) => {
    test.setTimeout(120000)
    const owner = await loginToken(request)
    const headers = restHeaders(owner)

    // Un envío abierto con token y sin pago pendiente (si no, `avanzarEstado` corta antes de la firma).
    const envios = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?select=id,token_transportista,costo_cotizado,costo_pagado,estado` +
        `&token_transportista=not.is.null&estado=in.(pendiente,despachado,en_camino)&limit=20`,
      { headers },
    )).json()) as Array<{ id: string; token_transportista: string; costo_cotizado: number | null; costo_pagado: boolean | null; estado: string }>
    const envio = envios.find(e => !(Number(e.costo_cotizado ?? 0) > 0 && !e.costo_pagado))
    expect(
      envio,
      '[156] fixture: hace falta un envío abierto con token de transportista y sin pago pendiente',
    ).toBeTruthy()

    const contexto = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    })
    const page = await contexto.newPage()

    try {
      // ── La firma pasa a ser requerida SOLO en esta pestaña (la base no se toca) ──
      // El OTP se apaga por el mismo camino: su chequeo corta ANTES de subir la firma, así que con
      // OTP pendiente nunca llegaríamos al caso bajo prueba.
      await page.route('**/rest/v1/rpc/get_envio_by_token', async route => {
        const respuesta = await route.fetch()
        const cuerpo = await respuesta.json()
        if (cuerpo && typeof cuerpo === 'object') {
          cuerpo.pod_campos_requeridos = { ...(cuerpo.pod_campos_requeridos ?? {}), firma: true }
          cuerpo.pod_otp_umbral = 0
        }
        await route.fulfill({ response: respuesta, json: cuerpo })
      })

      // ── La firma NO se puede subir (y solo la firma) ──
      let intentosFirma = 0
      await page.route('**/functions/v1/transportista-subir-archivo', async route => {
        const cuerpo = route.request().postData() ?? ''
        if (cuerpo.includes('firma')) {
          intentosFirma++
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'storage caído (e2e)' }) })
        } else {
          await route.continue()
        }
      })

      // ── Y el envío no cambia de estado: la RPC nunca llega a aplicarse ──
      await page.route('**/rest/v1/rpc/update_envio_by_token', route =>
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'bloqueado por el e2e' }) }),
      )

      await page.goto(`/transporte/${envio!.token_transportista}`)
      await expect(page.getByText('Comprobante de entrega (POD)')).toBeVisible({ timeout: 15000 })

      // Receptor (requerido). El placeholder real es "Ej: Juan García" — buscarlo por /receptor/
      // colgaba el fill hasta el timeout sin decir por qué.
      await page.getByPlaceholder('Ej: Juan García').first().fill('E2E Receptor')

      // Dibujar la firma en el canvas (pointer events) y confirmarla.
      const canvas = page.locator('canvas').first()
      await expect(canvas, '[156] no apareció el pad de firma pese a pedirla requerida').toBeVisible({ timeout: 10000 })
      // 🛑 `toBeVisible()` NO garantiza que esté DENTRO DEL VIEWPORT (solo que tiene caja y no está
      // oculto). El pad queda más abajo de lo que entra en pantalla, así que sin este scroll el
      // `boundingBox()` devuelve coordenadas fuera de vista, el `mouse.down()` cae en cualquier lado y
      // el trazo nunca llega al canvas: el botón "Confirmar firma" se queda deshabilitado para siempre.
      await canvas.scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)   // el scroll de la página es suave: dejarlo asentar
      const caja = await canvas.boundingBox()   // recalcular DESPUÉS del scroll, no antes
      expect(caja, '[156] el canvas de la firma no tiene caja visible').toBeTruthy()
      await page.mouse.move(caja!.x + 30, caja!.y + caja!.height / 2)
      await page.mouse.down()
      await page.mouse.move(caja!.x + caja!.width * 0.4, caja!.y + 30, { steps: 8 })
      await page.mouse.move(caja!.x + caja!.width * 0.7, caja!.y + caja!.height - 25, { steps: 8 })
      await page.mouse.up()

      // El botón arranca deshabilitado y solo se habilita si el trazo realmente quedó dibujado:
      // esperar a que se habilite es la prueba de que el pad registró el dibujo.
      const confirmarFirma = page.getByRole('button', { name: /Confirmar firma/ })
      await expect(confirmarFirma, '[156] el trazo no se registró en el canvas (el botón sigue deshabilitado)').toBeEnabled({ timeout: 5000 })
      await confirmarFirma.click()
      await expect(page.getByRole('button', { name: /Firma lista/ }), '[156] la firma no quedó confirmada').toBeVisible()

      // Confirmar la entrega → intenta subir la firma → falla → TIENE que avisar.
      await page.getByRole('button', { name: /^Entregado$/ }).first().click()

      await expect(
        page.getByRole('status').filter({ hasText: /La firma no se guardó/ }),
        '🛑 [156] la firma falló y la pantalla NO avisó: vuelve a fallar en silencio (ese era el bug)',
      ).toBeVisible({ timeout: 20000 })
      expect(intentosFirma, '[156] el test no llegó a intentar subir la firma').toBeGreaterThan(0)
    } finally {
      await contexto.close()
    }

    // POSITIVO: el envío NO quedó entregado (la RPC estaba bloqueada) y sigue sin firma.
    const [despues] = (await (await request.get(
      `${SUPABASE_URL}/rest/v1/envios?id=eq.${envio!.id}&select=estado,pod_firma_url`, { headers },
    )).json()) as Array<{ estado: string; pod_firma_url: string | null }>
    expect(despues.estado, '🛑 [156] el test entregó un envío real: la RPC tenía que quedar bloqueada').toBe(envio!.estado)
  })
})
