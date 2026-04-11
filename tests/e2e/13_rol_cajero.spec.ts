/**
 * 13_rol_cajero.spec.ts
 * Tests para el rol CAJERO:
 *  - Solo puede acceder a Ventas, Caja, Clientes
 *  - Redirige a /ventas si intenta acceder a rutas restringidas
 *  - No ve opciones de configuración, usuarios, RRHH, etc. en el sidebar
 */
import { test, expect } from '@playwright/test'

const RUTAS_PERMITIDAS = [
  '/ventas',
  '/caja',
  '/clientes',
]

const RUTAS_RESTRINGIDAS = [
  '/dashboard',
  '/inventario',
  '/alertas',
  '/gastos',
  '/reportes',
  '/historial',
  '/configuracion',
  '/usuarios',
  '/rrhh',
]

test.describe('Rol CAJERO — acceso permitido', () => {
  for (const ruta of RUTAS_PERMITIDAS) {
    test(`${ruta} es accesible`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).not.toHaveURL(/login/)
      // Debe quedar en la ruta o en una sub-ruta (ej: /ventas?tab=...)
      const url = page.url()
      expect(url).toContain(ruta.split('?')[0])
    })
  }
})

test.describe('Rol CAJERO — rutas restringidas redirigen a /ventas', () => {
  for (const ruta of RUTAS_RESTRINGIDAS) {
    test(`${ruta} redirige a /ventas`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      // CAJERO debe ser redirigido a /ventas desde cualquier ruta no permitida
      await expect(page).toHaveURL(/\/ventas/, { timeout: 5000 })
    })
  }
})

test.describe('Rol CAJERO — sidebar y UI', () => {
  test('sidebar solo muestra Ventas, Caja y Clientes', async ({ page }) => {
    await page.goto('/ventas')
    await page.waitForLoadState('networkidle')
    // Items visibles
    await expect(page.getByRole('link', { name: /ventas/i }).first()).toBeVisible()
    // Items restringidos no deben aparecer
    await expect(page.getByRole('link', { name: /configuraci[oó]n/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /usuarios/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /rrhh|recursos humanos/i })).not.toBeVisible()
  })

  test('puede crear y ver ventas', async ({ page }) => {
    await page.goto('/ventas')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    // La página debe cargar el carrito de ventas
    await expect(page.getByText(/nueva venta|carrito/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('puede acceder a caja', async ({ page }) => {
    await page.goto('/caja')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText(/caja/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('puede acceder a clientes', async ({ page }) => {
    await page.goto('/clientes')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText(/clientes/i).first()).toBeVisible({ timeout: 8000 })
  })
})
