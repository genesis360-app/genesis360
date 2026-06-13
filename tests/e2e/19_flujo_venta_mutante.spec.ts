/**
 * 19_flujo_venta_mutante.spec.ts
 * E2E MUTANTE del flujo de dinero (auditoría pre-cliente, pilar B).
 *
 * A diferencia de 04_ventas (defensivo, solo lectura), este test COMPLETA una
 * venta real: agrega un producto, paga en efectivo y despacha. Verifica el
 * efecto de la mutación (el carrito se limpia tras una venta exitosa, lo que
 * solo ocurre si registrarVenta creó la venta + rebajó stock).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Flujo de venta (mutante)', () => {
  test('venta directa en efectivo: completa el cobro y limpia el carrito', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)

    // Modo lista (default): el dropdown de resultados es div.absolute.top-full con <button>s.
    // Modo galería: cards en un grid. Cubrimos ambos.
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    const hayProducto = await primerProducto.isVisible().catch(() => false)
    test.skip(!hayProducto, 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)

    // El carrito tiene 1 producto (el contador "N producto" — con dígito — distingue
    // del heading persistente "Agregar productos").
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Si hay más de una caja abierta, elegir una en "Registrar en caja"
    //    El <select> es el sibling adyacente del <label> "Registrar en caja:".
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // 3) Método de pago: Efectivo cubriendo de sobra (sobrante = vuelto, permitido)
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('100000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // 4) Finalizar (modoVenta default = 'despachada' → botón "Venta directa" full-width)
    //    .last() para no chocar con el toggle de modo (mismo texto)
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // 5) Verificar la mutación: tras una venta exitosa registrarVenta resetea el carrito
    //    (line 2317), así que el contador "N producto" del carrito desaparece.
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })

    // No debe quedar un toast de error de stock visible
    await expect(page.getByText(/stock insuficiente|no se pudo registrar/i)).not.toBeVisible()
  })
})
