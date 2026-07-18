/**
 * 90_producto_estado_predeterminado_mutante.spec.ts
 * E2E MUTANTE — "Estado de inventario predeterminado" (select de ProductoFormPage) persiste
 * al guardar la edición de un producto.
 *
 * Reproduce el bug real reportado por GO (2026-07-18): el payload de `handleSubmit` en
 * ProductoFormPage.tsx armaba `ubicacion_id` pero se olvidaba `estado_id` — el select se leía
 * bien del form y se mostraba, pero el UPDATE nunca lo mandaba a Supabase, así que el campo
 * quedaba en null en silencio pese al "Producto actualizado".
 *
 * Genera su propia precondición (crea un producto nuevo con nombre único). Requiere modo
 * avanzado (el bloque "Estado de inventario predeterminado" solo se muestra con WMS activo) —
 * el tenant e2e (Almacén Jorgito, DUEÑO) está en avanzado con estados_inventario ya sembrados.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Estado de inventario predeterminado persiste al guardar (mutante)', () => {
  test('elegir un estado en "Editar producto" y guardar lo persiste en la base', async ({ page, request }) => {
    const nombreProducto = `E2E EstadoDefault ${Date.now()}`

    // 1) Crear un producto nuevo (sin estado predeterminado todavía)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)

    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)

    const crear = page.getByRole('button', { name: /^Crear producto$/ })
    await expect(crear).toBeVisible({ timeout: 5000 })
    await crear.click()
    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })

    // 2) Buscar el id real por REST (evita depender de la fila de la lista/paginado)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const buscar = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,estado_id`,
      { headers },
    )
    expect(buscar.ok(), `[90] no se pudo buscar el producto recién creado: ${await buscar.text()}`).toBeTruthy()
    const [creado] = (await buscar.json()) as Array<{ id: string; estado_id: string | null }>
    expect(creado, `[90] el producto "${nombreProducto}" no aparece por REST tras crearlo`).toBeTruthy()
    expect(creado.estado_id, '[90] precondición: recién creado debería tener estado_id NULL').toBeNull()

    // 3) Ir a editarlo y elegir un "Estado de inventario predeterminado" real (no "Sin estado")
    await goto(page, `/productos/${creado.id}/editar`)
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Editar producto/i })).toBeVisible({ timeout: 8000 })

    const estadoSelect = page.locator(
      'xpath=//label[contains(.,"Estado de inventario predeterminado")]/following-sibling::select[1]',
    )
    await expect(estadoSelect).toBeVisible({ timeout: 8000 })
    const opciones = await estadoSelect.locator('option').evaluateAll(
      opts => (opts as HTMLOptionElement[]).map(o => ({ value: o.value, label: o.textContent })).filter(o => o.value),
    )
    expect(
      opciones.length,
      '[90] el tenant de prueba no tiene ningún estado_inventario activo — sembrar al menos uno en DEV',
    ).toBeGreaterThan(0)
    const elegido = opciones[0]
    await estadoSelect.selectOption(elegido.value)

    // 4) Guardar — este es el botón que GO reportó que "no guarda el estado que le puse"
    const guardar = page.getByRole('button', { name: /^Guardar cambios$/ })
    await expect(guardar).toBeVisible({ timeout: 5000 })
    await guardar.click()
    await expect(page.getByText(/Producto actualizado/i)).toBeVisible({ timeout: 10000 })

    // 5) POSITIVO — verificar en la base que quedó el estado elegido, no null
    const verif = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${creado.id}&select=estado_id`,
      { headers },
    )
    expect(verif.ok(), `[90] no se pudo releer el producto tras guardar: ${await verif.text()}`).toBeTruthy()
    const [tras] = (await verif.json()) as Array<{ estado_id: string | null }>
    expect(
      tras?.estado_id,
      `[90] "Guardar cambios" no persistió el estado predeterminado elegido (${elegido.label}) — quedó null`,
    ).toBe(elegido.value)

    // 6) Recargar la página de edición y confirmar que el select vuelve a mostrar el valor elegido
    await goto(page, `/productos/${creado.id}/editar`)
    await waitForApp(page)
    await expect(estadoSelect).toHaveValue(elegido.value, { timeout: 8000 })
  })
})
