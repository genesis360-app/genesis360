/**
 * 129_pildoras_filtro_productos_inventario_mutante.spec.ts
 * E2E MUTANTE — El buscador de píldoras (mismo mecanismo que /picking, ver `productosFiltro.ts` /
 * `inventarioFiltro.ts` / `pildorasFiltro.ts`) reemplaza el buscador de texto plano en /productos
 * y en /inventario (tab Inventario): cada criterio queda explícito a qué campo apunta
 * ("(SKU):43") y varias píldoras se combinan con un solo combinador Y/O global.
 *
 * Genera su propia precondición: un producto nuevo con nombre único. Verifica, para cada
 * página, que un texto libre matchea, que un campo explícito matchea SOLO ese campo, y que
 * combinar dos píldoras con Y exige ambas (0 resultados si una no matchea) mientras que O
 * alcanza con una.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Buscador de píldoras — Productos e Inventario (mutante)', () => {
  test('filtra por texto libre, por campo explícito, y combina Y/O — en /productos y /inventario', async ({ page, request }) => {
    test.setTimeout(90000)
    const nombreProducto = `E2E Pildoras ${Date.now()}`

    // 1) Crear el producto (precondición propia — no depende de datos de otro spec)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // SKU auto-asignado por la DB — lo necesitamos para la píldora (SKU):
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,sku`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string; sku: string }>
    expect(prod, '[129] no se encontró el producto recién creado por REST').toBeTruthy()

    // ── /productos ──────────────────────────────────────────────────────────
    await goto(page, '/productos')
    await waitForApp(page)
    const buscadorProd = page.getByTestId('buscador-entrada').first()
    await expect(buscadorProd).toBeVisible({ timeout: 8000 })

    // Texto libre: matchea por nombre
    await buscadorProd.fill(nombreProducto)
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 8000 })

    // Campo explícito (SKU) — reemplaza el texto libre por una píldora fija con Enter
    await buscadorProd.fill('')
    await buscadorProd.fill(`(SKU):${prod.sku}`)
    await buscadorProd.press('Enter')
    await expect(page.getByTestId('pildora').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('pildora-campo').first()).toHaveValue('sku')
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 8000 })

    // Segunda píldora con Y: nombre que NO matchea → 0 resultados (Y exige ambas)
    await buscadorProd.fill('(Nombre):zzz-no-existe-zzz')
    await buscadorProd.press('Enter')
    await expect(page.getByTestId('pildora')).toHaveCount(2, { timeout: 5000 })
    await expect(page.getByText(nombreProducto)).not.toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/No se encontraron productos/i)).toBeVisible({ timeout: 5000 })

    // Cambiar a O: con que UNA matchee (el SKU) alcanza
    await page.getByTestId('combinador-o').click()
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 8000 })

    // Limpiar píldoras (X de cada una)
    await page.getByTestId('pildora-quitar').first().click()
    await page.getByTestId('pildora-quitar').first().click()
    await expect(page.getByTestId('pildora')).toHaveCount(0, { timeout: 5000 })

    // ── /inventario (tab Inventario) — producto SIN stock: solo puede matchear por
    //    producto/sku/código (`productoMatcheaPildoras` con 0 líneas) ──────────
    await goto(page, '/inventario')
    await waitForApp(page)
    const invTab = page.getByRole('button', { name: /^Inventario$/ }).first()
    if (await invTab.isVisible().catch(() => false)) await invTab.click()
    const buscadorInv = page.getByTestId('buscador-entrada').first()
    await expect(buscadorInv).toBeVisible({ timeout: 8000 })
    await buscadorInv.fill(nombreProducto)
    await expect(page.getByText(nombreProducto).first()).toBeVisible({ timeout: 8000 })

    // Campo explícito LPN que no existe para este producto (sin stock) → no matchea
    await buscadorInv.fill('')
    await buscadorInv.fill(`(Producto):${nombreProducto}`)
    await buscadorInv.press('Enter')
    await buscadorInv.fill('(LPN):zzz-no-existe-zzz')
    await buscadorInv.press('Enter')
    await expect(page.getByTestId('pildora')).toHaveCount(2, { timeout: 5000 })
    await expect(page.getByText(nombreProducto)).not.toBeVisible({ timeout: 5000 })
  })
})
