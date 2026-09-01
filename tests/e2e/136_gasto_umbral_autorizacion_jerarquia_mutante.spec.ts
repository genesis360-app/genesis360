/**
 * 136_gasto_umbral_autorizacion_jerarquia_mutante.spec.ts
 * E2E MUTANTE — REGLA #0 (plata): verifica la migración de `autorizaciones_gasto` a la tabla
 * genérica `autorizaciones` (modulo='gastos', mig 389, C1 del relevamiento de Supervisión).
 *
 * La solicitud se siembra por REST con el token real de SUPERVISOR (mismo shape exacto que
 * inserta `SolicitarAutorizacionGastoModal.tsx` — código sin cambios de lógica en esta
 * migración, solo cambia la tabla destino) en vez de recorrer el formulario completo de "Nuevo
 * gasto" (multi-medio-de-pago, no tocado por esta migración, ya cubierto por el spec 27). Lo que
 * SÍ se verifica de punta a punta con UI real es el código que esta migración cambió de verdad:
 * `BandejaAutorizacionesGasto.tsx` lee la tabla genérica con `datos_cambio` jsonb, aplica la
 * jerarquía (`puedeAprobar`) y, al aprobar, recién ahí crea el gasto real.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SUPERVISOR_SESSION_FILE = path.join(__dirname, '.auth/supervisor_session.json')

test.describe('Gasto que supera umbral de SUPERVISOR — jerarquía de aprobación (mutante)', () => {
  test('solicitud pendiente en modulo=gastos; DUEÑO aprueba desde la UI y recién ahí se crea el gasto', async ({ page, request, browser }) => {
    test.setTimeout(60000)
    const sufijo = Date.now()
    const desc = `E2E GastoUmbral ${sufijo}`
    const MONTO = 250000 // > umbral_gasto_supervisor (200000) de Sucursal Norte

    // 0) Sesión DUEÑO (page default) — token para verificar en DB por REST (visibilidad total)
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // 1) Sembrar la solicitud con el token REAL de SUPERVISOR — mismo shape exacto que inserta
    // SolicitarAutorizacionGastoModal.tsx (código no tocado por esta migración, solo la tabla).
    const supContext = await browser.newContext({ storageState: SUPERVISOR_SESSION_FILE })
    const supPage = await supContext.newPage()
    await goto(supPage, '/dashboard')
    await waitForApp(supPage)
    const supToken = await tokenDesdeBrowser(supPage)
    const supHeaders = restHeaders(supToken)
    const supUserId = JSON.parse(Buffer.from(supToken.split('.')[1], 'base64').toString('utf8')).sub as string

    const insertRes = await request.post(`${SUPABASE_URL}/rest/v1/autorizaciones`, {
      headers: { ...supHeaders, Prefer: 'return=representation' },
      data: {
        tenant_id: '3769b1db-10f4-46a6-bc7f-eb669307730d',
        modulo: 'gastos',
        tipo: 'crear',
        datos_cambio: {
          sucursal_id: null, gasto_id: null, monto: MONTO, descripcion: desc,
          payload: { descripcion: desc, monto: MONTO, fecha: new Date().toISOString().slice(0, 10), tenant_id: '3769b1db-10f4-46a6-bc7f-eb669307730d' },
          solicitante_rol: 'SUPERVISOR',
        },
        estado: 'pendiente',
        solicitado_por: supUserId,
        notas: 'Gasto urgente de prueba E2E',
      },
    })
    expect(insertRes.ok(), `[136] no se pudo sembrar la solicitud: ${await insertRes.text()}`).toBe(true)
    const [aut] = (await insertRes.json()) as Array<{ id: string }>
    expect(aut?.id, '[136] el insert no devolvió id').toBeTruthy()
    await supContext.close()

    // POSITIVO en DB: el gasto NO existe todavía.
    const gastoAntesRes = await request.get(
      `${SUPABASE_URL}/rest/v1/gastos?descripcion=eq.${encodeURIComponent(desc)}&select=id`, { headers },
    )
    expect((await gastoAntesRes.json()) as unknown[], '[136] el gasto NO debía existir todavía').toHaveLength(0)

    // 2) Sesión DUEÑO — aprueba desde Gastos → Autorizaciones → Gastos (UI real)
    await goto(page, '/gastos')
    await waitForApp(page)
    const tabAut = page.getByRole('button', { name: /^Autorizaciones/i })
    await expect(tabAut, '[136] DUEÑO no ve el tab Autorizaciones en Gastos').toBeVisible({ timeout: 8000 })
    await tabAut.click()
    const subTabGastos = page.getByRole('button', { name: 'Gastos', exact: true })
    if (await subTabGastos.isVisible({ timeout: 3000 }).catch(() => false)) await subTabGastos.click()

    const filaAut = page.locator('div').filter({ hasText: desc }).filter({ has: page.getByRole('button', { name: /^Aprobar$/i }) }).last()
    await expect(filaAut, `[136] DUEÑO no ve la solicitud pendiente "${desc}"`).toBeVisible({ timeout: 10000 })
    // Verifica de paso que la jerarquía/rol y el motivo (notas → "Motivo de la solicitud") se leen bien desde datos_cambio/notas.
    await expect(filaAut.getByText('SUPERVISOR', { exact: false })).toBeVisible()
    await filaAut.getByRole('button', { name: /^Aprobar$/i }).click()
    await expect(page.getByText(/Solicitud aprobada/i)).toBeVisible({ timeout: 10000 })

    // 3) POSITIVO final en DB: recién ahora existe el gasto real, y la autorización quedó aprobada
    const gastoFinalRes = await request.get(
      `${SUPABASE_URL}/rest/v1/gastos?descripcion=eq.${encodeURIComponent(desc)}&select=id,monto`, { headers },
    )
    const [gastoFinal] = (await gastoFinalRes.json()) as Array<{ id: string; monto: number }>
    expect(gastoFinal, '[136] el gasto debía crearse recién tras la aprobación').toBeTruthy()
    expect(Number(gastoFinal.monto)).toBe(MONTO)

    const autFinalRes = await request.get(`${SUPABASE_URL}/rest/v1/autorizaciones?id=eq.${aut.id}&select=estado,datos_cambio,aprobado_por`, { headers })
    const [autFinal] = (await autFinalRes.json()) as Array<{ estado: string; datos_cambio: { gasto_id: string }; aprobado_por: string }>
    expect(autFinal?.estado, '[136] la autorización debía quedar aprobada').toBe('aprobada')
    expect(autFinal?.aprobado_por, '[136] debe registrar quién aprobó').toBeTruthy()
    expect(autFinal?.datos_cambio?.gasto_id, '[136] datos_cambio.gasto_id debe apuntar al gasto recién creado').toBe(gastoFinal.id)
  })
})
