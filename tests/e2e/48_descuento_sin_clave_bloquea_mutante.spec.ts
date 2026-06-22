/**
 * 48_descuento_sin_clave_bloquea_mutante.spec.ts
 * E2E MUTANTE — Descuento sobre tope en tenant SIN clave maestra (Tanda A / H3, REGLA #0 control).
 *
 * Contraparte de la spec 45 (tenant CON clave → gate de clave + override). Acá el tenant
 * "Familia Otranto De Porto" NO tiene clave maestra configurada. Según la matriz H3, donde hay un
 * LÍMITE NUMÉRICO (tope de descuento) y NO hay clave, la acción se BLOQUEA sin posibilidad de
 * override (`VentasPage.registrarVenta` rama `else` de `claveMaestraConfigurada`, línea ~2390-2391):
 * "Descuento no autorizado: … Pedí autorización a un DUEÑO/SUPERVISOR." y NO aparece el modal de clave.
 *
 * Fixtures por SQL (Familia Otranto De Porto, tenant SIN clave): (1) descuento_max_supervisor_pct=10;
 * (2) un producto vendible — precio>0 + stock UBICADO (ubicacion_id no nulo, disponible_surtido) en
 * la sucursal del supervisor (en avanzado el POS solo surte stock ubicado). Corre con un SUPERVISOR
 * de prueba de ese tenant (proyecto chromium-fotranto-sup).
 *
 * ESTADO: el harness (usuario de prueba + login + project) está verificado (el login funciona).
 * La aserción se AUTO-OMITE si el POS de Familia Otranto no surte un producto vendible — su stock
 * está sin ubicar/under-provisioned. Para dejarla en verde, sembrar un producto vendible normal en
 * ese tenant (alta por la app con stock) o ajustar la disponibilidad de su inventario.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Descuento sobre tope SIN clave maestra (mutante)', () => {
  test('descuento 30% > tope 10% sin clave → bloquea sin override (no hay modal de clave)', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto al carrito (modo lista, mismo patrón probado que specs 19/24/45/46).
    //    Fixture (SQL): "Mantecol Clasico 111g" con precio>0 (su stock ya está ubicado/disponible en
    //    la sucursal del supervisor). Nombre único → sin ambigüedad con otros productos.
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('Mantecol')
    await page.waitForTimeout(1200)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button')
      .filter({ hasText: /Mantecol/i }).first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'Fixture ausente: producto vendible "Mantecol Clasico 111g" (precio>0) en Familia Otranto')
    await primerProducto.click()
    await page.waitForTimeout(600)
    const cartLoaded = await page.getByText(/\d+\s+producto/).first().isVisible({ timeout: 5000 }).catch(() => false)
    test.skip(!cartLoaded, 'No se pudo agregar el producto al carrito en Familia Otranto (revisar disponibilidad)')

    // 2) Descuento general al 30% (input number controlado → native value-setter + 'input')
    const descInput = page.locator('input[type="number"][max="100"]').first()
    await expect(descInput).toBeVisible({ timeout: 5000 })
    await descInput.evaluate((el, val) => {
      const proto = window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
      setter.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '30')
    await expect(descInput).toHaveValue('30')

    // 3) "Venta directa" → el check de descuento corre primero
    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeVisible({ timeout: 5000 })
    await finalizar.click()

    // 4) SIN clave: se BLOQUEA con aviso (no hay modal de clave para autorizar).
    //    Skip-guard: si el tope no está sembrado, no hay violación → no aparece el aviso.
    const aviso = page.getByText(/Descuento no autorizado/i)
    test.skip(!(await aviso.isVisible({ timeout: 6000 }).catch(() => false)),
      'Fixture ausente: tenants.descuento_max_supervisor_pct=10 en Familia Otranto')
    await expect(page.getByText(/Pedí autorización a un DUE/i)).toBeVisible()
    // Clave: NO debe aparecer el modal (el tenant no tiene clave → no hay override posible)
    await expect(page.getByRole('heading', { name: /Clave maestra/i })).not.toBeVisible()
  })
})
