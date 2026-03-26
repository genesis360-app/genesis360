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

/** Espera que el sidebar esté visible (indica que el layout está listo) */
export async function waitForApp(page: Page) {
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 })
}

/** Genera un string único para nombres de test (evita colisiones entre corridas) */
export function uniqueName(prefix: string) {
  return `${prefix}_test_${Date.now()}`
}
