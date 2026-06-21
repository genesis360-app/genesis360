/**
 * 41_clave_maestra_set_hash_mutante.spec.ts
 * E2E MUTANTE — Setear la clave maestra (hasheada, con confirmación) (REGLA #0, seguridad).
 *
 * Config → Caja → "Seguridad de Caja": al guardar una clave maestra nueva, el frontend valida
 * mínimo 6 caracteres + campo de confirmación coincidente, y la persiste vía el RPC
 * `set_clave_maestra` (SECURITY DEFINER, solo DUEÑO) que la guarda **hasheada con bcrypt**
 * (mig 233) — ya no en texto plano ni con escritura directa a `tenants`.
 *
 * Aserción POSITIVA (toast "Datos y clave maestra actualizados"); que la clave quedó re-hasheada
 * (hash distinto al previo) y sigue verificando con el valor tipeado se comprueba con execute_sql.
 *
 * Setea la clave a "12345678" (valor que el dueño espera). Corre con OWNER=DUEÑO (chromium) DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const CLAVE = '12345678'

test.describe('Set clave maestra hasheada (mutante)', () => {
  test('guardar la clave maestra con confirmación → se persiste hasheada (RPC)', async ({ page }) => {
    await goto(page, '/configuracion')
    await waitForApp(page)

    // Nav de Config → Caja (botón del nav, no el link del sidebar)
    await page.getByRole('button', { name: /^Caja$/ }).first().click()
    await page.waitForTimeout(600)

    // Campo "Contraseña maestra" + confirmación
    const claveInput = page.locator('xpath=//label[contains(.,"Contraseña maestra")]/following::input[1]')
    await expect(claveInput).toBeVisible({ timeout: 8000 })
    await claveInput.fill(CLAVE)
    await page.getByPlaceholder(/Repetí la clave maestra/i).fill(CLAVE)
    await page.waitForTimeout(200)

    // Guardar (el botón de esta sección, después del campo)
    await page.locator('xpath=//label[contains(.,"Contraseña maestra")]/following::button[normalize-space(.)="Guardar"][1]').click()

    // POSITIVO: toast de actualización con clave + sin errores de validación
    await expect(page.getByText(/Datos y clave maestra actualizados/i)).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/no coinciden|al menos 6 caracteres|no se actualizó/i)).not.toBeVisible()
  })
})
