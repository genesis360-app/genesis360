/**
 * 16_rol_rrhh.spec.ts
 * Tests para el rol RRHH:
 *  - Solo puede acceder a /rrhh y /mi-cuenta
 *  - Redirige a /rrhh si intenta acceder a cualquier otra ruta
 *  - Sidebar solo muestra RRHH
 *  - Puede operar el módulo RRHH correctamente
 */
import { test, expect } from '@playwright/test'

const RUTAS_PERMITIDAS = [
  '/rrhh',
  '/mi-cuenta',
]

const RUTAS_RESTRINGIDAS = [
  '/dashboard',
  '/ventas',
  '/caja',
  '/gastos',
  '/inventario',
  '/productos',
  '/clientes',
  '/alertas',
  '/reportes',
  '/historial',
  '/configuracion',
  '/usuarios',
  '/sucursales',
]

test.describe('Rol RRHH — rutas permitidas', () => {
  for (const ruta of RUTAS_PERMITIDAS) {
    test(`${ruta} es accesible`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).not.toHaveURL(/login/)
      const url = page.url()
      expect(url).toContain(ruta.split('?')[0])
    })
  }
})

test.describe('Rol RRHH — rutas restringidas redirigen a /rrhh', () => {
  for (const ruta of RUTAS_RESTRINGIDAS) {
    test(`${ruta} redirige a /rrhh`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/rrhh/, { timeout: 5000 })
    })
  }
})

test.describe('Rol RRHH — sidebar y UI', () => {
  test('sidebar solo muestra RRHH', async ({ page }) => {
    await page.goto('/rrhh')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: /^rrhh$/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /^ventas$/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^dashboard$/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /configuraci[oó]n/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^usuarios$/i })).not.toBeVisible()
  })

  test('puede ver listado de empleados', async ({ page }) => {
    await page.goto('/rrhh')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText(/empleados/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('puede acceder a Mi Cuenta', async ({ page }) => {
    await page.goto('/mi-cuenta')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page).not.toHaveURL(/\/rrhh/)
  })
})
