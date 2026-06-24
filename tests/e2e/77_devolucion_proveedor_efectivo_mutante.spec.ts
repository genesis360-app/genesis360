/**
 * 77_devolucion_proveedor_efectivo_mutante.spec.ts
 * E2E MUTANTE — Devolución a proveedor forma EFECTIVO → ingreso a caja + rebaja stock (REGLA #0, plata + stock).
 *
 * Complementa la spec 33 (forma credito_cc). Con forma "Efectivo" (`ProveedoresPage.confirmarDevolucion`,
 * L1240-1250) el proveedor reembolsa en efectivo → se asienta un `caja_movimientos` tipo 'ingreso'
 * en la PRIMERA caja abierta, además de la rebaja de stock FIFO (`inventario_lineas` ↓ + movimiento
 * `ajuste_rebaje`) y el registro `devoluciones_proveedor` 'confirmada'.
 *
 * ⚠️ HALLAZGO REGLA #0 (avisado a GO): si NO hay caja abierta, el reembolso en efectivo NO se asienta
 * (solo toast de aviso) → plata fuera del arqueo. Este spec corre CON caja abierta (camino feliz).
 *
 * Aserción POSITIVA (toast "Devolución #N registrada — reembolso en efectivo"); el ingreso en
 * `caja_movimientos` + la rebaja de stock se verifican aparte con execute_sql. MUTANTE (rebaja stock +
 * mueve caja; queda como evidencia UAT). GATE: E2E_DEVOL_EFECTIVO=1. OWNER (chromium) contra DEV (Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PROVEEDOR = 'Mayorista MAX'

test.describe('Devolución a proveedor — efectivo (mutante)', () => {
  test.skip(process.env.E2E_DEVOL_EFECTIVO !== '1', 'Mutante de caja+stock (E2E_DEVOL_EFECTIVO!=1).')

  test('devolver 1 unidad con reembolso en efectivo → ingreso a caja + rebaja stock', async ({ page }) => {
    await goto(page, '/proveedores')
    await waitForApp(page)

    await page.getByRole('button', { name: /Órdenes de compra/i }).first().click()
    await page.waitForTimeout(600)

    const provFilter = page.locator('select').filter({ has: page.locator('option', { hasText: /Todos los proveedores/i }) }).first()
    await provFilter.selectOption({ label: PROVEEDOR })
    await page.waitForTimeout(600)

    // Abrir el detalle de la OC recibida (la que ofrece "Devolver a proveedor")
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

    // Forma = Efectivo (botón del selector de forma)
    await page.getByRole('button', { name: /^Efectivo$/ }).click()

    await page.getByRole('button', { name: /Confirmar devolución/i }).click()

    // POSITIVO: toast de reembolso en efectivo, sin error de stock ni de "sin caja"
    await expect(page.getByText(/Devolución #\d+ registrada — reembolso en efectivo/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/No hay stock suficiente/i)).not.toBeVisible()
    await expect(page.getByText(/Sin caja abierta/i)).not.toBeVisible()
  })
})
