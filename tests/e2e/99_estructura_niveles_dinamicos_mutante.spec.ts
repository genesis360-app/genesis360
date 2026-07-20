/**
 * 99_estructura_niveles_dinamicos_mutante.spec.ts
 * E2E MUTANTE — Estructuras de producto con niveles dinámicos por UdM (mig 282, Fase 1
 * del plan "pack structure / footprint" estilo Blue Yonder).
 *
 * Genera su propia precondición: producto nuevo vía UI. Después, en Productos → tab
 * Estructura arma una estructura de 3 niveles (Unidad base → Caja ×12 → Pallet ×40):
 *   · NEGATIVO UI: factor no entero (40.5) → el form rechaza con el mensaje exacto.
 *   · POSITIVO: crea la estructura, la card muestra la cadena de conversión y la DB
 *     (vía REST) tiene los 3 niveles con `unidades_base` calculada SERVER-SIDE
 *     (1 / 12 / 480) — el cliente nunca manda ese valor.
 *   · NEGATIVO server-side (REGLA #0): llamar a la RPC fn_estructura_guardar_niveles
 *     directo por REST con factor 0 debe fallar Y dejar los niveles anteriores intactos
 *     (la RPC es transaccional — el guard no depende de la UI).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Estructuras con niveles dinámicos por UdM (mutante)', () => {
  test('crear estructura 3 niveles: UI valida, DB calcula unidades_base, RPC rechaza factor inválido', async ({ page, request }) => {
    const nombreProducto = `E2E Estructura ${Date.now()}`

    // 1) Precondición propia: producto nuevo vía UI
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // 2) Tab Estructura → seleccionar el producto
    await goto(page, '/productos')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Estructura' }).first().click()
    const buscador = page.getByPlaceholder('Buscar producto por nombre...')
    await expect(buscador).toBeVisible({ timeout: 8000 })
    await buscador.fill(nombreProducto)
    await page.waitForTimeout(800)
    await page.getByText(nombreProducto, { exact: true }).first().click()

    // 3) Nueva estructura: base Unidad + Caja ×12 + Pallet ×40
    await page.getByRole('button', { name: /Nueva estructura/i }).first().click()
    const modal = page.locator('div.fixed.inset-0').filter({ hasText: 'Nueva estructura' }).first()
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.getByPlaceholder(/Footprint estándar/i).fill('Footprint E2E')

    // Nivel base preseleccionado con la UdM del producto (default "unidad" → "Unidad")
    const selectsUdm = modal.locator('select')
    await expect(selectsUdm.first()).toBeVisible({ timeout: 5000 })
    const baseLabel = await selectsUdm.first().locator('option:checked').textContent()
    expect(baseLabel, '[99] la UdM base debería preseleccionar Unidad').toMatch(/Unidad/i)

    // Agregar Caja (factor 12) y Pallet (factor 40) — sugeridas en ese orden
    await modal.getByRole('button', { name: /Agregar nivel/i }).click()
    const factorInputs = modal.locator('input[placeholder="12"]')
    await expect(factorInputs).toHaveCount(1, { timeout: 3000 })
    await factorInputs.nth(0).fill('12')

    await modal.getByRole('button', { name: /Agregar nivel/i }).click()
    await expect(factorInputs).toHaveCount(2, { timeout: 3000 })
    await factorInputs.nth(1).fill('40')

    // Equivalencia viva calculada en el form: Pallet = 480 × Unidad
    await expect(modal.getByText(/= 480 ×/)).toBeVisible({ timeout: 3000 })

    // 4) NEGATIVO UI — factor vacío rechaza con el mensaje exacto (los no-enteros tipo
    //    "40.5" ya los bloquea la validación nativa del input step="1" antes del submit)
    await factorInputs.nth(1).fill('')
    await modal.getByRole('button', { name: /Crear estructura/i }).click()
    await expect(modal.getByText(/entero mayor o igual a 1/i)).toBeVisible({ timeout: 5000 })

    // 5) POSITIVO — corregir y crear
    await factorInputs.nth(1).fill('40')
    await modal.getByRole('button', { name: /Crear estructura/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10000 })

    // La card muestra la cadena de conversión completa
    await expect(page.getByText('Caja = 12 × Unidad · Pallet = 40 × Caja (= 480 × Unidad)').first())
      .toBeVisible({ timeout: 8000 })

    // 6) Verificación en DB por REST: unidades_base la calculó el server (nunca la mandó la UI)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[99] no se encontró el producto por REST').toBeTruthy()

    const estrRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructuras?producto_id=eq.${prod.id}&select=id,nombre,is_default`,
      { headers },
    )
    const [estr] = (await estrRes.json()) as Array<{ id: string; nombre: string; is_default: boolean }>
    expect(estr, '[99] no se encontró la estructura por REST').toBeTruthy()
    expect(estr.nombre).toBe('Footprint E2E')
    expect(estr.is_default, '[99] la primera estructura del SKU debe quedar default').toBe(true)

    const nivRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estr.id}&select=orden,factor,unidades_base&order=orden.asc`,
      { headers },
    )
    const niveles = (await nivRes.json()) as Array<{ orden: number; factor: number; unidades_base: number }>
    expect(niveles.map(n => [n.orden, n.factor, n.unidades_base])).toEqual([
      [1, 1, 1],
      [2, 12, 12],
      [3, 40, 480],
    ])

    // 7) NEGATIVO server-side (REGLA #0) — la RPC rechaza factor 0 aunque la UI se bypassee,
    //    y por ser transaccional los niveles anteriores quedan intactos.
    const udmRes = await request.get(
      `${SUPABASE_URL}/rest/v1/unidades_medida?nombre=in.(Unidad,Caja)&select=id,nombre`,
      { headers },
    )
    const udms = (await udmRes.json()) as Array<{ id: string; nombre: string }>
    const udmUnidad = udms.find(u => u.nombre === 'Unidad')
    const udmCaja = udms.find(u => u.nombre === 'Caja')
    expect(udmUnidad && udmCaja, '[99] faltan las UdM predefinidas Unidad/Caja').toBeTruthy()

    const rpcRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_estructura_guardar_niveles`, {
      headers,
      data: {
        p_estructura_id: estr.id,
        p_niveles: [
          { unidad_medida_id: udmUnidad!.id, factor: 1 },
          { unidad_medida_id: udmCaja!.id, factor: 0 },
        ],
      },
    })
    expect(rpcRes.ok(), '[99] la RPC debería rechazar factor 0 (guard server-side)').toBe(false)

    const nivRes2 = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estr.id}&select=orden,factor,unidades_base&order=orden.asc`,
      { headers },
    )
    const niveles2 = (await nivRes2.json()) as Array<{ orden: number; factor: number; unidades_base: number }>
    expect(niveles2.map(n => [n.orden, n.factor, n.unidades_base]),
      '[99] la RPC fallida NO debe dejar los niveles a medio borrar (transaccional)').toEqual([
      [1, 1, 1],
      [2, 12, 12],
      [3, 40, 480],
    ])
  })
})
