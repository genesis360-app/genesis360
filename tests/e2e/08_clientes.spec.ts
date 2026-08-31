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
      // Debe aparecer texto que incluya "dni" en la descripción de columnas
      await expect(
        page.getByText(/dni/i).first()
      ).toBeVisible({ timeout: 5000 })
      await page.keyboard.press('Escape')
    }
  })

  test('crear y dar de baja cliente de prueba', async ({ page }) => {
    const nombre = uniqueName('Cliente Test')
    // v1.51 — Nombre, DNI y Teléfono son obligatorios. DNI 7-8 dígitos único; tel 8-11 dígitos.
    const dni = String(Date.now()).slice(-8)
    const telefono = '11 ' + String(Date.now()).slice(-8)

    await page.getByRole('button', { name: /nuevo cliente/i }).click()

    await page.getByPlaceholder(/nombre completo|razón social/i).first().fill(nombre)
    await page.getByPlaceholder(/30123456|ej: 30/i).first().fill(dni)
    await page.getByPlaceholder(/1234-5678|ej: \+54/i).first().fill(telefono)

    await page.getByRole('button', { name: 'Crear cliente', exact: true }).click()

    // Buscar el cliente recién creado
    const buscador = page.getByPlaceholder(/buscar/i).first()
    if (await buscador.isVisible().catch(() => false)) {
      await buscador.fill(nombre)
    }
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 8000 })

    // Soft-delete (A6/A5 Supervisión): botón "Dar de baja" en la fila → modal → confirmar. Desde
    // v1.188.0 esto ya NO ejecuta la baja directo — crea una solicitud pendiente de aprobación
    // (toda eliminación permanente pasa por Supervisión, ver relevamiento de Fede 2026-08-20).
    const btnBaja = page.getByRole('button', { name: /dar de baja/i }).first()
    if (await btnBaja.isVisible().catch(() => false)) {
      await btnBaja.click()
      // El confirm del modal es el último botón "Dar de baja"
      const confirmar = page.getByRole('button', { name: /dar de baja/i }).last()
      await confirmar.click()
      await expect(page.getByText(/pendiente de aprobación/i)).toBeVisible({ timeout: 8000 })

      // El cliente sigue activo — la baja NO se ejecutó todavía.
      await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 5000 })

      // Ir a la pestaña Autorizaciones (usuario de prueba es DUEÑO → siempre puede supervisar) y
      // aprobar la solicitud recién creada.
      await page.getByRole('button', { name: 'Autorizaciones' }).click()
      await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 8000 })
      await page.getByRole('button', { name: /aprobar/i }).first().click()
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
      await expect(page.getByText(/baja aprobada/i)).toBeVisible({ timeout: 8000 })

      // Volver a la lista: el cliente ya no aparece entre los activos (baja ejecutada de verdad).
      await page.getByRole('button', { name: 'Clientes', exact: true }).click()
      await expect(page.getByText(nombre).first()).not.toBeVisible({ timeout: 8000 })
    }
  })
})
