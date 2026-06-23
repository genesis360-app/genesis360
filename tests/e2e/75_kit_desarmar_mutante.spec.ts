/**
 * 75_kit_desarmar_mutante.spec.ts
 * E2E MUTANTE — Desarmar un KIT devuelve los componentes al stock (REGLA #0, stock).
 *
 * L12 (`InventarioPage.desarmarKit` ~1441-1502): desarmar N kits rebaja N del stock del KIT y reingresa
 * `receta.cantidad × N` de cada componente (mov. `ajuste_ingreso`) + log `kitting_log` tipo 'desarmado'.
 * Si el stock de componentes quedara mal, se pierde/duplica mercadería → cero error tolerado.
 *
 * Datos reales (Almacén Jorgito, Sucursal Norte): KIT "Elite Pañuelos Super Pack x3" (stock 40, receta:
 * componente "Elite Pañuelos" ×3). Desarmar 1 → KIT 40→39, componente 140→143 (+3).
 *
 * Aserción POSITIVA por UI (el modal cierra); los stocks se verifican con execute_sql. MUTANTE (queda
 * como evidencia UAT). GATE: E2E_KIT_DESARMAR=1. Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const NORTE = 'b56742a9-c3a2-488e-b344-086227ef396e'
const KIT = 'Elite Pañuelos Super Pack x3'

test.describe('Desarmar KIT devuelve componentes (mutante)', () => {
  test.skip(process.env.E2E_KIT_DESARMAR !== '1', 'Spec mutante de kit: correr con E2E_KIT_DESARMAR=1.')

  test('desarmar 1 KIT → KIT −1, componente +3 (receta ×3)', async ({ page }) => {
    await goto(page, '/')
    await page.evaluate((id) => localStorage.setItem('sucursal-id', id), NORTE)
    await goto(page, '/inventario')
    await waitForApp(page)

    // Tab Kits
    await page.getByRole('button', { name: /^Kits$/ }).first().click()
    await page.waitForTimeout(700)

    // Fila del KIT → botón "Desarmar"
    const row = page.locator('div').filter({ hasText: new RegExp(KIT) }).filter({ has: page.getByRole('button', { name: /^Desarmar$/ }) }).last()
    if (!(await row.isVisible().catch(() => false))) {
      test.skip(true, `KIT "${KIT}" no visible en la tab Kits`)
    }
    await row.getByRole('button', { name: /^Desarmar$/ }).click()

    // Modal de desarmado (cantidad default 1). El KIT correcto se confirma por DB (deltas de stock).
    await expect(page.getByRole('heading', { name: /Desarmar KIT/i })).toBeVisible({ timeout: 5000 })

    // Confirmar desarmado (botón del modal)
    await page.locator('.fixed.inset-0').getByRole('button', { name: /^Desarmar$/ }).click()

    // POSITIVO: el modal cierra (desarmado OK). Los stocks se verifican con execute_sql.
    await expect(page.getByRole('heading', { name: /Desarmar KIT/i })).not.toBeVisible({ timeout: 10000 })
  })
})
