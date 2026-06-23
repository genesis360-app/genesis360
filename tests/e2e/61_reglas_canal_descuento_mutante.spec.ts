/**
 * 61_reglas_canal_descuento_mutante.spec.ts
 * E2E MUTANTE — `reglas_canal.<clasif>.descuento_max_pct` topea el descuento POR CANAL (REGLA #0, plata).
 *
 * L39/J2c (`VentasPage.registrarVenta` → `validarDescuentosPorRol`, `maxCanalPct`): el tope de descuento
 * del canal de venta aplica a CUALQUIER rol con permiso de descuento — incluido el DUEÑO, que NO tiene
 * tope por rol. Esto lo distingue del tope del SUPERVISOR (spec 45). Un descuento general por encima del
 * tope del canal dispara el gate de **clave maestra** (clave configurada → override; sin clave → bloquea).
 *
 * Fixture (DEV, Almacén Jorgito): `reglas_canal = {presencial:{descuento_max_pct:5}, online:{...:5}}`
 * (ambas clasificaciones, por si el canal activo resuelto no es presencial). Reversible → restaurar a `{}`.
 * Flujo (OWNER, que no tiene tope de rol): producto → "Venta directa" → descuento general 20% (> 5%) →
 * "Venta directa" (CTA) → gate de clave con el mensaje del canal.
 *
 * Aserción POSITIVA: aparece el modal "Clave maestra" + texto "supera el máximo de este canal (5%)".
 * NO se autoriza (no se ingresa el override) → la venta NO se crea (sin mutación; se verifica con SQL).
 * GATE: requiere E2E_CANAL_DESC_FIXTURE=1 (solo con el fixture aplicado). Corre con OWNER (chromium).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Tope de descuento por canal aplica al DUEÑO (mutante)', () => {
  test.skip(process.env.E2E_CANAL_DESC_FIXTURE !== '1', 'Fixture reglas_canal.descuento_max_pct=5 no aplicado (E2E_CANAL_DESC_FIXTURE!=1).')

  test('descuento general 20% > tope de canal 5% → gate de clave (DUEÑO, sin tope de rol)', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Agregar un producto
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'No hay productos vendibles en el tenant de prueba')
    await prod.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // 2) Modo "Venta directa" (el bloque "Descuento general" se renderiza fuera de presupuesto)
    await page.getByRole('button', { name: /^Venta directa$/ }).first().click()
    await page.waitForTimeout(300)

    // 3) Descuento general 20% (input controlado de React; el de "Descuento general" tiene max="100")
    const descInput = page.locator('input[type="number"][max="100"]').first()
    await expect(descInput).toBeVisible({ timeout: 5000 })
    await descInput.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, '20')
    await expect(descInput).toHaveValue('20')

    // 4) "Venta directa" (CTA) → gate de clave por superar el tope del canal
    await page.locator('button', { hasText: /^Venta directa$/ }).last().click()

    // 5) POSITIVO: modal de clave + mensaje del CANAL (no del supervisor)
    const claveModal = page.getByRole('heading', { name: /Clave maestra/i })
    await expect(claveModal).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/supera el máximo de este canal \(5%\)/i)).toBeVisible()
    // No se autoriza → no hay mutación (la venta no se crea)
  })
})
