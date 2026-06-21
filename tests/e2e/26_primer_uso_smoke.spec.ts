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
 * ✅ VALIDADO 2026-06-20 (click-through real contra DEV): los 3 flujos pasan. Al escribirlos
 * se confirmó además comportamiento CORRECTO de la app: DNI+Teléfono obligatorios en cliente,
 * no-sobrepago en medios no-efectivo (tarjeta), y cliente obligatorio en reservas
 * (cliente_obligatorio default 'reservas'). PU-11 (Caja Fuerte ingreso_traspaso) validado a
 * nivel DB sobre un tenant fresco (los 7 tipos de caja_movimientos se aceptan).
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
    const dni = String(Date.now()).slice(-8) // DNI único → evita el confirm() de duplicado
    // Nombre + DNI + Teléfono son obligatorios (form los marca con *)
    await page.getByPlaceholder(/Nombre completo o razón social/i).fill(nombre)
    await page.getByPlaceholder(/Ej: 30123456/i).fill(dni)
    await page.getByPlaceholder(/Ej: \+54/i).fill('+54 11 5555-' + dni.slice(-4))

    // Notas — el campo cuya columna faltaba en PROD (payload la manda SIEMPRE)
    await page.getByPlaceholder(/Observaciones internas/i).fill('Nota de prueba primer uso')

    // Guardar
    await page.getByRole('button', { name: /Crear cliente/i }).click()

    // Mutación OK: el modal se cierra (no error de columna PostgREST 42703 que dejaría el modal abierto)
    await expect(page.getByRole('heading', { name: /Nuevo cliente/i })).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/notas.*does not exist|column .*notas/i)).not.toBeVisible()

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

    // Método de pago: Tarjeta (NO efectivo → asienta ingreso_informativo, no ingreso real).
    // Los medios no-efectivo NO admiten excedente → pagar EXACTO el total.
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /Tarjeta de crédito/i }) }).first()
    await expect(tipoSelect).toBeVisible({ timeout: 5000 })
    await tipoSelect.selectOption({ label: 'Tarjeta de crédito' })

    // Leer el Total exacto (es-AR: "$1.200" → 1200) y pagar ese monto
    const totalTxt = await page.getByText(/^Total$/).first().locator('xpath=following::*[1]').textContent()
    const total = Number((totalTxt || '0').replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.'))
    expect(total).toBeGreaterThan(0)
    const montoInput = page.locator('input[type="number"]').last()
    await montoInput.fill(String(total))
    await montoInput.blur()
    await page.waitForTimeout(400)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })
    await finalizar.click()

    // Mutación OK: el carrito se limpia y NO hay error del CHECK de caja_movimientos
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/caja_movimientos_tipo_check|no se pudo registrar/i)).not.toBeVisible()
  })

  // ── PU-12 · Reserva con seña en efectivo → caja_movimientos.tipo = ingreso_reserva ──
  test('reserva con seña efectivo: crea la reserva y asienta ingreso_reserva', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    const buscador = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill('a')
    await page.waitForTimeout(1000)
    const primerProducto = page.locator('div.absolute.top-full button, div.grid > button').first()
    test.skip(!(await primerProducto.isVisible().catch(() => false)), 'No hay productos vendibles')
    await primerProducto.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // La reserva exige cliente registrado (cliente_obligatorio default 'reservas') → seleccionar uno
    await page.getByRole('button', { name: /Cliente registrado/i }).click()
    const clienteSearch = page.getByPlaceholder(/Buscar por nombre o DNI/i).first()
    await clienteSearch.fill('a')
    await page.waitForTimeout(800)
    await page.locator('div.absolute.z-20 button').first().click()
    await page.waitForTimeout(300)

    // Seña en Efectivo cubriendo el total (cumple la seña mínima; efectivo admite excedente)
    const tipoSelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.locator('input[type="number"]').last()
    await montoInput.fill('100000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    // Cambiar a modo "Reservar" (toggle) y ejecutar con el botón de acción ("Reservar stock")
    await page.getByRole('button', { name: 'Reservar', exact: true }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Reservar stock/i }).click()

    // Reserva OK: el carrito se limpia y NO hay error de seña ni del CHECK de caja_movimientos
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/no se puede reservar sin seña|caja_movimientos_tipo_check|no se asentó/i)).not.toBeVisible()
  })

  // ── PU-11 · Caja Fuerte: ingresar dinero → caja_movimientos.tipo = ingreso_traspaso ──
  // El depósito a Caja Fuerte es un modal multi-paso (requiere caja operativa abierta con fondos
  // + la bóveda). Validado a nivel DB sobre un tenant fresco (el insert ingreso_traspaso que hace
  // la app — el CHECK lo acepta tras mig 229/230) + queda como check de runtime de GO en la UI.
  test.fixme('PU-11 · ingreso a Caja Fuerte (ingreso_traspaso) — validado en DB + runtime de GO', async () => {})
})
