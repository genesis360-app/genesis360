/**
 * 45_descuento_supervisor_tope_mutante.spec.ts
 * E2E MUTANTE — Descuento del SUPERVISOR por encima del tope (Tanda A, REGLA #0 control).
 *
 * G3/J2c (`VentasPage.registrarVenta` → `validarDescuentosPorRol`): el SUPERVISOR puede
 * aplicar descuentos pero NO por encima de `tenants.descuento_max_supervisor_pct`. Un descuento
 * sobre el tope (por % o por $; acá %) dispara el gate de **clave maestra del DUEÑO**:
 *   - clave INCORRECTA → "Clave maestra incorrecta" (server-side `verificar_clave_maestra`), bloquea.
 *   - clave CORRECTA → override autorizado (la venta supera el gate de descuento).
 *
 * Valida end-to-end por la UI, en sesión SUPERVISOR, la lógica pura `validarDescuentosPorRol`
 * (hueco del descuento por $/% cerrado en v1.81.0/v1.82.0) + la verificación server-side de la clave.
 *
 * Fixture (seteado por SQL antes de correr, y reseteado después):
 *   tenants.descuento_max_supervisor_pct = 10  (Almacén Jorgito 3769b1db…).
 * Se usa el descuento GENERAL en modo "Venta directa" (estado 'despachada') a propósito: el check
 * de descuento corre ANTES que el de cliente/caja/pago, así el gate de clave se alcanza sin sembrar
 * caja ni cobro (el override re-dispara la venta, que recién ahí pide caja/pago — fuera de scope).
 * Nota: el descuento por-ítem NO sirve acá — el efecto auto-combo lo strippea si no hay combo
 * asociado (los descuentos por-ítem son combo-managed; el manual del operador es el general).
 *
 * Clave maestra real del tenant = "12345678". Corre con SUPERVISOR (proyecto chromium-supervisor).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLAVE_OK = '12345678'
const CLAVE_MALA = '00000000'

test.describe('Descuento SUPERVISOR sobre tope (mutante)', () => {
  test('descuento 30% > tope 10% → gate de clave maestra (mala bloquea / correcta autoriza)', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito (igual patrón que 19/24)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Descuento GENERAL al 30% (tipo default %, modo "Venta directa" por default → el bloque
    //    "Descuento general" es visible). Se usa el descuento general (no el por-ítem): el efecto
    //    auto-combo strippea cualquier descuento por-ítem que no venga de un combo. El input number
    //    de "Descuento general" tiene max="100" (el por-ítem no tiene max) → selector único.
    //    Es un input controlado de React → native value-setter + evento 'input' burbujeante.
    const descInput = page.locator('input[type="number"][max="100"]').first()
    await expect(descInput).toBeVisible({ timeout: 5000 })
    await descInput.evaluate((el, val) => {
      const proto = window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
      setter.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '30')
    // Verificar que el descuento quedó aplicado antes de seguir.
    await expect(descInput).toHaveValue('30')

    // 3) "Venta directa" (estado 'despachada'; el check de descuento corre ANTES que caja/pago,
    //    así el gate de clave se alcanza sin sembrar caja ni cobro). .last() = submit, no el toggle.
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeVisible({ timeout: 5000 })
    await finalizar.click()

    // 4) POSITIVO: se dispara el gate de clave maestra por superar el tope del SUPERVISOR
    await expect(page.getByRole('heading', { name: /Clave maestra/i })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/supera el límite del SUPERVISOR/i)).toBeVisible()

    // 5) NEGATIVO: clave incorrecta → rechazada server-side, el modal sigue abierto
    const claveInput = page.locator('input[type="password"]').first()
    await claveInput.fill(CLAVE_MALA)
    await page.getByRole('button', { name: /^Autorizar$/ }).click()
    await expect(page.getByText(/Clave maestra incorrecta/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: /Clave maestra/i })).toBeVisible()

    // 6) OVERRIDE: clave correcta → autoriza, el modal de clave se cierra (pasó el gate de descuento)
    await claveInput.fill(CLAVE_OK)
    await page.getByRole('button', { name: /^Autorizar$/ }).click()
    await expect(page.getByRole('heading', { name: /Clave maestra/i })).not.toBeVisible({ timeout: 8000 })
  })
})
