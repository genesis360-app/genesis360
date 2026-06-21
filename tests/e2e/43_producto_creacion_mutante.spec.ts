/**
 * 43_producto_creacion_mutante.spec.ts
 * E2E MUTANTE — Alta de producto por UI (REGLA #0 fiscal: alícuota correcta).
 *
 * Crea un producto desde el form (/productos/nuevo) con una alícuota de IVA ≠ 21%
 * (10,5%) y un precio de venta, y verifica el toast "Producto creado" + el regreso a
 * la lista. La persistencia (alicuota_iva = 10.5, NO 21; precio_venta correcto) se
 * verifica aparte con execute_sql buscando por el SKU único.
 *
 * Por qué 10,5%: el bug GRAVE de v1.78.1 era que una alícuota ≠ 21% se guardaba/enviaba
 * a AFIP como 21% (`0 || 21` convertía Exento en 21%; el `numeric` mal normalizado).
 * El form usa `Number.isFinite(parseFloat(...)) ? ... : 21` (no `|| 21`) — este spec lo
 * ejercita end-to-end, que es la parte de Productos que toca lo fiscal (#10 del backlog).
 *
 * Mutante: crea un producto real en DEV (SKU único por corrida → no colisiona).
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const SKU = `E2E-PRD-${Date.now()}`
const NOMBRE = `E2E Producto 10,5% ${Date.now()}`

test.describe('Alta de producto (mutante)', () => {
  test('crea producto con alícuota 10,5% → persiste sin convertirla a 21%', async ({ page }) => {
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Nuevo producto/i })).toBeVisible({ timeout: 8000 })

    // Nombre (único obligatorio) + SKU (lo seteamos para verificar en DB sin ambigüedad)
    await page.getByPlaceholder(/Tornillo hexagonal/i).fill(NOMBRE)
    await page.getByPlaceholder(/SKU-00001/i).fill(SKU)

    // Precio de venta — el input bajo la etiqueta "Precio de venta" (hay otro para costo).
    const precioVenta = page.locator(
      'xpath=//label[contains(.,"Precio de venta")]/ancestor::div[1]/following-sibling::div[1]//input'
    ).first()
    await precioVenta.fill('1000')

    // Alícuota IVA = 10,5% (el select se reconoce por su opción "Exento (0%)")
    const alicuotaSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Exento \(0%\)/ }) }).first()
    await alicuotaSel.selectOption('10.5')

    // Crear
    await page.getByRole('button', { name: /^Crear producto$/ }).click()

    // POSITIVO: toast "Producto creado" + vuelve a la lista
    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })
  })
})
