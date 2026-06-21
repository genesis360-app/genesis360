/**
 * 33_devolucion_proveedor_mutante.spec.ts
 * E2E MUTANTE — Devolución a proveedor con crédito en CC (REGLA #0, plata + stock).
 *
 * Devolver mercadería de una OC recibida (CO4, `confirmarDevolucion` en ProveedoresPage) debe:
 *   - rebajar el stock FIFO del producto en la sucursal de la OC (`inventario_lineas` ↓ +
 *     movimiento `ajuste_rebaje`),
 *   - con forma "Crédito en CC": insertar una `nota_credito` negativa en
 *     `proveedor_cc_movimientos` (la deuda con el proveedor se reduce / queda crédito a favor),
 *   - registrar la `devoluciones_proveedor` 'confirmada' + sus ítems.
 *
 * Aserción POSITIVA (toast "Devolución #N registrada — crédito en CC"). Las mutaciones (stock ↓,
 * nota de crédito en CC) se verifican aparte con execute_sql.
 *
 * Usa OC recibida del proveedor "Mayorista MAX" (Coca Cola 1.5L, sucursal Norte con stock amplio).
 * Devuelve 1 unidad. Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'Mayorista MAX'

test.describe('Devolución a proveedor (mutante)', () => {
  test('devolver 1 unidad con crédito en CC → rebaja stock + nota de crédito', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)

    // Tab Órdenes de compra
    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.waitForTimeout(600)

    // Filtrar por el proveedor (deja solo sus OCs)
    const provFilter = page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los proveedores/i }) }).first()
    await provFilter.selectOption({ label: PROVEEDOR })
    await page.waitForTimeout(600)

    // Abrir el detalle de la OC que tenga "Devolver a proveedor" (la recibida)
    const verDetalle = page.getByRole('button', { name: /Ver detalle/i })
    const total = await verDetalle.count()
    test.skip(total === 0, `Sin OCs visibles para ${PROVEEDOR}`)
    let abierto = false
    for (let i = 0; i < total; i++) {
      await verDetalle.nth(i).click()
      await page.waitForTimeout(500)
      const devolverBtn = page.getByRole('button', { name: /Devolver a proveedor/i })
      if (await devolverBtn.isVisible().catch(() => false)) {
        await devolverBtn.click()
        abierto = true
        break
      }
      // No es la recibida → cerrar el detalle y probar la siguiente
      await page.getByRole('button', { name: /^Cerrar$/ }).first().click()
      await page.waitForTimeout(300)
    }
    test.skip(!abierto, `Ninguna OC de ${PROVEEDOR} está recibida (devolver no disponible)`)

    // Modal de devolución (aserción positiva)
    await expect(page.getByRole('heading', { name: /Devolver a proveedor — OC/i })).toBeVisible({ timeout: 5000 })

    // Cantidad a devolver = 1 (primer/único ítem)
    await page.locator('xpath=//label[contains(.,"Productos y cantidad a devolver")]/following::input[1]').fill('1')

    // Motivo
    await page.locator('xpath=//label[contains(.,"Motivo")]/following::select[1]').selectOption({ label: 'Producto roto / dañado' })

    // Forma = Crédito en CC (default, explícito)
    await page.getByRole('button', { name: /^Crédito en CC$/ }).click()

    // Confirmar
    await page.getByRole('button', { name: /Confirmar devolución/i }).click()

    // POSITIVO: toast de devolución con crédito en CC + sin error de stock
    await expect(page.getByText(/Devolución #\d+ registrada — crédito en CC/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/No hay stock suficiente/i)).not.toBeVisible()
  })
})
