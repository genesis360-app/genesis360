/**
 * 23_inventario_ingreso_mutante.spec.ts
 * E2E MUTANTE del ingreso de stock (auditoría básico, pilar B).
 *
 * Es el camino de ENTRADA de stock del modo básico (Inventario → Agregar stock →
 * Ingreso): crea una inventario_lineas real (en básico con ubicacion_id/estado_id
 * NULL) y un movimiento de ingreso. Verifica la mutación vía el toast de éxito.
 *
 * Defensivo: se omite si no hay productos o si el plan llegó al límite de movimientos.
 * Corre con el usuario OWNER contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Inventario — ingreso de stock (mutante)', () => {
  test('ingresa stock de un producto y registra el movimiento', async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)

    // 1) Ir a la tab "Agregar stock"
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()
    await page.waitForTimeout(400)

    // 2) Abrir el modal de Ingreso
    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
    await ingresoBtn.click()
    await page.waitForTimeout(400)

    // 3) Buscar y elegir el primer producto
    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscador).toBeVisible({ timeout: 6000 })
    await buscador.fill('a')
    await page.waitForTimeout(900)
    // El resultado es un <button> full-width con el nombre del producto, DENTRO del modal de
    // Ingreso (evitamos un fallback page-wide que agarraba un botón detrás del backdrop).
    const modal = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
    const resultado = modal.locator('button.w-full.text-left').first()
    const hayProducto = await resultado.isVisible().catch(() => false)
    test.skip(!hayProducto, 'No hay productos en el tenant de prueba')
    await resultado.click()
    await page.waitForTimeout(500)

    // 4) Si hay selector de sucursal destino (vista "Todas"), elegir la primera
    const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelect.isVisible().catch(() => false)) {
      const vals = await sucSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (vals.length > 0) await sucSelect.selectOption(vals[0])
    }

    // 5) Cantidad = 1 (el input number con placeholder "0" dentro del modal)
    const cantidad = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidad).toBeVisible({ timeout: 5000 })
    await cantidad.fill('1')

    // 6) Confirmar ingreso
    const confirmar = page.getByRole('button', { name: /Confirmar ingreso/ }).first()
    await expect(confirmar).toBeEnabled({ timeout: 5000 })
    await confirmar.click()

    // 7) Verificar la mutación: toast de éxito
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })
  })
})
