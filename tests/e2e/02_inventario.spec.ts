/**
 * 02_inventario.spec.ts
 * Valida el módulo de inventario: listado, búsqueda y creación de producto.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Inventario', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
  })

  test('página carga y muestra tabla o mensaje vacío', async ({ page }) => {
    await expect(
      page.getByText(/producto|inventario|sin productos/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('buscador filtra resultados', async ({ page }) => {
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (await buscador.isVisible()) {
      await buscador.fill('zzz_test_inexistente')
      await page.waitForTimeout(500)
      // Debe mostrar estado vacío o cero resultados
      await expect(
        page.getByText(/sin resultado|no encontr|0 producto/i).first()
      ).toBeVisible({ timeout: 5000 })
      await buscador.clear()
    }
  })

  test('botón Nuevo Producto abre formulario', async ({ page }) => {
    const btn = page.getByRole('button', { name: /nuevo producto/i })
    await expect(btn).toBeVisible()
    await btn.click()
    // El modal/form debe aparecer
    await expect(
      page.getByText(/nombre|sku|precio/i).first()
    ).toBeVisible({ timeout: 5000 })
    // Cerrar con ESC
    await page.keyboard.press('Escape')
  })

  test('crear y eliminar producto de prueba', async ({ page }) => {
    const nombre = uniqueName('TEST')

    // Abrir formulario
    await page.getByRole('button', { name: /nuevo producto/i }).click()
    await page.waitForTimeout(300)

    // Completar nombre (campo obligatorio)
    const nombreInput = page.getByLabel(/nombre/i).first()
    await nombreInput.fill(nombre)

    // SKU opcional — completar para identificar fácilmente
    const skuInput = page.getByLabel(/sku/i).first()
    if (await skuInput.isVisible()) await skuInput.fill(`TST-${Date.now()}`)

    // Guardar
    await page.getByRole('button', { name: /guardar|crear|nuevo/i }).last().click()
    await page.waitForTimeout(1000)

    // El producto debe aparecer en la lista
    await expect(page.getByText(nombre)).toBeVisible({ timeout: 8000 })

    // Eliminar producto creado (buscar y borrar)
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (await buscador.isVisible()) {
      await buscador.fill(nombre)
      await page.waitForTimeout(500)
    }

    // Click en el botón de eliminar (puede ser un ícono/menú contextual)
    const fila = page.getByText(nombre).first()
    await fila.hover()
    const btnEliminar = page.getByRole('button', { name: /eliminar|delete/i }).first()
    if (await btnEliminar.isVisible()) {
      await btnEliminar.click()
      // Confirmar si hay diálogo
      const confirm = page.getByRole('button', { name: /confirmar|aceptar|sí/i })
      if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirm.click()
      }
      await page.waitForTimeout(1000)
    }
  })
})
