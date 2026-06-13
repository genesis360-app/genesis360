/**
 * 18_rol_contador.spec.ts
 * Tests para el rol CONTADOR (read-only contable):
 *  - Accede a Dashboard, Gastos, Caja, Reportes, Ventas (RO), Clientes (RO)
 *  - Redirige a /dashboard desde rutas no permitidas (inventario, configuración, usuarios)
 *  - En Ventas no puede crear/cobrar (acceso de solo lectura)
 */
import { test, expect } from '@playwright/test'

const RUTAS_PERMITIDAS = ['/dashboard', '/gastos', '/caja', '/reportes', '/ventas', '/clientes']
const RUTAS_RESTRINGIDAS = ['/inventario', '/productos', '/configuracion', '/usuarios', '/rrhh']

test.describe('Rol CONTADOR — acceso permitido', () => {
  for (const ruta of RUTAS_PERMITIDAS) {
    test(`${ruta} es accesible`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).not.toHaveURL(/login/)
      expect(page.url()).toContain(ruta.split('?')[0])
    })
  }
})

test.describe('Rol CONTADOR — rutas restringidas redirigen a /dashboard', () => {
  for (const ruta of RUTAS_RESTRINGIDAS) {
    test(`${ruta} redirige a /dashboard`, async ({ page }) => {
      await page.goto(ruta)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
    })
  }
})

test.describe('Rol CONTADOR — read-only en Ventas', () => {
  test('Ventas carga pero sin permitir cobrar', async ({ page }) => {
    await page.goto('/ventas')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    // El aviso de solo-lectura o la ausencia del botón de cobro confirman el modo lectura.
    const cobrar = page.getByRole('button', { name: /cobrar|registrar venta|finalizar venta/i }).first()
    const visible = await cobrar.isVisible().catch(() => false)
    if (visible) {
      // Si el botón existe, al intentar cobrar debe avisar acceso de solo lectura
      await cobrar.click().catch(() => {})
      await expect(page.getByText(/solo lectura/i).first()).toBeVisible({ timeout: 4000 })
    }
  })

  test('puede ver reportes', async ({ page }) => {
    await page.goto('/reportes')
    await page.waitForLoadState('networkidle')
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText(/reportes/i).first()).toBeVisible({ timeout: 8000 })
  })
})
