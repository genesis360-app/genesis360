/**
 * 36_conteo_ajuste_mutante.spec.ts
 * E2E MUTANTE — Conteo de inventario con diferencia → ajusta el stock (REGLA #0, inventario).
 *
 * Conteo 2.0 (InventarioPage.finalizarConteoYAplicar). Para el DUEÑO (modo de autorización
 * 'directo', mig 228) un conteo con diferencia se aplica AL TOQUE: reconcilia por delta
 * (`reconciliarDelta`) → actualiza `inventario_lineas` + inserta `movimientos_stock`
 * (`ajuste_ingreso`/`ajuste_rebaje`) con motivo "Conteo de inventario". Sin gate por umbral ni
 * doble conteo configurados en el tenant → no hay reconteo ni autorización.
 *
 * En modo "rápido" el campo "Contado" viene pre-cargado con lo esperado; el test lo sube en +1
 * en la primera línea → diferencia +1 → 1 ajuste. Aserción POSITIVA (toast "Conteo finalizado —
 * 1 ajuste aplicado"); el efecto (stock +1 + movimiento de ajuste) se verifica con execute_sql.
 *
 * Producto: Elite Pañuelos (simple). Corre con OWNER (chromium) contra el tenant DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PRODUCTO_OPT = 'Elite Pañuelos · SKU-0001' // texto de la opción "{nombre} · {sku}"

test.describe('Conteo de inventario (mutante)', () => {
  test('conteo por producto con diferencia +1 → ajusta el stock (DUEÑO, directo)', async ({ page }) => {
    // Por las dudas: aceptar el confirm de "líneas sin contar" (en rápido no debería aparecer)
    page.on('dialog', d => d.accept().catch(() => {}))

    await goto(page, '/inventario')
    await waitForApp(page)

    // Tab Conteos
    await page.getByRole('button', { name: /^Conteos$/ }).first().click()
    await page.waitForTimeout(500)

    // Nuevo conteo
    await page.getByRole('button', { name: /Nuevo conteo/i }).first().click()
    await page.waitForTimeout(400)

    // Alcance: Por producto
    await page.getByRole('button', { name: /Por producto/i }).click()
    await page.waitForTimeout(300)

    // Elegir el producto (select con opción "Seleccioná un producto")
    const prodSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un producto/i }) }).first()
    await prodSel.selectOption({ label: PRODUCTO_OPT })
    await page.waitForTimeout(300)

    // Cargar stock
    await page.getByRole('button', { name: /Cargar stock/i }).click()
    await page.waitForTimeout(1200)

    // La tabla de conteo aparece; el "Contado" de la 1ª fila viene pre-cargado (rápido) → +1
    const primerContado = page.locator('table input[type="number"]').first()
    await expect(primerContado).toBeVisible({ timeout: 8000 })
    const actual = await primerContado.inputValue()
    const nuevo = (parseFloat(actual.replace(',', '.')) || 0) + 1
    await primerContado.fill(String(nuevo))
    await page.waitForTimeout(300)

    // Finalizar y aplicar
    await page.getByRole('button', { name: /Finalizar y aplicar ajustes/i }).click()

    // POSITIVO: toast de finalización con al menos 1 ajuste aplicado (no "pendiente de aprobación")
    await expect(page.getByText(/Conteo finalizado — \d+ ajuste/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/pendiente.* de aprobaci/i)).not.toBeVisible()
  })
})
