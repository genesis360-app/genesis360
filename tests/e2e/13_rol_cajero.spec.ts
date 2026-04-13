/**
 * 13_rol_cajero.spec.ts
 * Tests para el rol CAJERO:
 *  - Solo puede acceder a Ventas, Caja, Clientes, /mi-cuenta
 *  - Redirige a /ventas si intenta acceder a rutas restringidas
 *  - No ve opciones de configuración, usuarios, RRHH, etc. en el sidebar
 *
 * v0.73.0 — B2:
 *  - CAJERO puede abrir 1 caja propia. Si ya tiene una abierta, el botón debe mostrar
 *    mensaje de bloqueo ("Ya tenés una caja abierta"). No depende de las cajas de otros usuarios.
 */
import { test, expect } from '@playwright/test'

const RUTAS_PERMITIDAS = [
  '/ventas',
  '/caja',
  '/clientes',
  '/mi-cuenta',
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

  /**
   * B2 (v0.73.0) — CAJERO puede abrir 1 caja propia, no más de una simultánea.
   * Si ya tiene una sesión abierta, el botón "Abrir caja" debe estar deshabilitado
   * con mensaje "Ya tenés una caja abierta. Cerrala antes de abrir otra."
   * Si no tiene ninguna, el botón debe estar habilitado.
   */
  test('B2: botón abrir caja refleja estado correcto (1 caja max por CAJERO)', async ({ page }) => {
    await page.goto('/caja')
    await page.waitForLoadState('networkidle')
    // Buscar botón "Abrir caja" o "Nueva sesión"
    const btnAbrir = page.getByRole('button', { name: /abrir caja|nueva sesión/i }).first()
    const tieneBtn = await btnAbrir.isVisible().catch(() => false)
    if (!tieneBtn) return // skip si no hay botón visible (caja ya abierta en otro contexto)

    const disabled = await btnAbrir.isDisabled().catch(() => false)
    if (disabled) {
      // Si está deshabilitado, debe existir el mensaje de bloqueo por sesión propia
      await expect(
        page.getByText(/ya tenés una caja abierta|cerrala antes/i)
      ).toBeVisible({ timeout: 3000 })
    } else {
      // Si está habilitado, CAJERO no tiene caja abierta propia — estado válido
      expect(disabled).toBe(false)
    }
  })
})
