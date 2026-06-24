/**
 * 78_devolucion_proveedor_reposicion_mutante.spec.ts
 * E2E MUTANTE — Devolución a proveedor forma REPOSICIÓN → crea OC borrador + rebaja stock (REGLA #0, stock).
 *
 * Complementa specs 33 (credito_cc) y 77 (efectivo). Con forma "Reposición"
 * (`ProveedoresPage.confirmarDevolucion`, L1251-1262) la devolución crea una NUEVA `ordenes_compra`
 * 'borrador' con los ítems devueltos (para que el proveedor reponga la mercadería), además de la rebaja
 * de stock FIFO (`inventario_lineas` ↓ + movimiento `ajuste_rebaje`) y el registro
 * `devoluciones_proveedor` 'confirmada' con `oc_reposicion_id` apuntando a la OC nueva.
 *
 * Aserción POSITIVA (toast "Devolución #N registrada — reposición (OC nueva)"); la OC borrador nueva +
 * la rebaja de stock se verifican aparte con execute_sql. MUTANTE (rebaja stock + crea OC; queda como
 * evidencia UAT). GATE: E2E_DEVOL_REPOSICION=1. OWNER (chromium) contra DEV (Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'Mayorista MAX'

test.describe('Devolución a proveedor — reposición (mutante)', () => {
  test.skip(process.env.E2E_DEVOL_REPOSICION !== '1', 'Mutante de stock + crea OC (E2E_DEVOL_REPOSICION!=1).')

  test('devolver 1 unidad con reposición → crea OC borrador + rebaja stock', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)

    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.waitForTimeout(600)

    const provFilter = page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los proveedores/i }) }).first()
    await provFilter.selectOption({ label: PROVEEDOR })
    await page.waitForTimeout(600)

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
      await page.getByRole('button', { name: /^Cerrar$/ }).first().click()
      await page.waitForTimeout(300)
    }
    test.skip(!abierto, `Ninguna OC de ${PROVEEDOR} está recibida (devolver no disponible)`)

    await expect(page.getByRole('heading', { name: /Devolver a proveedor — OC/i })).toBeVisible({ timeout: 5000 })

    await page.locator('xpath=//label[contains(.,"Productos y cantidad a devolver")]/following::input[1]').fill('1')
    await page.locator('xpath=//label[contains(.,"Motivo")]/following::select[1]').selectOption({ label: 'Producto roto / dañado' })

    // Forma = Reposición
    await page.getByRole('button', { name: /^Reposición$/ }).click()

    await page.getByRole('button', { name: /Confirmar devolución/i }).click()

    // POSITIVO: toast de reposición (OC nueva), sin error de stock
    await expect(page.getByText(/Devolución #\d+ registrada — reposición \(OC nueva\)/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/No hay stock suficiente/i)).not.toBeVisible()
  })
})
