/**
 * 99_presentaciones_arbol_hermanas_mutante.spec.ts
 * E2E MUTANTE — Empaque como ÁRBOL de presentaciones + HERMANAS (rediseño UoM Fase 5, mig 310).
 *
 * Reemplaza al viejo 99_estructura_niveles_dinamicos: `producto_estructuras` /
 * `producto_estructura_niveles` quedaron deprecadas y `producto_presentaciones` pasó a ser la
 * FUENTE DE VERDAD del empaque. Lo nuevo que hay que proteger:
 *
 *   · HERMANAS: dos presentaciones del mismo tipo de empaque con factores distintos
 *     ("Caja-12" y "Caja-10" del mismo producto). Antes lo impedía UNIQUE(producto, empaque).
 *   · El ÁRBOL: cada línea cuelga de una más chica y guarda su equivalencia RESUELTA.
 *   · 🛑 NEGATIVOS server-side (REGLA #0 — la conversión de stock tiene que ser exacta):
 *     un hijo más chico que su padre, un hijo que no es múltiplo entero del padre, dos bases,
 *     y etiquetas repetidas. La UI se cachea; el guard real vive en la RPC.
 *
 * Genera su propia precondición (producto nuevo con timestamp).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL, leerPresentaciones } from './helpers/fixtures'

test.describe('Empaque: árbol de presentaciones + hermanas (mutante)', () => {
  test('hermanas conviven, el árbol resuelve factores y la RPC rechaza conversiones imposibles', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E Arbol ${Date.now()}`

    // 1) Producto nuevo por UI
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,unidad_medida`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; unidad_medida: string }>
    expect(prod, '[99] no se encontró el producto recién creado').toBeTruthy()

    // El trigger trg_productos_presentacion_base (mig 310) siembra la base sola en el alta.
    const soloBase = await leerPresentaciones(request, token, prod.id)
    expect(soloBase, '[99] todo producto nace con su presentación base').toHaveLength(1)
    expect(soloBase[0].es_base).toBe(true)
    expect(Number(soloBase[0].factor_base)).toBe(1)

    const udmCajaRes = await request.get(`${SUPABASE_URL}/rest/v1/unidades_medida?nombre=eq.Caja&select=id`, { headers })
    const [udmCaja] = (await udmCajaRes.json()) as Array<{ id: string }>
    expect(udmCaja, '[99] falta la UdM de empaque predefinida Caja').toBeTruthy()

    const guardar = (lineas: unknown[]) =>
      request.post(`${SUPABASE_URL}/rest/v1/rpc/fn_presentaciones_guardar`, {
        headers, data: { p_producto_id: prod.id, p_lineas: lineas },
      })

    // 2) POSITIVO — árbol con HERMANAS: base → Caja-12 → Pallet-216, y base → Caja-10.
    //    Las dos cajas comparten el MISMO nombre de empaque: eso es lo que antes estaba prohibido.
    const okRes = await guardar([
      { padre_idx: null, nombre_empaque_id: null, etiqueta: prod.unidad_medida ?? 'unidad', factor_base: 1 },
      { padre_idx: 0, nombre_empaque_id: udmCaja.id, etiqueta: 'Caja-12', factor_base: 12 },
      { padre_idx: 1, nombre_empaque_id: udmCaja.id, etiqueta: 'Pallet-216', factor_base: 216 },
      { padre_idx: 0, nombre_empaque_id: udmCaja.id, etiqueta: 'Caja-10', factor_base: 10 },
    ])
    expect(okRes.ok(), `[99] no se pudo guardar el árbol con hermanas: ${await okRes.text()}`).toBe(true)

    const pres = await leerPresentaciones(request, token, prod.id)
    expect(pres, '[99] deberían quedar 4 presentaciones').toHaveLength(4)
    const porEtiqueta = Object.fromEntries(pres.map(p => [p.etiqueta, p]))

    // Factores RESUELTOS en unidades base (lo que usa el rebaje de stock)
    expect(Number(porEtiqueta['Caja-12'].factor_base)).toBe(12)
    expect(Number(porEtiqueta['Caja-10'].factor_base)).toBe(10)
    expect(Number(porEtiqueta['Pallet-216'].factor_base)).toBe(216)

    // Genealogía: las dos cajas cuelgan de la base; el pallet, de la Caja-12
    const baseId = pres.find(p => p.es_base)!.id
    expect(porEtiqueta['Caja-12'].padre_linea_id, '[99] Caja-12 cuelga de la base').toBe(baseId)
    expect(porEtiqueta['Caja-10'].padre_linea_id, '[99] la hermana también cuelga de la base').toBe(baseId)
    expect(porEtiqueta['Pallet-216'].padre_linea_id, '[99] el pallet cuelga de la Caja-12').toBe(porEtiqueta['Caja-12'].id)
    expect(pres.filter(p => p.es_base), '[99] hay una sola base').toHaveLength(1)

    // 3) 🛑 NEGATIVOS server-side — cada uno tiene que ser RECHAZADO y dejar el árbol INTACTO
    const base = { padre_idx: null, nombre_empaque_id: null, etiqueta: 'unidad', factor_base: 1 }

    const hijoMasChico = await guardar([base, { padre_idx: 0, nombre_empaque_id: udmCaja.id, etiqueta: 'CajaMala', factor_base: 1 }])
    expect(hijoMasChico.ok(), '[99] un hijo que no es MÁS GRANDE que su padre debe rechazarse').toBe(false)

    const noMultiplo = await guardar([
      base,
      { padre_idx: 0, nombre_empaque_id: udmCaja.id, etiqueta: 'Caja-12', factor_base: 12 },
      { padre_idx: 1, nombre_empaque_id: udmCaja.id, etiqueta: 'PalletRaro', factor_base: 30 }, // 30 no es múltiplo de 12
    ])
    expect(noMultiplo.ok(), '[99] un empaque que no contiene un número ENTERO de su hijo debe rechazarse').toBe(false)

    const dosBases = await guardar([base, { padre_idx: null, nombre_empaque_id: null, etiqueta: 'otraBase', factor_base: 1 }])
    expect(dosBases.ok(), '[99] dos presentaciones base deben rechazarse').toBe(false)

    const etiquetaDup = await guardar([
      base,
      { padre_idx: 0, nombre_empaque_id: udmCaja.id, etiqueta: 'unidad', factor_base: 6 },
    ])
    expect(etiquetaDup.ok(), '[99] dos presentaciones con el mismo nombre deben rechazarse').toBe(false)

    const baseConFactorRaro = await guardar([
      { padre_idx: null, nombre_empaque_id: null, etiqueta: 'unidad', factor_base: 5 },
    ])
    expect(baseConFactorRaro.ok(), '[99] la base tiene que equivaler a 1 unidad').toBe(false)

    // 4) 🛑 Tras los 5 rechazos el árbol bueno sigue EXACTAMENTE igual (nada quedó a medias)
    const presFinal = await leerPresentaciones(request, token, prod.id)
    expect(presFinal, '[99] ningún rechazo debe haber tocado el árbol guardado').toHaveLength(4)
    expect(presFinal.map(p => Number(p.factor_base))).toEqual([1, 10, 12, 216])
  })
})
