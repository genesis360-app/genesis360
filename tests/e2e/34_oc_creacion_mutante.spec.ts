/**
 * 34_oc_creacion_mutante.spec.ts
 * E2E MUTANTE — Creación de Orden de Compra por UI (REGLA #0, compras → stock futuro).
 *
 * Crea una OC con 1 ítem (proveedor + producto + cantidad). Al guardar, `saveOC` inserta
 * `ordenes_compra` (borrador) + `orden_compra_items`. Aserción POSITIVA (toast "OC creada");
 * la fila en DB (OC borrador + ítem con cantidad/precio) se verifica aparte con execute_sql.
 *
 * Producto simple (Elite Pañuelos, sin lote/venc/series). Proveedor Mayorista MAX.
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito, avanzado).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'Mayorista MAX'
const PRODUCTO_OPT = 'Elite Pañuelos (SKU-0001)' // texto exacto de la opción "{nombre} ({sku})"

test.describe('Creación de OC (mutante)', () => {
  test('crear OC con un ítem → queda registrada en borrador', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)

    // Tab Órdenes de compra
    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.waitForTimeout(500)

    // Nueva OC
    await page.getByRole('button', { name: /Nueva OC/i }).click()
    await expect(page.getByRole('heading', { name: /Nueva orden de compra/i })).toBeVisible({ timeout: 5000 })

    // Proveedor
    const provSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un proveedor/i }) }).first()
    await provSel.selectOption({ label: PROVEEDOR })
    await page.waitForTimeout(300)

    // El form ya arranca con una línea de producto vacía (openNewOC) → NO agregar otra.
    // Producto (select de la línea, identificado por su opción "Seleccioná producto…")
    const prodSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná producto/i }) }).first()
    await prodSel.selectOption({ label: PRODUCTO_OPT })
    await page.waitForTimeout(300)

    // Cantidad = 5 (el precio unitario se autocompleta con el costo)
    await page.getByPlaceholder(/^Cant\./).first().fill('5')
    await page.waitForTimeout(200)

    // Guardar
    await page.getByRole('button', { name: /Guardar OC/i }).click()

    // POSITIVO: toast "OC creada" + el modal se cierra
    await expect(page.getByText(/OC creada/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /Nueva orden de compra/i })).not.toBeVisible({ timeout: 5000 })
  })
})
