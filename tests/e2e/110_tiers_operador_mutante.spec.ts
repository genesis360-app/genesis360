/**
 * 110_tiers_operador_mutante.spec.ts
 * E2E MUTANTE — Tiers de precio mayorista con OPERADOR (rediseño UoM Fase 2-bis, mig 306).
 * Fede pidió un operador por regla ('>','<','=','>=','<=') + orden de evaluación (gana el primer
 * match). El migration-reviewer marcó que si la ficha NO persiste `operador`/`orden`, el fix se
 * revierte solo en el primer guardado de cualquier producto → este spec blinda esa persistencia.
 *
 * Crea un producto, carga 2 tiers desde la ficha (uno '=' y uno '>=') en un orden concreto, guarda,
 * y verifica en DB (REST) que quedaron con el operador correcto y `orden` = posición en el form.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Tiers de precio mayorista con operador (mutante)', () => {
  test('la ficha persiste operador + orden por posición', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E TierOperador ${Date.now()}`

    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(() => {})

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`, { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[110] no se encontró el producto recién creado').toBeTruthy()

    // Editar → abrir "Precios mayoristas" (modo avanzado)
    await goto(page, `/productos/${prod.id}/editar`)
    await waitForApp(page)
    const toggle = page.getByText('Precios mayoristas', { exact: true })
    await expect(toggle, '[110] la sección de precios mayoristas requiere modo avanzado').toBeVisible({ timeout: 8000 })
    await toggle.click()

    const agregarTier = page.getByRole('button', { name: /Agregar tier/i })

    const operadorSelect = page.locator('select[title^="Operador de la regla"]')

    // Tier 1 (fila 0): operador "=" exacto 100 → $70
    await agregarTier.click()
    await expect(operadorSelect).toHaveCount(1)
    await operadorSelect.nth(0).selectOption('=')
    await page.getByPlaceholder('Cant.').nth(0).fill('100')
    await page.getByPlaceholder('Precio').nth(0).fill('70')

    // Tier 2 (fila 1): operador ">=" (default) 50 → $80
    await agregarTier.click()
    await expect(operadorSelect).toHaveCount(2)
    await page.getByPlaceholder('Cant.').nth(1).fill('50')
    await page.getByPlaceholder('Precio').nth(1).fill('80')

    await page.getByRole('button', { name: /Guardar cambios|Guardar producto/i }).first().click()
    // El toast de éxito aparece ANTES de que termine el sync de tiers — hay que esperar el navigate
    // final a /productos (que ocurre tras persistir los tiers) para evitar una race en la query REST.
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 })

    // POSITIVO en DB: los 2 tiers con su operador y orden = posición del form
    const tiersRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_precios_mayorista?producto_id=eq.${prod.id}&order=orden&select=cantidad_minima,precio,operador,orden`,
      { headers },
    )
    const tiers = (await tiersRes.json()) as Array<{ cantidad_minima: number; precio: number; operador: string; orden: number }>
    expect(tiers, '[110] deberían haberse guardado 2 tiers').toHaveLength(2)
    // orden 0 = primera fila del form ('=' 100 → 70)
    expect(tiers[0].orden).toBe(0)
    expect(tiers[0].cantidad_minima).toBe(100)
    expect(tiers[0].operador, '[110] la primera fila era operador "="').toBe('=')
    expect(Number(tiers[0].precio)).toBe(70)
    // orden 1 = segunda fila ('>=' 50 → 80)
    expect(tiers[1].orden).toBe(1)
    expect(tiers[1].cantidad_minima).toBe(50)
    expect(tiers[1].operador).toBe('>=')
    expect(Number(tiers[1].precio)).toBe(80)
  })
})
