/**
 * 105_importador_precio_uom_mutante.spec.ts
 * E2E MUTANTE — Importador con precio por presentación (rediseño UoM Fase 2, mig 304). Reemplaza
 * el modelo de ancla (estr_precio_ancla / nivel_precio_orden, eliminado). Ahora precio_venta del
 * importador es SIEMPRE por unidad base, y las columnas estr_precio_venta_caja/pallet son overrides
 * de esas presentaciones. El trigger trg_pp_sync_niveles construye producto_presentaciones.
 *
 * Sube un .xlsx (en memoria, sin fixture en disco) con 3 filas:
 *  A) override PROPIO en la Caja (estr_precio_venta_caja/costo_caja) — persiste tal cual, NO
 *     recalculado; y producto_presentaciones queda con ese override en la Caja.
 *  B) SIN override de Caja — la Caja deriva del precio base × factor (override NULL en la
 *     presentación) — misma regla que el POS y ProductoFormPage.
 *  C) precio de Caja NEGATIVO — debe rechazarse en la previsualización y NUNCA crearse en DB.
 *
 * Genera su propia precondición (SKUs con timestamp, no depende de fixtures de DEV).
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Importador de productos — precio por presentación (mutante)', () => {
  test('override de Caja persiste + Caja sin override deriva del base + precio negativo rechazado', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const nombreA = `E2E Import PrecioProp ${ts}`, skuA = `E2E-IMP-A-${ts}`
    const nombreB = `E2E Import Deriva ${ts}`, skuB = `E2E-IMP-B-${ts}`
    const nombreC = `E2E Import Negativo ${ts}`, skuC = `E2E-IMP-C-${ts}`

    const rows = [
      {
        nombre: nombreA, sku: skuA,
        precio_costo: 60, precio_costo_moneda: 'ARS',
        precio_venta: 100, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_unidades_por_caja: 12,
        estr_precio_venta_caja: 1080, estr_precio_costo_caja: 650,
      },
      {
        nombre: nombreB, sku: skuB,
        precio_costo: 60, precio_costo_moneda: 'ARS',
        precio_venta: 100, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_unidades_por_caja: 12,   // sin override de Caja → deriva 100×12
      },
      {
        nombre: nombreC, sku: skuC,
        precio_costo: 10, precio_costo_moneda: 'ARS',
        precio_venta: 20, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_unidades_por_caja: 12,
        estr_precio_venta_caja: -5,   // inválido: precio de Caja negativo
      },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Productos')
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    await goto(page, '/productos/importar')
    await waitForApp(page)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'import-precio-uom.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })

    // Previsualización: 2 nuevos + 1 con error (precio de Caja negativo)
    await expect(page.getByText(skuA)).toBeVisible({ timeout: 10000 })
    const nuevosCount = page.locator('xpath=//p[contains(text(),"Nuevos")]/preceding-sibling::p[1]')
    const erroresCount = page.locator('xpath=//p[contains(text(),"Con errores")]/preceding-sibling::p[1]')
    await expect(nuevosCount).toHaveText('2')
    await expect(erroresCount).toHaveText('1')

    const filaC = page.locator('tr', { hasText: skuC })
    await expect(filaC).toContainText(/no puede ser negativo/)

    // Confirmar — solo A y B deben crearse (C quedó afuera del batch en la previsualización)
    await page.getByRole('button', { name: /Confirmar \(/ }).click()
    await expect(page.getByText(/2 creados · 0 actualizados · 0 errores/)).toBeVisible({ timeout: 15000 })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // C) NUNCA se creó — la validación bloqueó la fila con precio negativo
    const prodCRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuC}&select=id`, { headers })
    expect((await prodCRes.json()) as unknown[], '[105] la fila con precio negativo NO debería haber creado un producto').toHaveLength(0)

    // A) override de la Caja persiste TAL CUAL (no 12×100=1200) + presentaciones con ese override
    const prodARes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuA}&select=id`, { headers })
    const [prodA] = (await prodARes.json()) as Array<{ id: string }>
    expect(prodA, '[105] no se encontró el producto A por REST').toBeTruthy()
    const presARes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prodA.id}&order=orden&select=es_base,factor_base,precio_venta,precio_costo`,
      { headers },
    )
    const presA = (await presARes.json()) as Array<{ es_base: boolean; factor_base: number; precio_venta: number | null; precio_costo: number | null }>
    expect(presA, '[105] el trigger debería haber creado 2 presentaciones para A').toHaveLength(2)
    expect(presA[0].es_base, '[105] la primera presentación de A es la base').toBe(true)
    expect(presA[0].precio_venta, '[105] la base nunca lleva override (el precio vive en productos)').toBeNull()
    expect(Number(presA[1].factor_base)).toBe(12)
    expect(Number(presA[1].precio_venta), '[105] la Caja de A guarda su override 1080, no 12×100').toBe(1080)
    expect(Number(presA[1].precio_costo)).toBe(650)

    // B) Caja SIN override → override NULL en la presentación (deriva del precio base × factor)
    const prodBRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuB}&select=id,precio_venta`, { headers })
    const [prodB] = (await prodBRes.json()) as Array<{ id: string; precio_venta: number }>
    expect(prodB, '[105] no se encontró el producto B por REST').toBeTruthy()
    expect(Number(prodB.precio_venta), '[105] B mantiene su precio base 100').toBe(100)
    const presBRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_presentaciones?producto_id=eq.${prodB.id}&order=orden&select=es_base,factor_base,precio_venta`,
      { headers },
    )
    const presB = (await presBRes.json()) as Array<{ es_base: boolean; factor_base: number; precio_venta: number | null }>
    expect(presB).toHaveLength(2)
    expect(presB[1].precio_venta, '[105] la Caja de B no tiene override — deriva del base (100×12=1200)').toBeNull()
    expect(Number(presB[1].factor_base)).toBe(12)
  })
})
