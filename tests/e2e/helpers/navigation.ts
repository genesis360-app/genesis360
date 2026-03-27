/**
 * Helpers de navegación y utilidades comunes para los tests E2E.
 */
import { Page, expect } from '@playwright/test'

/** Navega a una ruta y espera que el contenido principal cargue */
export async function goto(page: Page, path: string) {
  await page.goto(path)
  // Esperar que no haya spinner de carga
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
}

/** Espera que el layout esté listo. En páginas con sidebar espera el aside; en otras espera networkidle. */
export async function waitForApp(page: Page) {
  const aside = page.locator('aside').first()
  const hasAside = await aside.isVisible().catch(() => false)
  if (hasAside) {
    await expect(aside).toBeVisible({ timeout: 10000 })
  } else {
    // Páginas sin AppLayout (ej: /suscripcion): esperar que haya contenido visible
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  }
}

/** Genera un string único para nombres de test (evita colisiones entre corridas) */
export function uniqueName(prefix: string) {
  return `${prefix}_test_${Date.now()}`
}
