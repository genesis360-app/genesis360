/**
 * 02_inventario.spec.ts
 * Valida el módulo de inventario (líneas de stock + LPNs) y el CRUD de productos.
 *
 * v1.51 — la página /inventario muestra LÍNEAS DE STOCK (tabs Inventario / Agregar stock /
 * Quitar stock / Kits / Conteos / Historial / Autorizaciones). El alta/baja de PRODUCTOS
 * (maestro) vive en /productos → /productos/nuevo (ProductoFormPage). Los tests se separan
 * en consecuencia.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Inventario (líneas de stock)', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/inventario')
    await waitForApp(page)
  })

  test('página carga y muestra tabla o mensaje vacío', async ({ page }) => {
    await expect(
      page.getByText(/producto|inventario|sin datos|no hay productos/i).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('buscador filtra resultados (estado vacío con término inexistente)', async ({ page }) => {
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (!await buscador.isVisible().catch(() => false)) return
    await buscador.fill('zzz_test_inexistente_xyz')
    // La búsqueda filtra client-side + puede pegar a la red; en máquinas lentas
    // el estado vacío tarda en aparecer. Timeout generoso.
    await expect(
      page.getByText(/no se encontraron|sin resultado|sin datos|no hay productos/i).first()
    ).toBeVisible({ timeout: 10000 })
    await buscador.clear()
  })

  // v1.51 — tabs de movimiento de stock (lo que antes era /movimientos, hoy huérfano)
  test('tabs Agregar stock y Quitar stock están presentes', async ({ page }) => {
    await expect(page.getByRole('button', { name: /agregar stock/i })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /quitar stock/i })).toBeVisible()
  })

  // v1.53 (mig 205) — traslados entre sucursales: tab + panel con CTA
  test('tab Traslados abre el panel de traslados entre sucursales', async ({ page }) => {
    await page.getByRole('button', { name: 'Traslados', exact: true }).click()
    await expect(
      page.getByText(/traslados entre sucursales/i).first()
    ).toBeVisible({ timeout: 8000 })
    // El owner (DUEÑO) debe ver el botón de crear
    await expect(page.getByRole('button', { name: /nuevo traslado/i })).toBeVisible()
  })
})

test.describe('Productos (maestro)', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/productos')
    await waitForApp(page)
  })

  test('página carga con botón Nuevo producto', async ({ page }) => {
    await expect(page.getByRole('button', { name: /nuevo producto/i }).first()).toBeVisible({ timeout: 8000 })
  })

  test('botón Nuevo producto abre el formulario', async ({ page }) => {
    await page.getByRole('button', { name: /nuevo producto/i }).first().click()
    // Navega a ProductoFormPage (heading "Nuevo producto" + campo nombre)
    await expect(
      page.getByPlaceholder(/tornillo/i).first()
    ).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: 'Crear producto', exact: true })).toBeVisible()
  })

  test('crear y eliminar producto de prueba', async ({ page }) => {
    const nombre = uniqueName('TESTPROD')

    await page.getByRole('button', { name: /nuevo producto/i }).first().click()

    // Solo el nombre es obligatorio (el SKU se autogenera si queda vacío)
    const nombreInput = page.getByPlaceholder(/tornillo/i).first()
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombre)
    await expect(nombreInput).toHaveValue(nombre)

    await page.getByRole('button', { name: 'Crear producto', exact: true }).click()

    // Vuelve a /productos
    await page.waitForURL('**/productos', { timeout: 12000 }).catch(() => {})
    await waitForApp(page)

    // Buscar el producto recién creado
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (await buscador.isVisible().catch(() => false)) {
      await buscador.fill(nombre)
      await page.waitForTimeout(800)
    }
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 10000 })

    // Cleanup best-effort: eliminar el producto (sin stock → eliminable).
    // Acepta confirm nativo si aparece.
    page.on('dialog', d => d.accept().catch(() => {}))
    const btnEliminar = page.getByRole('button', { name: /^eliminar$/i }).first()
    if (await btnEliminar.isVisible().catch(() => false)) {
      await btnEliminar.click()
      const confirm = page.getByRole('button', { name: /confirmar|aceptar|sí|eliminar/i }).last()
      if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirm.click().catch(() => {})
      }
      await page.waitForTimeout(800)
    }
  })
})
