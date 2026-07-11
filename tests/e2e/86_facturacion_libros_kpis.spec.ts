/**
 * 86_facturacion_libros_kpis.spec.ts
 * E2E READ-ONLY del módulo Facturación (panel de control + Libros IVA + Liquidación).
 *
 * Valida que las superficies de reporting fiscal RENDERIZAN con datos reales del tenant DEV
 * (Almacén Jorgito, facturación ON, con comprobantes de homologación emitidos por specs 21/42):
 *  1. Panel: los 3 KPIs (IVA Débito / IVA Crédito / Posición mensual) con montos.
 *  2. Libros IVA → Ventas: tabla con filas de comprobantes o vacío legítimo del período; el
 *     total del período visible. Si hay NC emitidas en el período, aparecen como filas
 *     negativas (v1.125.0 — hallazgo H1: antes las NC no restaban débito). Aserción
 *     condicional: si hay un badge NC-*, su IVA se muestra en la columna del libro.
 *  3. Libros IVA → Compras: renderiza (tabla o vacío) + total deducible.
 *  4. Liquidación: tabla de 12 meses con debito/credito/posición + sección retenciones.
 *
 * No muta nada. Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Facturación — panel, libros IVA y liquidación (read-only)', () => {
  test('panel de control muestra los 3 KPIs fiscales', async ({ page }) => {
    await goto(page, '/facturacion')
    await waitForApp(page)

    await expect(page.getByText('IVA Débito (Ventas)')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('IVA Crédito (Compras)')).toBeVisible()
    await expect(page.getByText('Posición mensual')).toBeVisible()
    // Los 3 KPIs renderizan un monto (formato $ …) — no NaN ni vacío
    const kpiCards = page.locator('p.text-3xl.font-bold')
    await expect(kpiCards.first()).toBeVisible({ timeout: 10000 })
    const textos = await kpiCards.allTextContents()
    expect(textos.length).toBeGreaterThanOrEqual(3)
    for (const t of textos) expect(t).toMatch(/\$\s?[\d.,]+/)
  })

  test('Libro IVA Ventas renderiza el período con su total (y NC en negativo si hay)', async ({ page }) => {
    await goto(page, '/facturacion')
    await waitForApp(page)

    await page.getByRole('button', { name: /Libros IVA/ }).click()
    await expect(page.getByRole('button', { name: /IVA Ventas \(Débito\)/ })).toBeVisible({ timeout: 8000 })
    // Total del período siempre visible (aunque sea $0)
    await expect(page.getByText(/Total IVA período:/)).toBeVisible({ timeout: 10000 })
    // Nota de alcance fiscal (H3): los libros son por CUIT, sin filtro de sucursal
    await expect(page.getByText(/libros IVA son del CUIT completo/i)).toBeVisible()

    // La tabla existe: o tiene filas de comprobantes o el vacío legítimo
    const vacio = page.getByText('Sin datos en el período')
    const filas = page.locator('tbody tr')
    await expect(filas.first()).toBeVisible({ timeout: 10000 })
    const esVacio = await vacio.isVisible().catch(() => false)
    if (!esVacio) {
      // Si hay NC emitidas en el período, sus filas muestran el badge NC-* y montos negativos.
      // (El locator de `has:` se evalúa RELATIVO a la fila — sin prefijo tbody.)
      const filaNc = page.locator('tbody tr')
        .filter({ has: page.locator('span', { hasText: /^NC-[ABC] #/ }) }).first()
      if (await filaNc.isVisible().catch(() => false)) {
        await expect(filaNc.locator('td', { hasText: /-[\d.,]+/ }).first()).toBeVisible()
      }
    }

    // Sub-tab Compras: renderiza total deducible
    await page.getByRole('button', { name: /IVA Compras \(Crédito\)/ }).click()
    await expect(page.getByText(/Deducible:/)).toBeVisible({ timeout: 10000 })
  })

  test('Liquidación muestra los últimos 12 meses y retenciones', async ({ page }) => {
    await goto(page, '/facturacion')
    await waitForApp(page)

    await page.getByRole('button', { name: /Liquidación/ }).click()
    await expect(page.getByText('IVA — Últimos 12 meses')).toBeVisible({ timeout: 8000 })
    // La tabla de 12 meses termina de cargar (12 filas: una por período)
    const filasMeses = page.locator('tbody tr')
    await expect(filasMeses.nth(11)).toBeVisible({ timeout: 30000 })
    // Cada posición dice "A pagar" o "A favor"
    await expect(page.locator('tbody td', { hasText: /A pagar|A favor/ }).first()).toBeVisible()
    await expect(page.getByText(/Retenciones y percepciones sufridas/)).toBeVisible()
  })
})
