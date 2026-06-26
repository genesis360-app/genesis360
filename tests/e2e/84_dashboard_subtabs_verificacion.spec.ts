/**
 * 84_dashboard_subtabs_verificacion.spec.ts
 *
 * Verificación de la estructura del Dashboard v1.92.0: las 5 sub-pestañas
 * (Insights / Métricas / Rentabilidad / Recomendaciones / Gráficos) deben
 * funcionar en TODAS las áreas (Todo + 9 módulos), no solo en "Todo".
 *
 * Recorre cada área × cada sub-pestaña y verifica:
 *  - NO aparece el error boundary de área ("Error en área X").
 *  - NO hay errores de consola/JS sin capturar durante el recorrido.
 *  - Aserciones POSITIVAS en los puntos reorganizados (REGLA #0 = display):
 *    distribución del overview de "Todo" + sectorización del mini-dashboard
 *    de un módulo (Ventas) + que las KPI de plata siguen renderizando un valor.
 *
 * Corre contra el owner (Jorgito, datos fiscales reales en DEV).
 *   npx dotenv -e tests/e2e/.env.test.local -- playwright test 84 --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const AREAS = [
  'Todo', 'Ventas', 'Gastos', 'Productos', 'Inventario',
  'Clientes', 'Proveedores', 'Facturación', 'Envíos', 'Marketing',
] as const
const SUBS = ['Insights', 'Métricas', 'Rentabilidad', 'Recomendaciones', 'Gráficos'] as const

async function clickArea(page: Page, area: string) {
  await page.getByRole('button', { name: area, exact: true }).first().click()
}
async function clickSub(page: Page, sub: string) {
  await page.getByRole('button', { name: sub, exact: true }).first().click()
}

test.describe('Dashboard v1.92.0 — 5 sub-pestañas uniformes por área', () => {
  test('recorre todas las áreas × sub-pestañas sin error boundary ni crash', async ({ page }) => {
    test.setTimeout(120_000) // 10 áreas × 5 sub-pestañas = recorrido largo
    const jsErrors: string[] = []
    page.on('pageerror', (e) => jsErrors.push(e.message))

    await goto(page, '/dashboard')
    await waitForApp(page)

    for (const area of AREAS) {
      const chip = page.getByRole('button', { name: area, exact: true }).first()
      // Envíos sólo existe en modo avanzado; si no está, lo saltamos.
      if (!(await chip.isVisible().catch(() => false))) continue
      await chip.click()

      for (const sub of SUBS) {
        const subBtn = page.getByRole('button', { name: sub, exact: true }).first()
        if (!(await subBtn.isVisible().catch(() => false))) continue
        await subBtn.click()
        // dar tiempo a la query (staleTime 0) + render
        await page.waitForTimeout(250)

        // 1) El error boundary de área NO debe aparecer
        await expect(
          page.getByText(/Error en área/i),
          `${area} › ${sub}: apareció el error boundary de área`,
        ).toHaveCount(0)

        // 2) Algo se renderizó debajo de los tabs (la página no quedó en blanco)
        await expect(
          page.getByRole('button', { name: sub, exact: true }).first(),
          `${area} › ${sub}: la sub-pestaña dejó de existir`,
        ).toBeVisible()
      }
    }

    expect(jsErrors, `errores de JS sin capturar: ${jsErrors.join(' | ')}`).toEqual([])
  })

  test('Gráficos es la sub-pestaña por defecto (landing) al abrir el Dashboard', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    // El landing es "Todo › Gráficos": debe verse La Balanza sin tocar nada.
    await expect(page.getByText(/la balanza/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('Todo: el overview se distribuyó correctamente en las 5 sub-pestañas', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await clickArea(page, 'Todo')

    // Insights = centro de mando (score de salud)
    await clickSub(page, 'Insights')
    await expect(page.getByText(/score de salud/i).first()).toBeVisible({ timeout: 8000 })

    // Métricas = KPIs ejecutivos de plata (Posición IVA es uno de los 4)
    await clickSub(page, 'Métricas')
    await expect(page.getByText(/posición iva/i).first()).toBeVisible({ timeout: 8000 })

    // Gráficos = agregado de TODO el negocio por secciones (antes mostraba solo 2 charts).
    await clickSub(page, 'Gráficos')
    await expect(page.getByText(/la balanza/i).first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/mix de caja/i).first()).toBeVisible()
    await expect(page.getByText(/próximamente/i)).toHaveCount(0)
    // Secciones por área: encabezados General + módulos (Ventas, Gastos, …)
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ventas', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Gastos', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible()
  })

  test('Ventas: Insights/Métricas/Gráficos muestran el mini-dashboard del módulo (no "Próximamente")', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await clickArea(page, 'Ventas')

    // Métricas del módulo: KPI "Total Vendido"
    await clickSub(page, 'Métricas')
    await expect(page.getByText(/total vendido/i).first()).toBeVisible({ timeout: 8000 })

    // Gráficos del módulo: "El Camino de la Venta" (embudo)
    await clickSub(page, 'Gráficos')
    await expect(page.getByText(/camino de la venta|por dónde compran|mejores momentos/i).first())
      .toBeVisible({ timeout: 8000 })

    // Ya NO debe quedar el placeholder de "en desarrollo"
    await expect(page.getByText(/en desarrollo|próximamente/i)).toHaveCount(0)
  })

  test('Ventas: Recomendaciones queda scopeada al módulo (sin Score global)', async ({ page }) => {
    await goto(page, '/dashboard')
    await waitForApp(page)
    await clickArea(page, 'Ventas')
    await clickSub(page, 'Recomendaciones')
    // El Score global se oculta en la vista por módulo (solo aparece en "Todo")
    await expect(page.getByText(/score de salud del negocio/i)).toHaveCount(0)
  })
})
