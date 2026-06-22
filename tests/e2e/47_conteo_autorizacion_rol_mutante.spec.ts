/**
 * 47_conteo_autorizacion_rol_mutante.spec.ts
 * E2E MUTANTE — Conteo por rol ≠ DUEÑO → autorización pendiente (Tanda A, REGLA #0 inventario).
 *
 * Autorización de ajustes por rol (mig 228, `ajusteAutorizacion.ts`): con `ajuste_autorizacion_roles`
 * sin configurar, el DUEÑO ajusta directo y cualquier OTRO rol cae en modo 'siempre' → toda diferencia
 * de conteo se ENVÍA A APROBACIÓN (no toca stock). A diferencia de la spec 36 (DUEÑO, aplica al toque),
 * acá un SUPERVISOR finaliza un conteo con diferencia +1 → 0 ajustes aplicados + 1 pendiente.
 *
 * Aserción POSITIVA: toast "… pendiente de aprobación" (y NO "ajuste aplicado" > 0). El efecto
 * (fila `autorizaciones_inventario` tipo 'ajuste_conteo' estado 'pendiente', stock SIN cambiar) se
 * verifica aparte con execute_sql. El artefacto pendiente se limpia luego por SQL.
 *
 * Producto: Elite Pañuelos (simple). Corre con SUPERVISOR (proyecto chromium-supervisor).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const PRODUCTO_OPT = 'Elite Pañuelos · SKU-0001'

test.describe('Conteo por rol ≠ DUEÑO → autorización (mutante)', () => {
  test('SUPERVISOR finaliza conteo con diferencia +1 → pendiente de aprobación (no ajusta)', async ({ page }) => {
    page.on('dialog', d => d.accept().catch(() => {}))

    await goto(page, '/inventario')
    await waitForApp(page)

    await page.getByRole('button', { name: /^Conteos$/ }).first().click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Nuevo conteo/i }).first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Por producto/i }).click()
    await page.waitForTimeout(300)

    const prodSel = page.locator('select').filter({ has: page.locator('option', { hasText: /Seleccioná un producto/i }) }).first()
    await prodSel.selectOption({ label: PRODUCTO_OPT })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Cargar stock/i }).click()
    await page.waitForTimeout(1200)

    // "Contado" de la 1ª fila (pre-cargado en rápido) → +1 → diferencia
    const primerContado = page.locator('table input[type="number"]').first()
    await expect(primerContado).toBeVisible({ timeout: 8000 })
    const actual = await primerContado.inputValue()
    const nuevo = (parseFloat(actual.replace(',', '.')) || 0) + 1
    await primerContado.fill(String(nuevo))
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: /Finalizar y aplicar ajustes/i }).click()

    // POSITIVO: el ajuste NO se aplica al toque → queda PENDIENTE de aprobación (rol ≠ DUEÑO).
    await expect(page.getByText(/pendiente.* de aprobaci/i)).toBeVisible({ timeout: 12000 })
    // Y NO debe decir "1 ajuste aplicado" (el SUPERVISOR no ajusta directo).
    await expect(page.getByText(/1 ajuste aplicado/i)).not.toBeVisible()
  })
})
