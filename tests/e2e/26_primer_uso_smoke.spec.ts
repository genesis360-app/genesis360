/**
 * 26_primer_uso_smoke.spec.ts
 * E2E SMOKE de PRIMER USO (UAT `tests/specs/uat-primer-uso.plan.md`, capa B · PU-05→PU-17).
 *
 * Objetivo: ejercitar de punta a punta los flujos operativos que estaban ROTOS en
 * PROD por el drift DEV≠PROD (causa de la mala experiencia del usuario nuevo):
 *   - clientes.notas faltaba en PROD → toda alta/edición de cliente con notas rompía  (PU-16)
 *   - caja_movimientos_tipo_check viejo → venta no-efectivo (ingreso_informativo),    (PU-09)
 *     Caja Fuerte (ingreso_traspaso) y reserva con seña (ingreso_reserva) rompían     (PU-11/PU-12)
 *
 * ⚠️ PREPARADO, NO VALIDADO TODAVÍA. Por decisión de GO (2026-06-20) la suite e2e se
 * ejecuta al FINAL del desarrollo (tras re-correr la auditoría de paridad). Los
 * selectores siguen el patrón de 19_flujo_venta_mutante / 20_caja_apertura_cierre pero
 * NO se corrieron — validar/ajustar en la primera ejecución.
 *
 * NOTA: PU-05 (abrir caja) + PU-14 (arqueo + cierre) ya están cubiertos por
 * 20_caja_apertura_cierre.spec.ts; PU-08 (venta efectivo) por 19_flujo_venta_mutante.
 * Este spec cubre los GAPS (no-efectivo + clientes.notas) y deja stubs para Caja
 * Fuerte y reserva con seña.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Primer uso — smoke (mutante)', () => {
  // ── PU-16 · alta de cliente CON NOTAS (la columna clientes.notas faltaba en PROD) ──
  test('crea un cliente con notas (camino que rompía en PROD por drift de columna)', async ({ page }) => {
    await goto(page, '/clientes')
    await waitForApp(page)

    // Abrir el form de nuevo cliente
    const nuevo = page.getByRole('button', { name: /nuevo cliente|agregar cliente|^nuevo$/i }).first()
    await expect(nuevo).toBeVisible({ timeout: 8000 })
    await nuevo.click()
    await page.waitForTimeout(400)

    const nombre = uniqueName('Cliente')
    // Nombre (requerido)
    const nombreInput = page.locator('xpath=//label[contains(.,"Nombre")]/following::input[1]')
    await expect(nombreInput).toBeVisible({ timeout: 5000 })
    await nombreInput.fill(nombre)

    // Notas — el campo cuya columna faltaba en PROD (payload la manda SIEMPRE)
    const notasInput = page.locator('xpath=//label[contains(.,"Notas")]/following::textarea[1] | //label[contains(.,"Notas")]/following::input[1]').first()
    if (await notasInput.isVisible().catch(() => false)) {
      await notasInput.fill('Nota de prueba primer uso')
    }

    // Guardar
    await page.getByRole('button', { name: /^Guardar$|Crear cliente|Guardar cliente/i }).first().click()

    // Mutación OK: aparece toast de éxito y NO el error de columna (PostgREST 42703)
    await expect(page.getByText(/cliente creado|cliente guardado|guardado/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/column .*notas.*does not exist|notas.*no existe/i)).not.toBeVisible()

    // El cliente aparece en la lista
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 8000 })
  })

  // ── PU-09 · venta NO-efectivo (tarjeta) → caja_movimientos.tipo = ingreso_informativo ──
  test('venta con pago Tarjeta: completa el cobro (ingreso_informativo) y limpia el carrito', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)

    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    const hayProducto = await primerProducto.isVisible().catch(() => false)
    test.skip(!hayProducto, 'No hay productos vendibles en el tenant de prueba')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Si hay más de una caja abierta, elegir una
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // Método de pago: Tarjeta (NO efectivo → asienta ingreso_informativo, no ingreso real)
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /Tarjeta/i }) }).first()
    await expect(tipoSelect).toBeVisible({ timeout: 5000 })
    const tarjetaOpt = await tipoSelect.locator('option', { hasText: /Tarjeta/i }).first().textContent()
    await tipoSelect.selectOption({ label: (tarjetaOpt || 'Tarjeta').trim() })
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('100000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // Mutación OK: el carrito se limpia y NO hay error del CHECK de caja_movimientos
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/caja_movimientos_tipo_check|no se pudo registrar/i)).not.toBeVisible()
  })

  // ── PU-11 · Caja Fuerte: ingresar dinero → caja_movimientos.tipo = ingreso_traspaso ──
  // STUB a completar al validar la suite (flujo de Caja Fuerte: bóveda → Ingresar dinero →
  // cuenta destino Efectivo → confirmar; verificar que el saldo de bóveda sube y no rompe
  // el CHECK). Era el error exacto del usuario nuevo (mig 229).
  test.fixme('PU-11 · ingreso a Caja Fuerte asienta ingreso_traspaso sin romper el CHECK', async () => {})

  // ── PU-12 · Reserva con seña en efectivo → caja_movimientos.tipo = ingreso_reserva ──
  // STUB a completar al validar la suite (POS → modo "Reservar" → seña efectivo →
  // confirmar; verificar la seña asentada en caja y la venta en estado 'reservada').
  test.fixme('PU-12 · reserva con seña efectivo asienta ingreso_reserva', async () => {})
})
