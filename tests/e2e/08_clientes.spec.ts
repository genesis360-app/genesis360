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
