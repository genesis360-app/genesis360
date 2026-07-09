/**
 * 38_envio_combustible_gasto_mutante.spec.ts
 * E2E MUTANTE — Envío propio → combustible → genera un gasto (REGLA #0, contable).
 *
 * En un envío propio con vehículo asignado, "Registrar combustible" (EN7/G2,
 * `EnviosPage.registrarCombustible`) inserta un gasto en `gastos` (categoría Combustible,
 * estado_pago 'pagado', IVA crédito) + suma KM al vehículo + vincula `envios.gasto_combustible_id`.
 *
 * Aserción POSITIVA (toast "Combustible registrado como gasto"); el gasto + el link en el envío
 * se verifican aparte con execute_sql.
 *
 * AUTOSUFICIENTE: el botón "Registrar combustible" solo aparece en un envío `courier='Envío
 * propio'` CON `recurso_id` (vehículo) Y SIN `gasto_combustible_id` todavía. El envío fijo #15
 * (único con vehículo hasta ahora) queda con el combustible YA registrado apenas corre este test
 * una vez — un fixture fijo se agota. Por eso el test genera su PROPIA fixture en 2 pasos:
 *   1) una venta con "Incluir envío" → "Envío propio" (auto-crea el envío con courier correcto,
 *      `VentasPage.registrarVenta`), y
 *   2) "Editar envío" para asignarle el vehículo (`recurso_id`) — sin tocar el combo Courier.
 *
 * NOTA (bug de producto — ARREGLADO 2026-07, ver spec 85): crear un envío "Envío propio" a mano
 * desde el modal "Nuevo envío" de EnviosPage (`saveEnvio` línea ~562) dejaba `courier: null` en vez
 * de `'Envío propio'` — el <select> Courier queda oculto y vacío para ese tipo, y `saveEnvio`
 * confiaba en el `form.courier` stale en vez de derivarlo del toggle `tipoEnvio`. Eso rompía tanto
 * "Registrar combustible" (gate `e.courier === 'Envío propio'`) como el flag `envioYaSaldado` de
 * Pagos Courier (línea ~613, mismo `form.courier`). Ya corregido (`saveEnvio` deriva `courier` de
 * `tipoEnvio`; regresión cubierta por `85_envio_propio_manual_courier_mutante.spec.ts`, que crea el
 * envío por ESTA ruta manual). Este test 38 sigue usando la ruta de venta para su fixture (no hace
 * falta duplicar cobertura del modal manual acá).
 *
 * Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Envío propio → combustible → gasto (mutante)', () => {
  test('registrar combustible de un envío propio genera el gasto', async ({ page }) => {
    // Flujo largo (venta + editar envío + registrar combustible) — más que el timeout default
    test.setTimeout(90000)

    // 1) FIXTURE FRESCA — parte A: una venta con envío propio (auto-crea el envío, courier OK)
    await goto(page, '/ventas')
    await waitForApp(page)
    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const prod = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await prod.isVisible().catch(() => false)), 'No hay productos vendibles en el tenant de prueba')
    await prod.click()
    await page.waitForTimeout(500)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Toggle "Incluir envío" → panel expandido (tipo de transporte "propio" es el default)
    await page.getByText('Incluir envío', { exact: true }).click()
    await page.waitForTimeout(400)
    const propioBtn = page.getByRole('button', { name: /Envío propio/i })
    if (await propioBtn.isVisible().catch(() => false)) await propioBtn.click()

    // Medio de pago: cubrir el total con Efectivo (venta normal, no CC)
    const totalTxt = await page.locator('div:has(> span:text-is("Total")) > span').last().textContent()
    const totalNum = parseFloat((totalTxt ?? '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
    expect(totalNum).toBeGreaterThan(0)
    const medioSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await expect(medioSelect).toBeVisible({ timeout: 5000 })
    await medioSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    if (await montoInput.isVisible().catch(() => false)) { await montoInput.fill(String(totalNum)); await montoInput.blur() }
    await page.waitForTimeout(300)

    // Si hay varias cajas abiertas (actividad e2e concurrente), el POS exige elegir una
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const vals = await cajaSelect.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
      if (vals.length) await cajaSelect.selectOption(vals[0])
    }

    const finalizar = page.getByRole('button', { name: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // POSITIVO: la venta se creó (y con ella, el envío propio en estado 'pendiente')
    await expect(page.getByText(/Venta finalizada/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 8000 })

    // 2) FIXTURE FRESCA — parte B: asignarle el vehículo al envío recién creado (Editar envío)
    await goto(page, '/envios')
    await waitForApp(page)
    const tabEnvios = page.getByRole('button', { name: /^Env[ií]os$/ }).first()
    if (await tabEnvios.isVisible().catch(() => false)) {
      await tabEnvios.click()
      await page.waitForTimeout(500)
    }

    // El envío recién creado es el más reciente (orden created_at desc) → primera fila
    const fila = page.locator('tbody tr').first()
    await expect(fila).toBeVisible({ timeout: 8000 })
    await expect(fila.getByText(/Envío propio/i)).toBeVisible({ timeout: 5000 })
    await fila.locator('button[title="Editar"]').click()
    await expect(page.getByRole('heading', { name: /^Editar envío$/i })).toBeVisible({ timeout: 5000 })

    // El toggle "Envío propio" del modal NO refleja el courier ya guardado (no se auto-selecciona
    // al editar) — hay que clickearlo para revelar el combo Vehículo. Esto NO toca `form.courier`
    // (que ya vino precargado con 'Envío propio' desde el registro existente), así que el valor
    // correcto se preserva al guardar.
    await page.getByRole('button', { name: /Envío propio/i }).click()
    await page.waitForTimeout(300)
    const vehiculoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Moto Reparto Test/i }) }).first()
    test.skip(!(await vehiculoSelect.isVisible().catch(() => false)), 'No hay vehículo "Moto Reparto Test" activo en el tenant de prueba')
    const vehiculoValue = await vehiculoSelect.locator('option', { hasText: /Moto Reparto Test/i }).first().getAttribute('value')
    await vehiculoSelect.selectOption(vehiculoValue!)

    await page.getByRole('button', { name: /^Guardar cambios$/i }).click()
    await expect(page.getByText(/^Envío actualizado$/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /^Editar envío$/i })).not.toBeVisible({ timeout: 5000 })

    // 3) Expandir la fila y registrar el combustible
    await fila.getByRole('button').first().click()
    await page.waitForTimeout(500)

    const btnComb = page.getByRole('button', { name: /Registrar combustible/i })
    await expect(btnComb).toBeVisible({ timeout: 5000 })
    await btnComb.click()

    // Modal: monto del gasto
    await expect(page.getByRole('heading', { name: /Registrar combustible/i })).toBeVisible({ timeout: 5000 })
    await page.locator('xpath=//label[contains(.,"Monto del gasto")]/following::input[1]').fill('5000')
    await page.waitForTimeout(200)

    // Confirmar
    await page.getByRole('button', { name: /Registrar gasto/i }).click()

    // POSITIVO: toast de combustible registrado como gasto
    await expect(page.getByText(/Combustible registrado como gasto/i)).toBeVisible({ timeout: 12000 })
  })
})
