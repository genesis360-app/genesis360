/**
 * 08_clientes.spec.ts
 * Valida el módulo de clientes: listado y creación.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Clientes', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/clientes')
    await waitForApp(page)
  })

  test('página carga con botón de nuevo cliente', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /nuevo cliente/i })
    ).toBeVisible({ timeout: 8000 })
  })

  test('lista de clientes o estado vacío visible', async ({ page }) => {
    await expect(
      page.getByText(/cliente|sin clientes/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  // UAT-CLI-01: la sección de importación debe mencionar la columna dni
  test('UAT-CLI-01: sección de importación menciona columna dni', async ({ page }) => {
    // Abrir sección importación
    const btnImport = page.getByRole('button', { name: /importar|cargar/i }).first()
    if (await btnImport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btnImport.click()
      await page.waitForTimeout(400)
      // Debe aparecer texto que incluya "dni" en la descripción de columnas
      await expect(
        page.getByText(/dni/i).first()
      ).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    }
  })

  test('crear y eliminar cliente de prueba', async ({ page }) => {
    const nombre = uniqueName('Cliente Test')

    await page.getByRole('button', { name: /nuevo cliente/i }).click()
    await page.waitForTimeout(300)

    const nombreInput = page.getByPlaceholder(/nombre completo|razón social/i).first()
    await nombreInput.fill(nombre)

    await page.getByRole('button', { name: /guardar|crear/i }).last().click()
    await page.waitForTimeout(1000)

    await expect(page.getByText(nombre)).toBeVisible({ timeout: 8000 })

    // Buscar y eliminar
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (await buscador.isVisible()) {
      await buscador.fill(nombre)
      await page.waitForTimeout(500)
    }
    const fila = page.getByText(nombre).first()
    await fila.hover()
    const btnEliminar = page.getByRole('button', { name: /eliminar/i }).first()
    if (await btnEliminar.isVisible()) {
      await btnEliminar.click()
      const confirm = page.getByRole('button', { name: /confirmar|aceptar|sí/i })
      if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirm.click()
      }
      await page.waitForTimeout(1000)
    }
  })
})
