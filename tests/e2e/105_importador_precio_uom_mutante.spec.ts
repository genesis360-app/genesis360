/**
 * 105_importador_precio_uom_mutante.spec.ts
 * E2E MUTANTE — Importador con estructura de empaque (rediseño UoM Fase 2-bis, mig 307). El
 * empaque es LOGÍSTICA PURA, sin precio propio: el importador ya NO acepta columnas de precio por
 * presentación (estr_precio_*, eliminadas). precio_venta/precio_costo del importador son SIEMPRE
 * por unidad base; la Caja cobra precio_base × factor. El trigger trg_pp_sync_niveles construye
 * producto_presentaciones con el árbol genealógico (padre_linea_id).
 *
 * Sube un .xlsx (en memoria, sin fixture en disco) con 3 filas:
 *  A) producto con estructura Unidad→Caja ×12 — se crea + producto_presentaciones queda con el
 *     árbol (base padre NULL, Caja → base), sin columnas de precio.
 *  B) producto simple sin estructura — se crea con su precio base.
 *  C) precio_venta del producto NEGATIVO — se rechaza en la previsualización, nunca se crea.
 *
 * Genera su propia precondición (SKUs con timestamp, no depende de fixtures de DEV).
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Importador de productos — estructura sin precio de empaque (mutante)', () => {
  test('importa estructura Unidad→Caja (empaque sin precio) + árbol construido + precio negativo rechazado', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const nombreA = `E2E Import Estructura ${ts}`, skuA = `E2E-IMP-A-${ts}`
    const nombreB = `E2E Import Simple ${ts}`, skuB = `E2E-IMP-B-${ts}`
    const nombreC = `E2E Import Negativo ${ts}`, skuC = `E2E-IMP-C-${ts}`

    const rows = [
      {
        nombre: nombreA, sku: skuA,
        precio_costo: 60, precio_costo_moneda: 'ARS',
        precio_venta: 100, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_unidades_por_caja: 12,   // estructura Unidad→Caja; la Caja cobra 100×12 (sin override)
      },
      {
        nombre: nombreB, sku: skuB,
        precio_costo: 60, precio_costo_moneda: 'ARS',
        precio_venta: 100, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
      },
      {
        nombre: nombreC, sku: skuC,
        precio_costo: 10, precio_costo_moneda: 'ARS',
        precio_venta: -5, precio_venta_moneda: 'ARS',   // inválido: precio de venta del producto negativo
        unidad_medida: 'unidad',
      },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Productos')
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    await goto(page, '/productos/importar')
    await waitForApp(page)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'import-estructura-uom.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })

    // Previsualización: 2 nuevos + 1 con error (precio de venta negativo)
    await expect(page.getByText(skuA)).toBeVisible({ timeout: 10000 })
    const nuevosCount = page.locator('xpath=//p[contains(text(),"Nuevos")]/preceding-sibling::p[1]')
    const erroresCount = page.locator('xpath=//p[contains(text(),"Con errores")]/preceding-sibling::p[1]')
    await expect(nuevosCount).toHaveText('2')
    await expect(erroresCount).toHaveText('1')

    const filaC = page.locator('tr', { hasText: skuC })
    await expect(filaC).toContainText(/Precio venta inválido/)

    // Confirmar — solo A y B deben crearse (C quedó afuera del batch en la previsualización)
    await page.getByRole('button', { name: /Confirmar \(/ }).click()
    await expect(page.getByText(/2 creados · 0 actualizados · 0 errores/)).toBeVisible({ timeout: 15000 })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // C) NUNCA se creó — la validación bloqueó la fila con precio negativo
    const prodCRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuC}&select=id`, { headers })
    expect((await prodCRes.json()) as unknown[], '[105] la fila con precio negativo NO debería haber creado un producto').toHaveLength(0)

    // A) estructura creada → producto_presentaciones con el ÁRBOL genealógico (mig 307), sin precio
    const prodARes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuA}&select=id`, { headers })
    const [prodA] = (await prodARes.json()) as Array<{ id: string }>
    expect(prodA, '[105] no se encontró el producto A por REST').toBeTruthy()
    const presARes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prodA.id}&order=orden&select=es_base,factor_base,padre_linea_id,id`,
      { headers },
    )
    const presA = (await presARes.json()) as Array<{ es_base: boolean; factor_base: number; padre_linea_id: string | null; id: string }>
    expect(presA, '[105] el trigger debería haber creado 2 presentaciones para A').toHaveLength(2)
    expect(presA[0].es_base, '[105] la primera presentación de A es la base').toBe(true)
    expect(presA[0].padre_linea_id, '[105] la base es la raíz del árbol (padre NULL)').toBeNull()
    expect(Number(presA[1].factor_base), '[105] la Caja = 12 unidades base').toBe(12)
    expect(presA[1].padre_linea_id, '[105] la Caja apunta a la base como padre').toBe(presA[0].id)
    // La columna de precio ya NO existe en el select → empaque sin precio propio
    expect(presA[1]).not.toHaveProperty('precio_venta')

    // B) producto simple se creó con su precio base intacto
    const prodBRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuB}&select=id,precio_venta`, { headers })
    const [prodB] = (await prodBRes.json()) as Array<{ id: string; precio_venta: number }>
    expect(prodB, '[105] no se encontró el producto B por REST').toBeTruthy()
    expect(Number(prodB.precio_venta), '[105] B mantiene su precio base 100').toBe(100)
  })
})
