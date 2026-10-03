/**
 * 175_suscripcion_intento_antiduplicado_mutante.spec.ts
 * E2E MUTANTE — Suscripción: que un pago de plan no quede huérfano ni se duplique (mig 464, REGLA #0 plata).
 *
 * Incidente 2026-09-28: un negocio pagó el plan dos veces con 40 s de diferencia y ninguna suscripción quedó vinculada.
 *  A · La vuelta del checkout con SOLO `preapproval_id` (sin status=approved) muestra la verificación y llama a
 *      mp-verificar-suscripcion con ese id (antes caía en la lista de planes y no verificaba nada).
 *  B · Con un intento sin vincular de hace instantes, "Suscribirme" avisa "Ya iniciaste un pago" y "Volver" no
 *      sale hacia Mercado Pago.
 * MUTANTE: deja una fila en mp_suscripcion_intentos (el usuario no puede borrarla; vence sola a las 2 h para el aviso).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Suscripción — vuelta sin status y freno al doble pago (mig 464)', () => {
  test('A · vuelta solo con preapproval_id → verifica con ese id', async ({ page }) => {
    await page.route('**/functions/v1/mp-verificar-suscripcion', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ activated: false, reason: 'no_autorizado', status: 'pending' }) }))
    const pedido = page.waitForRequest('**/functions/v1/mp-verificar-suscripcion')
    await goto(page, '/suscripcion?preapproval_id=e2e175prueba')
    const req = await pedido
    expect(req.postDataJSON(), '[175A] no se verificó con el preapproval_id de la URL').toEqual({ preapproval_id: 'e2e175prueba' })
    // Pantalla de verificación (no la lista de planes).
    await expect(page.getByRole('button', { name: /Suscribirme/ })).toHaveCount(0)
  })

  test('B · intento reciente sin vincular → "Ya iniciaste un pago" y Volver no paga', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const r = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/registrar_intento_suscripcion`, {
      headers: restHeaders(token), data: { p_plan_tier: 'pro', p_mp_plan_id: 'e2e175-plan' },
    })
    expect(r.ok(), `[175B] no se pudo registrar el intento: ${await r.text()}`).toBe(true)

    let salioAMp = false
    await page.route('**mercadopago.com.ar/**', route => { salioAMp = true; return route.abort() })
    await goto(page, '/suscripcion')
    const boton = page.getByRole('button', { name: /Suscribirme/ }).first()
    await expect(boton, '[175B] no hay botón "Suscribirme" en /suscripcion').toBeVisible({ timeout: 15000 })
    await boton.click()
    await expect(page.getByText('Ya iniciaste un pago')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(page.getByText('Ya iniciaste un pago')).toHaveCount(0)
    expect(salioAMp, '[175B] salió hacia Mercado Pago pese a elegir Volver').toBe(false)
    await expect(page).toHaveURL(/\/suscripcion/)
  })
})
