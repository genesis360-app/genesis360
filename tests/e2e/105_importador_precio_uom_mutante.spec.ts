/**
 * 105_importador_precio_uom_mutante.spec.ts
 * E2E MUTANTE — Extiende ImportarProductosPage con precio por nivel de estructura y ancla de
 * precio (backlog Fede puntos 4/6/7, pendiente que quedó abierto tras v1.139/140/141.0 —
 * "extender el importador con precio por nivel").
 *
 * Sube un .xlsx (generado en memoria, sin depender de un archivo fixture en disco) con 3 filas:
 *  A) precio PROPIO en el nivel Caja (estr_precio_venta_caja/costo_caja) — sin ancla — debe
 *     persistir tal cual, NO recalculado como factor × precio de cabecera.
 *  B) ancla de precio en Caja por NOMBRE (estr_precio_ancla=Caja) SIN precio propio en el nivel
 *     — productos.nivel_precio_orden debe quedar en 2 y el nivel Caja sin precio propio (deriva
 *     del precio de cabecera, igual que el selector manual de ProductoFormPage — ver spec 102).
 *  C) ancla de precio en Pallet SIN datos de estructura de Pallet en la fila — debe rechazarse
 *     en la previsualización (validación client-side nueva) y NUNCA crearse en DB.
 *
 * Genera su propia precondición (SKUs con timestamp, no depende de fixtures de DEV).
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Importador de productos — precio por Unidad de Medida (mutante)', () => {
  test('precio propio por nivel + ancla por nombre + fila con ancla inválida rechazada', async ({ page, request }) => {
    test.setTimeout(90000)
    const ts = Date.now()
    const nombreA = `E2E Import PrecioProp ${ts}`, skuA = `E2E-IMP-A-${ts}`
    const nombreB = `E2E Import Ancla ${ts}`, skuB = `E2E-IMP-B-${ts}`
    const nombreC = `E2E Import AnclaInvalida ${ts}`, skuC = `E2E-IMP-C-${ts}`

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
        precio_costo: 650, precio_costo_moneda: 'ARS',
        precio_venta: 1080, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_unidades_por_caja: 12,
        estr_precio_ancla: 'Caja',
      },
      {
        nombre: nombreC, sku: skuC,
        precio_costo: 10, precio_costo_moneda: 'ARS',
        precio_venta: 20, precio_venta_moneda: 'ARS',
        unidad_medida: 'unidad',
        estr_precio_ancla: 'Pallet', // inválida: la fila no trae NINGÚN dato de estructura de Pallet
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

    // Previsualización: 2 nuevos + 1 con error (ancla en Pallet sin estructura de Pallet)
    await expect(page.getByText(skuA)).toBeVisible({ timeout: 10000 })
    const nuevosCount = page.locator('xpath=//p[contains(text(),"Nuevos")]/preceding-sibling::p[1]')
    const erroresCount = page.locator('xpath=//p[contains(text(),"Con errores")]/preceding-sibling::p[1]')
    await expect(nuevosCount).toHaveText('2')
    await expect(erroresCount).toHaveText('1')

    const filaC = page.locator('tr', { hasText: skuC })
    await expect(filaC).toContainText(/Ancla de precio en Pallet/)

    // Confirmar — solo A y B deben crearse (C quedó afuera del batch en la previsualización,
    // así que ni siquiera se intenta: el contador de "errores" del resultado final es 0, no 1 —
    // ese contador cuenta excepciones DURANTE el import, no filas ya rechazadas antes)
    await page.getByRole('button', { name: /Confirmar \(/ }).click()
    await expect(page.getByText(/2 creados · 0 actualizados · 0 errores/)).toBeVisible({ timeout: 15000 })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // C) NUNCA se creó — la validación bloqueó la fila con ancla inválida
    const prodCRes = await request.get(`${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuC}&select=id`, { headers })
    expect((await prodCRes.json()) as unknown[], '[105] la fila con ancla inválida NO debería haber creado un producto').toHaveLength(0)

    // A) precio propio del nivel Caja persiste TAL CUAL (no 12×100=1200)
    const prodARes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuA}&select=id,nivel_precio_orden`, { headers },
    )
    const [prodA] = (await prodARes.json()) as Array<{ id: string; nivel_precio_orden: number | null }>
    expect(prodA, '[105] no se encontró el producto A por REST').toBeTruthy()
    expect(prodA.nivel_precio_orden, '[105] A no especificó ancla — debe quedar en el default (NULL)').toBeNull()

    const estrARes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructuras?producto_id=eq.${prodA.id}&is_default=eq.true&select=id`, { headers },
    )
    const [estrA] = (await estrARes.json()) as Array<{ id: string }>
    expect(estrA, '[105] no se creó la estructura default de A').toBeTruthy()
    const nivelesARes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estrA.id}&order=orden&select=orden,precio_venta,precio_costo,unidades_base`,
      { headers },
    )
    const nivelesA = (await nivelesARes.json()) as Array<{ orden: number; precio_venta: number | null; precio_costo: number | null; unidades_base: number }>
    expect(nivelesA).toHaveLength(2)
    expect(nivelesA[0].precio_venta, '[105] el nivel base nunca lleva precio propio desde el importador').toBeNull()
    expect(Number(nivelesA[1].precio_venta), '[105] el nivel Caja debería guardar 1080, no 12×100').toBe(1080)
    expect(Number(nivelesA[1].precio_costo)).toBe(650)
    expect(nivelesA[1].unidades_base).toBe(12)

    // B) ancla por nombre "Caja" → nivel_precio_orden=2, SIN precio propio en el nivel (deriva del header)
    const prodBRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?sku=eq.${skuB}&select=id,nivel_precio_orden`, { headers },
    )
    const [prodB] = (await prodBRes.json()) as Array<{ id: string; nivel_precio_orden: number | null }>
    expect(prodB, '[105] no se encontró el producto B por REST').toBeTruthy()
    expect(prodB.nivel_precio_orden, '[105] B ancló el precio en Caja (orden 2) por nombre desde el CSV').toBe(2)

    const estrBRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructuras?producto_id=eq.${prodB.id}&is_default=eq.true&select=id`, { headers },
    )
    const [estrB] = (await estrBRes.json()) as Array<{ id: string }>
    const nivelesBRes = await request.get(
      `${SUPABASE_URL}/rest/v1/producto_estructura_niveles?estructura_id=eq.${estrB.id}&order=orden&select=orden,precio_venta,precio_costo`,
      { headers },
    )
    const nivelesB = (await nivelesBRes.json()) as Array<{ orden: number; precio_venta: number | null; precio_costo: number | null }>
    expect(nivelesB).toHaveLength(2)
    expect(nivelesB[1].precio_venta, '[105] el nivel anclado no necesita precio propio — deriva del header').toBeNull()
  })
})
