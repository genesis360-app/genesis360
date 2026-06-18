/**
 * 24_presupuesto_despacho_mutante.spec.ts
 * E2E del modo PRESUPUESTO en el POS (auditoría UAT §22 / PRES).
 *
 * El presupuesto (estado 'pendiente') NO toca stock ni caja, pero — según la regla
 * `clienteObligatorio` del tenant — exige un cliente registrado. Este test valida,
 * de forma determinista y sin depender de datos:
 *   1) el toggle de modo "Presupuesto" es alcanzable (aparece con el carrito cargado),
 *   2) el CTA "Guardar presupuesto" se renderiza y está habilitado,
 *   3) al intentar guardar SIN cliente, el guard de cliente obligatorio dispara su
 *      aviso (no crea el presupuesto a ciegas).
 *
 * El happy-path completo (presupuesto con cliente → conversión a despacho, donde vive
 * el fix PRES-08 de `cambiarEstado`) requiere datos de cliente sembrados y se cubre en
 * el click-through manual (ver tests/specs/uat-modo-basico.md §22).
 *
 * Defensivo: se omite si no hay productos vendibles. Corre con OWNER (proyecto chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Presupuesto en el POS (alcanzabilidad + guard de cliente)', () => {
  test('modo presupuesto: CTA reachable y guard de cliente obligatorio', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito (el panel de checkout — con el toggle de modo —
    //    solo se renderiza con el carrito cargado). Lista o galería, igual que 19_flujo_venta.
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    const hayProducto = await primerProducto.isVisible().catch(() => false)
    test.skip(!hayProducto, 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Cambiar el modo de venta a "Presupuesto" (toggle del POS, ya visible con carrito)
    const togglePresupuesto = page.getByRole('button', { name: 'Presupuesto', exact: true }).first()
    await expect(togglePresupuesto).toBeVisible({ timeout: 8000 })
    await togglePresupuesto.click()

    // 3) El CTA "Guardar presupuesto" se renderiza y está habilitado (alcanzabilidad)
    const guardar = page.getByRole('button', { name: /^Guardar presupuesto$/ }).last()
    await expect(guardar).toBeVisible({ timeout: 5000 })
    await expect(guardar).toBeEnabled()

    // 4) Guard de cliente obligatorio: guardar sin cliente NO crea el presupuesto a ciegas,
    //    dispara el aviso. (react-hot-toast → role="status")
    await guardar.click()
    const toast = page.locator('[role="status"]').filter({ hasText: /cliente/i }).first()
    await expect(toast).toBeVisible({ timeout: 6000 })

    // 5) El carrito sigue intacto (no se guardó nada sin cliente)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
