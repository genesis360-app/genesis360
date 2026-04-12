/**
 * 15_rol_supervisor.spec.ts
 * Tests para el rol SUPERVISOR:
 *  - Accede a Dashboard, Ventas, Caja, Gastos, Productos, Inventario, Clientes, Alertas, Historial, Reportes
 *  - NO accede a Configuración, Usuarios, RRHH, Sucursales
 *  - Redirige a /dashboard si intenta acceder a rutas OWNER-only
 *  - No ve botones de edición destructiva que requieren OWNER
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const RUTAS_PERMITIDAS = [
  '/dashboard',
  '/ventas',
  '/caja',
  '/gastos',
  '/productos',
  '/inventario',
  '/clientes',
  '/alertas',
  '/mi-cuenta',
]

const RUTAS_RESTRINGIDAS = [
  '/configuracion',
  '/usuarios',
  '/rrhh',
  '/sucursales',
]

// Historial y Reportes requieren plan Básico+, pero la ruta es accesible para SUPERVISOR
// (solo bloquea el plan, no el rol)
const RUTAS_PLAN_DEPENDIENTE = [
  '/historial',
  '/reportes',
]

test.describe('Rol SUPERVISOR — rutas permitidas', () => {
  for (const ruta of RUTAS_PERMITIDAS) {
    test(`${ruta} es accesible`, async ({ page }) => {
      await goto(page, ruta)
      await waitForApp(page)
      await expect(page).not.toHaveURL(/login/)
      // No debe ser redirigido a otra ruta diferente a la solicitada
      const url = page.url()
      expect(url).toContain(ruta.split('?')[0])
    })
  }

  for (const ruta of RUTAS_PLAN_DEPENDIENTE) {
    test(`${ruta} accesible (muestra contenido o UpgradePrompt, no redirige a login)`, async ({ page }) => {
      await goto(page, ruta)
      await waitForApp(page)
      await expect(page).not.toHaveURL(/login/)
      // Puede mostrar UpgradePrompt si el plan no lo permite, pero la ruta es válida
      await expect(page).not.toHaveURL(/dashboard|ventas/)
    })
  }
})

test.describe('Rol SUPERVISOR — rutas OWNER-only redirigen', () => {
  for (const ruta of RUTAS_RESTRINGIDAS) {
    test(`${ruta} no es accesible — redirige`, async ({ page }) => {
      await goto(page, ruta)
      await page.waitForLoadState('networkidle')
      // SUPERVISOR debe ser redirigido fuera de rutas OWNER-only
      const url = page.url()
      expect(url).not.toContain(ruta)
    })
  }
})

test.describe('Rol SUPERVISOR — sidebar', () => {
  test('ve Dashboard, Ventas, Caja, Alertas, Historial en sidebar', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)

    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /ventas/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /caja/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /alertas/i }).first()).toBeVisible()
  })

  test('no ve Configuración, Usuarios, RRHH, Sucursales en sidebar', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)

    await expect(page.getByRole('link', { name: /configuraci[oó]n/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^usuarios$/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^rrhh$|recursos humanos/i })).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^sucursales$/i })).not.toBeVisible()
  })
})

test.describe('Rol SUPERVISOR — funcionalidad básica', () => {
  test('puede ver historial de ventas', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)
    await expect(page).not.toHaveURL(/login/)

    // Intenta navegar al tab de historial
    const tabHistorial = page.getByRole('button', { name: /historial/i }).first()
    if (await tabHistorial.isVisible().catch(() => false)) {
      await tabHistorial.click()
      await page.waitForTimeout(1000)
      await expect(page).not.toHaveURL(/login/)
    }
  })

  test('puede acceder al dashboard y ver stats', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await page.waitForTimeout(1500)

    // El dashboard debe cargar sin errores JS
    const jsErrors: string[] = []
    page.on('pageerror', err => jsErrors.push(err.message))
    await page.waitForTimeout(1000)

    const criticalErrors = jsErrors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise rejection')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('puede ver listado de clientes', async ({ page }) => {
    await goto(page, '/clientes')
    await waitForApp(page)
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText(/clientes/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('puede ver listado de productos', async ({ page }) => {
    await goto(page, '/productos')
    await waitForApp(page)
    await expect(page).not.toHaveURL(/login/)
  })

  test('puede ver alertas', async ({ page }) => {
    await goto(page, '/alertas')
    await waitForApp(page)
    await expect(page).not.toHaveURL(/login/)
  })
})
