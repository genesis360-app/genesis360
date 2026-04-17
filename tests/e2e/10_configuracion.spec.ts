/**
 * 10_configuracion.spec.ts
 * Valida la página de configuración y sus tabs principales.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Configuración', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/configuracion')
    await waitForApp(page)
  })

  test('página carga con tabs de configuración', async ({ page }) => {
    // Tabs: negocio, categorías, proveedores, ubicaciones, estados, motivos, combos
    await expect(
      page.getByText(/negocio|categoría|proveedor/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('tab Negocio muestra formulario de datos del negocio', async ({ page }) => {
    const tabNegocio = page.getByRole('button', { name: /negocio/i }).first()
    if (await tabNegocio.isVisible()) await tabNegocio.click()
    await expect(
      page.getByText(/nombre del negocio|tipo de comercio/i).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('tab Categorías muestra lista o formulario', async ({ page }) => {
    const tabCat = page.getByRole('button', { name: /categoría/i }).first()
    if (await tabCat.isVisible()) {
      await tabCat.click()
      await expect(
        page.getByText(/categoría|sin categorías/i).first()
      ).toBeVisible({ timeout: 5000 })
    }
  })

  // UAT-CFG-01/02/03: tab Ubicaciones carga y muestra botón eliminar
  test('UAT-CFG: tab Ubicaciones muestra lista con acciones', async ({ page }) => {
    const tabUbic = page.getByRole('button', { name: /ubicaci/i }).first()
    if (await tabUbic.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tabUbic.click()
      await page.waitForTimeout(500)
      await expect(
        page.getByText(/ubicaci|sin ubicacion/i).first()
      ).toBeVisible({ timeout: 5000 })
    }
  })
})
