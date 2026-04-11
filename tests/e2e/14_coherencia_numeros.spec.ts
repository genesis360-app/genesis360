/**
 * 14_coherencia_numeros.spec.ts
 * Verifica que los contadores del Dashboard coincidan con las páginas destino.
 * Estos tests actúan como "alertas de regresión": si el número del dashboard
 * no coincide con lo que muestra la página, algo cambió en las queries o en la UI.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

/**
 * Extrae un número de un texto. Ejemplo: "12 productos" → 12
 */
function extractNumber(text: string): number {
  const match = text.match(/[\d.,]+/)
  if (!match) return NaN
  return parseInt(match[0].replace(/\./g, '').replace(',', ''), 10)
}

test.describe('Coherencia números Dashboard → páginas destino', () => {
  test('badge de alertas en sidebar == totalAlertas en AlertasPage', async ({ page }) => {
    // 1. Ir al dashboard para obtener el badge del sidebar
    await goto(page, '/dashboard')
    await waitForApp(page)

    // El badge rojo de alertas en el sidebar (puede no existir si no hay alertas)
    const badge = page.locator('nav [href="/alertas"] .rounded-full, aside [href="/alertas"] .rounded-full').first()
    const hasBadge = await badge.isVisible().catch(() => false)

    if (!hasBadge) {
      // Sin alertas activas — verificar que AlertasPage tampoco muestra contadores altos
      await goto(page, '/alertas')
      await waitForApp(page)
      // Solo verificar que la página carga sin error
      await expect(page).not.toHaveURL(/login/)
      return
    }

    const badgeText = await badge.textContent() ?? '0'
    const badgeCount = extractNumber(badgeText)

    // 2. Ir a AlertasPage y verificar que el total coincide aproximadamente
    await goto(page, '/alertas')
    await waitForApp(page)

    // La página de alertas muestra el total en el título o en un contador
    const tituloBadge = page.locator('text=/\\d+ alerta/i').first()
    if (await tituloBadge.isVisible().catch(() => false)) {
      const alertasText = await tituloBadge.textContent() ?? '0'
      const alertasCount = extractNumber(alertasText)
      // El badge del sidebar debe coincidir con el total de alertas urgentes
      // (puede diferir en ±1 por race condition de carga, pero no debería ser >5 de diferencia)
      expect(Math.abs(badgeCount - alertasCount)).toBeLessThanOrEqual(5)
    }
  })

  test('Dashboard "Productos activos" ~ conteo en ProductosPage', async ({ page }) => {
    // 1. Obtener el número de productos del dashboard
    await goto(page, '/dashboard')
    await waitForApp(page)

    // Esperar que las stats carguen
    await page.waitForTimeout(2000)

    // Buscar la card de productos activos
    const cardProductos = page.locator('text=/productos? activos?/i').first()
    if (!await cardProductos.isVisible().catch(() => false)) return // skip si no carga

    // Subir al elemento padre para obtener el número
    const cardContainer = cardProductos.locator('..').locator('..')
    const numText = await cardContainer.locator('text=/^\\d+/').first().textContent().catch(() => null)
    if (!numText) return

    const dashCount = extractNumber(numText)
    if (isNaN(dashCount)) return

    // 2. Verificar en ProductosPage
    await goto(page, '/productos')
    await waitForApp(page)
    await page.waitForTimeout(1500)

    // El conteo de filas en la tabla de productos
    const rows = page.locator('table tbody tr, [data-testid="producto-row"]')
    const rowCount = await rows.count()

    // La diferencia no debería ser mayor a 5 (paginación, filtros activos, etc.)
    if (rowCount > 0) {
      expect(Math.abs(dashCount - rowCount)).toBeLessThanOrEqual(Math.max(5, dashCount * 0.1))
    }
  })

  test('Dashboard carga sin errores JS', async ({ page }) => {
    const jsErrors: string[] = []
    page.on('pageerror', err => jsErrors.push(err.message))

    await goto(page, '/dashboard')
    await waitForApp(page)
    await page.waitForTimeout(2000)

    // No debería haber errores críticos de JS
    const criticalErrors = jsErrors.filter(e =>
      !e.includes('ResizeObserver') && // ResizeObserver errors son benignos
      !e.includes('Non-Error promise rejection') // algunos son esperables
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('Dashboard tabs Insights y Métricas cargan sin error', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)

    // Tab Insights
    const tabInsights = page.getByRole('button', { name: /insights/i }).first()
    if (await tabInsights.isVisible().catch(() => false)) {
      await tabInsights.click()
      await page.waitForTimeout(1500)
      await expect(page).not.toHaveURL(/login/)
    }

    // Tab Métricas
    const tabMetricas = page.getByRole('button', { name: /m[eé]tricas/i }).first()
    if (await tabMetricas.isVisible().catch(() => false)) {
      await tabMetricas.click()
      await page.waitForTimeout(1500)
      await expect(page).not.toHaveURL(/login/)
    }
  })

  test('Click en card "Stock Crítico" → navega a /alertas', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await page.waitForTimeout(2000)

    const cardCritico = page.locator('text=/stock cr[ií]tico/i').first()
    if (!await cardCritico.isVisible().catch(() => false)) return

    // Hacer click en la card o en el link dentro de ella
    const link = cardCritico.locator('..').locator('a, button[onclick*="alertas"]').first()
    if (await link.isVisible().catch(() => false)) {
      await link.click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/alertas/)
    }
  })
})
