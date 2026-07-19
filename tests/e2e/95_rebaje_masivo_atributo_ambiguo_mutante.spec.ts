/**
 * 95_rebaje_masivo_atributo_ambiguo_mutante.spec.ts
 * E2E MUTANTE — Rebaje masivo (`MasivoModal` tipo='rebaje') exige elegir el atributo de
 * variante (color) cuando hay más de un valor distinto en stock, y una vez elegido consume
 * SOLO la línea de esa variante — nunca "cualquiera" por FIFO ciego (REGLA #0).
 *
 * Cierra el gap de cobertura documentado en `uat-modo-basico.md` §33 ítem #5 (antes solo
 * cubierto por unit tests de `atributoAmbiguoEnLineas`/`filtrarLineasPorAtributo`, sin
 * click-through real).
 *
 * Genera su propia precondición: producto nuevo con "Color" activado + 2 ingresos reales
 * (Rojo-E2E / Azul-E2E) que crean la ambigüedad real en stock. Verifica por REST que el
 * rebaje tocó solo la línea del color elegido.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Rebaje masivo con atributo de variante ambiguo (mutante)', () => {
  test('exige elegir el color antes de rebajar y consume solo la línea elegida', async ({ page, request }) => {
    test.setTimeout(90000) // producto + 2 ingresos completos + rebaje masivo (negativo + positivo)
    const nombreProducto = `E2E RebajeAmbiguo ${Date.now()}`

    // 1) Crear producto con "Color" activado
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)

    const colorToggle = page.locator('label').filter({ hasText: 'Color' }).locator('input[type="checkbox"]')
    await expect(colorToggle).toBeAttached({ timeout: 8000 })
    if (!(await colorToggle.isChecked())) await colorToggle.click({ force: true })

    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // Ingreso manual de `cantidad` unidades con el `color` dado (crea/reusa el valor del catálogo)
    const ingresar = async (cantidad: number, color: string) => {
      await goto(page, '/inventario')
      await waitForApp(page)
      await page.getByRole('button', { name: 'Agregar stock' }).first().click()
      await page.waitForTimeout(400)
      const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
      await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
      test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
      await ingresoBtn.click()
      await page.waitForTimeout(400)

      const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
      await expect(buscador).toBeVisible({ timeout: 6000 })
      await buscador.fill(nombreProducto)
      await page.waitForTimeout(900)
      const modal = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
      await modal.getByText(nombreProducto).first().click()
      await page.waitForTimeout(500)

      const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
      if (await sucSelect.isVisible().catch(() => false)) {
        const vals = await sucSelect.locator('option').evaluateAll(
          opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
        )
        if (vals.length > 0) await sucSelect.selectOption(vals[0])
      }

      // La línea NECESITA una ubicación real (no "Sin ubicación"): la preview de rebaje masivo
      // (`cargarLineasParaRebaje`) excluye líneas con ubicacion_id NULL en modo avanzado — sin
      // esto las 2 líneas quedan invisibles para `atributoAmbiguoEnLineas` y la ambigüedad nunca
      // se detecta (encontrado corriendo este spec: el rebaje pasaba sin pedir el color).
      const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
      if (await ubicSelect.isVisible().catch(() => false)) {
        const vals = await ubicSelect.locator('option').evaluateAll(
          opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
        )
        if (vals.length > 0) await ubicSelect.selectOption(vals[0])
      }

      await page.locator('input[type="number"][placeholder="0"]').first().fill(String(cantidad))

      const colorSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Agregar nuevo valor/i }) }).first()
      await expect(colorSelect).toBeVisible({ timeout: 5000 })
      await colorSelect.selectOption({ label: '+ Agregar nuevo valor…' })
      // El placeholder del input "nuevo valor" es específico por atributo ("Ej: Rojo" para color,
      // no un genérico "Nuevo valor" — ver AtributoValorSelect.tsx / InventarioPage.tsx).
      const nuevoValorInput = page.getByPlaceholder('Ej: Rojo')
      await expect(nuevoValorInput).toBeVisible({ timeout: 3000 })
      await nuevoValorInput.fill(color)
      await nuevoValorInput.blur()
      // `guardarNuevo()` es async (insert + invalidateQueries) — esperar el VALOR real del
      // select en vez de un timeout fijo. Con timeout fijo el click a "Confirmar ingreso" a
      // veces salía ANTES de que el estado terminara de actualizar (flake real, encontrado
      // corriendo este spec 4-5 veces: 1 de cada 3 corridas confirmaba sin el color todavía
      // aplicado y el toast de error desaparecía antes de que se revisara).
      await expect(colorSelect).toHaveValue(color, { timeout: 6000 })

      await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
      await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })
    }

    await ingresar(5, 'Rojo-E2E')
    await ingresar(3, 'Azul-E2E')

    // 2) Rebaje masivo: agregar el producto
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: /Quitar stock/i }).first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^Masivo$/ }).click()
    await page.waitForTimeout(400)

    const buscadorMasivo = page.getByPlaceholder('Buscar y agregar producto...')
    await expect(buscadorMasivo).toBeVisible({ timeout: 6000 })
    await buscadorMasivo.fill(nombreProducto)
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: new RegExp(nombreProducto) }).first().click()
    await page.waitForTimeout(500)

    const cantidadInput = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidadInput).toBeVisible({ timeout: 5000 })
    await cantidadInput.fill('2')

    // 3) NEGATIVO — confirmar SIN elegir color debe rechazar con el mensaje exacto
    const confirmar = page.getByRole('button', { name: /Confirmar \d+ rebaje/ })
    await expect(confirmar).toBeVisible({ timeout: 5000 })
    await confirmar.click()
    await expect(page.getByText(/elegí el color a rebajar/i)).toBeVisible({ timeout: 8000 })

    // 4) POSITIVO — elegir "Rojo-E2E" y confirmar de nuevo
    const colorSelectRebaje = page.locator('select').filter({ has: page.locator('option', { hasText: 'Rojo-E2E' }) }).first()
    await expect(colorSelectRebaje).toBeVisible({ timeout: 5000 })
    await colorSelectRebaje.selectOption({ label: 'Rojo-E2E' })
    await page.waitForTimeout(400)
    await confirmar.click()
    await expect(page.getByText(/Rebaje masivo registrado/i)).toBeVisible({ timeout: 12000 })

    // 5) POSITIVO — verificar por REST que SOLO se consumió la línea de "Rojo-E2E"
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[95] no se encontró el producto recién creado por REST').toBeTruthy()

    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&select=color,cantidad`,
      { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ color: string; cantidad: number }>
    const roja = lineas.find(l => l.color === 'Rojo-E2E')
    const azul = lineas.find(l => l.color === 'Azul-E2E')
    expect(roja, '[95] debería seguir existiendo la línea Rojo-E2E').toBeTruthy()
    expect(roja!.cantidad, '[95] la línea Rojo-E2E debería haberse reducido de 5 a 3 (rebaje de 2)').toBe(3)
    expect(azul, '[95] debería seguir existiendo la línea Azul-E2E').toBeTruthy()
    expect(azul!.cantidad, '[95] la línea Azul-E2E NO debería tocarse (no era la variante elegida)').toBe(3)
  })
})
