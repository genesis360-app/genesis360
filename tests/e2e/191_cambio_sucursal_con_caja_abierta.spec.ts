/**
 * 191_cambio_sucursal_con_caja_abierta.spec.ts
 * 🛑 REGLA #0 (contable) — Quien ve todas las sucursales cambia de sucursal con la caja abierta, y el POS ofrece SOLO
 * las cajas de la sucursal activa.
 *
 * Decisión de GO 2026-10-08 (punto L4 revisado): antes, con una caja propia abierta en otra sucursal, el selector de
 * sucursal bloqueaba ("debés cerrarla antes de cambiar de sucursal"). Ahora cambia y avisa. A cambio, el POS listaba las
 * sesiones abiertas de TODAS las sucursales: un cobro podía caer en la caja de otra. Ahora pide solo las de la activa
 * (y la mig 487 lo respalda en la base para los usuarios restringidos).
 *
 * Solo lectura: no se cobra ni se abre/cierra ninguna caja. Corre con OWNER (chromium) contra DEV (Almacén Jorgito).
 */
import { test, expect, type Request } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

const SUR = 'b33a9829-e14d-4962-b55b-3995f614dd87'
const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

// La consulta del POS (VentasPage): sesiones abiertas con la caja embebida (es_caja_fuerte + moneda). Otras consultas de
// caja_sesiones del encabezado (cajas propias, badge) no traen esas columnas.
const esConsultaCajasAbiertas = (r: Request) => {
  const u = decodeURIComponent(r.url()).replace(/\+/g, ' ')
  return r.method() === 'GET' && u.includes('/rest/v1/caja_sesiones') && u.includes('estado=eq.abierta')
    && u.includes('es_caja_fuerte') && u.includes('moneda')
}

test('cambiar de sucursal con caja abierta no bloquea y el POS pide solo las cajas de la sucursal activa', async ({ page, request }) => {
  test.setTimeout(90000)
  await goto(page, '/dashboard')
  await waitForApp(page)
  await page.evaluate((id) => {
    localStorage.setItem('sucursal-id', id)
    for (const k of Object.keys(localStorage)) if (/cart|carrito/i.test(k)) localStorage.removeItem(k)
  }, NORTE)

  // ¿Tiene el dueño una caja propia abierta en Norte? (decide si además se espera el aviso)
  const h = restHeaders(await tokenDesdeBrowser(page))
  const yo = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x))
    return k ? JSON.parse(localStorage.getItem(k)!).user?.id : null
  })
  expect(yo, '[191] no se encontró la sesión del usuario').toBeTruthy()
  const propias = await (await request.get(
    `${SUPABASE_URL}/rest/v1/caja_sesiones?usuario_id=eq.${yo}&estado=eq.abierta&sucursal_id=eq.${NORTE}&select=id`,
    { headers: h })).json() as any[]

  // 1) El POS en Norte pide las cajas abiertas filtradas por Norte.
  const enNorte = page.waitForRequest(esConsultaCajasAbiertas, { timeout: 20000 })
  await goto(page, '/ventas')
  await waitForApp(page)
  const reqNorte = await enNorte
  expect(reqNorte.url(), '[191] el POS tiene que pedir solo las cajas de la sucursal activa (Norte)').toContain(`sucursal_id=eq.${NORTE}`)

  // 2) Cambiar a Sur desde el selector del encabezado: sin el diálogo de bloqueo viejo.
  let dialogoBloqueo = false
  page.on('dialog', d => { dialogoBloqueo = true; void d.dismiss() })
  const enSur = page.waitForRequest(r => esConsultaCajasAbiertas(r) && !r.url().includes(`sucursal_id=eq.${NORTE}`), { timeout: 20000 })
  const selector = page.locator('select[title="Seleccioná una sucursal"]:visible, select[aria-label="Cambiar sucursal"]:visible').first()
  await expect(selector, '[191] no se ve el selector de sucursal').toBeVisible({ timeout: 10000 })
  await selector.selectOption(SUR)

  await expect(page.getByText(/debés cerrarla antes de cambiar de sucursal/i), '[191] volvió el bloqueo L4').toHaveCount(0)
  expect(dialogoBloqueo, '[191] apareció un diálogo al cambiar de sucursal').toBe(false)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sucursal-id')), { timeout: 8000 }).toBe(SUR)
  const reqSur = await enSur
  expect(reqSur.url(), '[191] tras el cambio, el POS tiene que pedir solo las cajas de Sur').toContain(`sucursal_id=eq.${SUR}`)

  // 3) Con una caja propia abierta en Norte, el cambio avisa que sigue abierta.
  if (propias.length > 0) {
    await expect(page.getByText(/sigue abierta en/i).first(), '[191] falta el aviso de la caja que quedó abierta').toBeVisible({ timeout: 8000 })
  }
})
