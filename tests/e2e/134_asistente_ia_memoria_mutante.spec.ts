/**
 * 134_asistente_ia_memoria_mutante.spec.ts
 * E2E MUTANTE — Plan IA, Fase 3 (memoria persistente por tenant, mig 377). Verifica de punta a
 * punta el flujo real: el Asistente IA (Groq real, sin mockear) propone guardar un hecho cuando
 * el usuario lo pide explícitamente ("Recordá que...") → tarjeta de confirmación en el chat →
 * Confirmar llama a `fn_ai_memoria_guardar` con la sesión real del DUEÑO → el hecho aparece en
 * Configuración → Mi negocio → "Memoria del Asistente IA" y se puede borrar desde ahí.
 *
 * También cubre el camino de Rechazar: la propuesta NO debe dejar fila en `ai_tenant_memoria`.
 *
 * Marca cada hecho con un sufijo único (timestamp) para poder ubicarlo sin ambigüedad entre
 * corridas y dejar el tenant de prueba limpio al final (borra por UI, no solo verifica).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Plan IA, Fase 3 — memoria del negocio (mutante)', () => {
  test('confirmar guarda el hecho real (DB + Config); rechazar no deja rastro', async ({ page, request }) => {
    test.setTimeout(180000)
    const sufijo = Date.now()
    const hechoConfirmar = `E2E-${sufijo} vende indumentaria femenina al por mayor y menor`
    const hechoRechazar = `E2E-${sufijo}-rechazado usa modo básico sin WMS`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // ── Abrir el Asistente IA ───────────────────────────────────────────────────────────
    await page.getByTitle('Asistente IA').click()
    const chatInput = page.getByPlaceholder('Escribí tu consulta...')
    await expect(chatInput).toBeVisible({ timeout: 8000 })
    const cardMemoria = page.getByText('Guardar en la memoria del negocio')

    // El modelo (Groq real, no mockeado) puede a veces preguntar en TEXTO antes de llamar a la
    // herramienta pese al "Recordá que..." explícito (rule 8, "preguntá antes de asumir", puede
    // ganarle a la excepción de rule 10) — no es un bug, es el mismo doble-chequeo que un humano
    // haría. El test tolera ambos caminos: espera la tarjeta y, si no aparece, reafirma una vez.
    const enviarYEsperarPropuesta = async (texto: string) => {
      await chatInput.fill(texto)
      await chatInput.press('Enter')
      const aparecioDirecto = await cardMemoria.last().waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false)
      if (aparecioDirecto) return
      await chatInput.fill('Sí, quiero que lo guardes en la memoria del negocio ahora.')
      await chatInput.press('Enter')
      await expect(
        cardMemoria.last(),
        '[134] el asistente no propuso guardar el hecho ni siquiera tras reafirmar (¿Groq no llamó a "guardar_hecho_memoria"? revisar el prompt/tool)',
      ).toBeVisible({ timeout: 25000 })
    }

    // ── Camino CONFIRMAR ─────────────────────────────────────────────────────────────────
    await enviarYEsperarPropuesta(`Recordá que ${hechoConfirmar}.`)

    const propuestaConfirmar = page.locator('div').filter({ hasText: hechoConfirmar }).last()
    await propuestaConfirmar.getByRole('button', { name: 'Confirmar' }).click()
    await expect(propuestaConfirmar.getByText('Guardado')).toBeVisible({ timeout: 10000 })

    // POSITIVO en DB: la RPC (mig 377) escribió la fila real con la sesión del DUEÑO.
    // ⚠ "Guardado" en el chat es optimista (el estado pasa a 'confirmada' ANTES de awaitear la
    // RPC, mismo patrón que confirmarPropuesta de Fase 2) — leer inmediato corre la carrera
    // contra el round-trip real a Supabase. `expect.poll` en vez de una lectura única.
    const urlConfirmadas = `${SUPABASE_URL}/rest/v1/ai_tenant_memoria?hecho=ilike.*${sufijo}*&hecho=not.ilike.*rechazado*&select=id,hecho`
    await expect
      .poll(
        async () => {
          const res = await request.get(urlConfirmadas, { headers })
          return res.ok() ? ((await res.json()) as unknown[]).length : -1
        },
        { timeout: 10000, message: '[134] "Confirmar" no dejó ninguna fila en ai_tenant_memoria' },
      )
      .toBe(1)
    const resConfirmado = await request.get(urlConfirmadas, { headers })
    const idGuardado = ((await resConfirmado.json()) as Array<{ id: string; hecho: string }>)[0].id

    // ── Camino RECHAZAR ──────────────────────────────────────────────────────────────────
    await enviarYEsperarPropuesta(`Recordá que ${hechoRechazar}.`)

    const propuestaRechazar = page.locator('div').filter({ hasText: hechoRechazar }).last()
    await propuestaRechazar.getByRole('button', { name: 'Rechazar' }).click()
    await expect(propuestaRechazar.getByText('Rechazada — sin guardar.')).toBeVisible({ timeout: 5000 })

    // POSITIVO en DB: rechazar NUNCA llamó a la RPC — cero filas con este segundo hecho.
    const resRechazado = await request.get(
      `${SUPABASE_URL}/rest/v1/ai_tenant_memoria?hecho=ilike.*rechazado*&select=id`,
      { headers },
    )
    expect(((await resRechazado.json()) as unknown[]).length, '[134] "Rechazar" guardó una fila igual — NO debería llamar a la RPC').toBe(0)

    // ── Configuración → Mi negocio → "Memoria del Asistente IA" ─────────────────────────
    await goto(page, '/configuracion')
    await waitForApp(page)
    await page.getByText('Memoria del Asistente IA').click()

    const filaEnConfig = page.getByText(hechoConfirmar, { exact: false }).first()
    await expect(
      filaEnConfig,
      '[134] el hecho confirmado no aparece en Configuración → Memoria del Asistente IA',
    ).toBeVisible({ timeout: 10000 })

    // Borrar desde la UI (icono tacho) — verifica el flujo de borrado real, no solo un DELETE
    // por API. Ojo: `locator('div').filter({hasText}).last()` matchea el div ENVOLVENTE más
    // profundo por texto (el que solo tiene los <p>, no el botón hermano) — escopear por la
    // clase real de la FILA (única en la sección) evita ese error documentado.
    const filaContenedora = page.locator('div.flex.items-start.justify-between').filter({ hasText: hechoConfirmar })
    await expect(filaContenedora).toHaveCount(1)
    await filaContenedora.getByTitle('Borrar').click()
    await expect(filaEnConfig).not.toBeVisible({ timeout: 8000 })

    // POSITIVO en DB: el borrado por UI (RLS DELETE, mig 377) realmente sacó la fila.
    const resBorrado = await request.get(
      `${SUPABASE_URL}/rest/v1/ai_tenant_memoria?id=eq.${idGuardado}&select=id`,
      { headers },
    )
    expect(((await resBorrado.json()) as unknown[]).length, '[134] la fila sigue en la DB tras borrarla desde Configuración').toBe(0)
  })
})
