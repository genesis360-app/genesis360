/**
 * 76_wall_to_wall_bloqueante_mutante.spec.ts
 * E2E MUTANTE — Conteo wall-to-wall bloqueante frena el POS de la sucursal (REGLA #0, stock).
 *
 * A2 (`useConteoBloqueante` + `VentasPage.registrarVenta` ~2357): mientras hay un conteo `borrador` con
 * `bloquea_movimientos=true` en la sucursal, NO se pueden reservar ni despachar ventas (mueven stock) →
 * protege la integridad del conteo full. El guard también aplica en Inventario (rebaje/ingreso) y
 * Traslados; este e2e valida la pata POS (la más expuesta).
 *
 * Fixture SQL (DEV, Almacén Jorgito, Sucursal Norte): un `inventario_conteos` borrador con
 * `bloquea_movimientos=true`. Se intenta una "Venta directa" → bloqueada. NO muta (el guard corta antes
 * de crear la venta). El conteo bloqueante se BORRA tras el test (un bloqueo activo NO es evidencia: deja
 * la sucursal sin operar).
 *
 * GATE: E2E_WALL_TO_WALL=1. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'

test.describe('Conteo wall-to-wall bloquea el POS (mutante)', () => {
  test.skip(process.env.E2E_WALL_TO_WALL !== '1', 'Fixture conteo bloqueante no sembrado (E2E_WALL_TO_WALL!=1).')

  test('con conteo wall-to-wall en curso → la venta directa se bloquea', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/ventas')
    await waitForApp(page)

    // Agregar un producto
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'No hay productos vendibles')
    await prod.click()
    await page.waitForTimeout(500)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Modo "Venta directa" (despachada mueve stock → bloqueado)
    await page.getByRole('button', { name: /^Venta directa$/ }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /^Venta directa$/ }).last().click()

    // POSITIVO: el guard del conteo wall-to-wall bloquea
    await expect(page.getByText(/conteo wall-to-wall en curso/i)).toBeVisible({ timeout: 8000 })
    // No mutación: el carrito sigue
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible()
  })
})
