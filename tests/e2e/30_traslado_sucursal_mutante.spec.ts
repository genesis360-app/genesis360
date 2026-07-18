/**
 * 30_traslado_sucursal_mutante.spec.ts
 * E2E MUTANTE — Traslado de stock entre sucursales (REGLA #0, inventario multi-sucursal).
 *
 * Despacha 1 unidad desde la sucursal origen (sale el stock) y el dueño (puedeVerTodas)
 * confirma la recepción en el destino (entra el stock, tipo 'traslado'). La sucursal origen
 * se fija vía localStorage('sucursal-id') (lo lee useSucursalFilter). Verifica el efecto en DB.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV (Almacén Jorgito,
 * 2 sucursales: Norte = origen con stock, Sur = destino).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e' // origen (con stock)

test.describe('Traslado entre sucursales (mutante)', () => {
  test('despacha desde origen y el destino confirma → el stock se mueve', async ({ page }) => {
    // Fijar la sucursal activa = origen (Norte)
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/inventario')
    await waitForApp(page)

    // Tab Traslados
    await page.getByRole('button', { name: /^Traslados$/ }).first().click()
    await page.waitForTimeout(800)

    // Nuevo traslado
    await page.getByRole('button', { name: /Nuevo traslado/i }).click()
    await page.waitForTimeout(500)

    // Destino (la otra sucursal)
    const destino = page.locator('select').filter({ has: page.locator('option', { hasText: /Elegir sucursal/i }) }).first()
    const dvals = await destino.locator('option').evaluateAll(o => (o as HTMLOptionElement[]).map(x => x.value).filter(Boolean))
    test.skip(dvals.length === 0, 'No hay sucursal destino')
    await destino.selectOption(dvals[0])

    // Buscar una línea con stock en el origen y agregarla
    await page.getByPlaceholder(/Buscar producto por nombre o SKU/i).fill('a')
    await page.waitForTimeout(900)
    await page.locator('button:has-text("disp.")').first().click()
    await page.waitForTimeout(400)

    // Cantidad a trasladar = 1 (mínimo, el default es todo lo disponible)
    const cant = page.locator('input[type="number"]').first()
    await cant.fill('1')
    await page.waitForTimeout(200)

    // Despachar
    await page.getByRole('button', { name: /Despachar traslado/i }).click()

    // El traslado quedó en tránsito → aparece "Confirmar recepción" (el dueño ve todas)
    const confirmarLista = page.getByRole('button', { name: /Confirmar recepción/i }).first()
    await expect(confirmarLista).toBeVisible({ timeout: 12000 })
    await confirmarLista.click()

    // Modal de recepción — REGRESIÓN §35 (2026-07-18): el selector "Ubicación destino" filtraba
    // con `.eq('sucursal_id', destino)`, que en Postgres NUNCA matchea `sucursal_id IS NULL` →
    // las ubicaciones GLOBALES (ej. "Container", sin sucursal asignada) desaparecían del
    // selector aunque apliquen a todas las sucursales. Con el fix debe haber más de la opción
    // "Sin ubicación" sola (a menos que el tenant no tenga NINGUNA ubicación global, lo cual
    // sería un problema de datos de DEV, no del código — por eso el mensaje lo distingue).
    await expect(page.getByText(/Confirmar recepción — Traslado #\d+/i)).toBeVisible({ timeout: 5000 })
    const ubicDestinoSelect = page.locator('xpath=//label[contains(.,"Ubicación destino")]/following-sibling::select[1]')
    // poll: la query de ubicaciones-destino fetchea al abrir el modal, el <select> arranca con
    // el default [] hasta que resuelve — un count() inmediato es una carrera, no una regresión.
    await expect
      .poll(() => ubicDestinoSelect.locator('option').count(), {
        timeout: 8000,
        message:
          '[30] El selector "Ubicación destino" de Confirmar recepción solo tiene "Sin ubicación" — ' +
          'regresión del bug §35 (ubicaciones globales excluidas) o el tenant se quedó sin ninguna ' +
          'ubicación global en DEV (verificar `ubicaciones` con sucursal_id IS NULL).',
      })
      .toBeGreaterThan(1)

    await page.getByRole('button', { name: /Confirmar recepción/i }).last().click()

    // POSITIVO: toast "Traslado #N recibido ..."
    await expect(page.getByText(/Traslado #\d+ recibido/i)).toBeVisible({ timeout: 15000 })
  })
})
