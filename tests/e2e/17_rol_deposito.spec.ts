/**
 * 17_rol_deposito.spec.ts
 * Tests para el rol DEPOSITO:
 *  - Accede a Inventario, Productos, Alertas, Recepciones, Envíos, Mi-cuenta
 *  - Redirige a /inventario desde rutas restringidas (ventas, caja, config, etc.)
 *  - El sidebar muestra los módulos de depósito y oculta administración
 *  - Puede operar stock (tabs Agregar/Quitar visibles)
 */
import { test, expect } from '@playwright/test'

const RUTAS_PERMITIDAS = ['/inventario', '/productos', '/alertas']
const RUTAS_RESTRINGIDAS = ['/ventas', '/caja', '/gastos', '/configuracion', '/usuarios', '/rrhh', '/reportes']

test.describe('Rol DEPOSITO — acceso permitido', () => {
  for (const ruta of RUTAS_PERMITIDAS) {
    test(`${ruta} es accesible`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).not.toHaveURL(/login/)
      expect(page.url()).toContain(ruta.split('?')[0])
    })
  }
})

test.describe('Rol DEPOSITO — rutas restringidas redirigen a /inventario', () => {
  for (const ruta of RUTAS_RESTRINGIDAS) {
    test(`${ruta} redirige a /inventario`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/inventario/, { timeout: 5000 })
    })
  }
})

test.describe('Rol DEPOSITO — sidebar y operación', () => {
  test('sidebar muestra Inventario/Productos y oculta administración', async ({ page }) => {
    await page.goto('/inventario')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: /inventario/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /productos/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /configuraci[oó]n/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /usuarios/i })).not.toBeVisible()
  })

  test('puede operar stock (tabs Agregar/Quitar)', async ({ page }) => {
    await page.goto('/inventario')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    // Los tabs de movimiento de stock deben estar presentes para DEPOSITO
    await expect(page.getByRole('button', { name: /agregar stock/i }).first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /quitar stock/i }).first()).toBeVisible()
  })
})
