/**
 * 96_venta_bloqueada_atributo_ambiguo_mutante.spec.ts
 * E2E MUTANTE — El checkout del POS (`registrarVenta`) bloquea el cobro cuando el producto
 * tiene más de un valor de atributo de variante (color) en stock y el cajero no pasó por el
 * picker "Elegir talle/color/posición de rebaje" — nunca vende una variante distinta de la que
 * el cliente pidió por FIFO ciego (REGLA #0).
 *
 * Cierra el gap de cobertura documentado en `uat-modo-basico.md` §33 ítem #6 (antes solo
 * cubierto por unit tests de `atributoAmbiguoEnStock`, sin checkout real completo).
 *
 * Genera su propia precondición: producto nuevo con "Color" activado + precio de venta +
 * 2 ingresos reales (Rojo-E2E / Azul-E2E). Verifica que: (a) "Venta directa" SIN elegir color
 * rechaza con el toast exacto y NO limpia el carrito (no vendió nada); (b) tras elegir "Rojo-E2E"
 * en el picker, la venta se completa; (c) por REST, `venta_item_despachos` snapshoteó
 * `color: "Rojo-E2E"` y SOLO esa línea de inventario se redujo (la de "Azul-E2E" quedó intacta).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Venta bloqueada por atributo de variante ambiguo (mutante)', () => {
  test('exige elegir el color antes de cobrar y despacha solo la línea elegida', async ({ page, request }) => {
    test.setTimeout(90000) // producto + 2 ingresos completos + checkout (negativo + positivo)
    const nombreProducto = `E2E VentaAmbigua ${Date.now()}`

    // 1) Crear producto con "Color" activado + precio de venta (obligatorio para agregarlo al POS)
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)

    // <Toggle> estándar desde v1.136: button role="switch" con aria-label, no checkbox
    const colorToggle = page.getByRole('switch', { name: 'tiene_color' })
    await expect(colorToggle).toBeAttached({ timeout: 8000 })
    if ((await colorToggle.getAttribute('aria-checked')) !== 'true') await colorToggle.click({ force: true })

    const precioInput = page.locator('xpath=//label[contains(.,"Precio de venta")]/following::input[1]')
    await expect(precioInput).toBeVisible({ timeout: 5000 })
    await precioInput.fill('100')

    await page.getByRole('button', { name: /Crear producto/i }).click()
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // Ingreso manual de `cantidad` unidades con el `color` dado
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

      const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
      if (await ubicSelect.isVisible().catch(() => false)) {
        const vals = await ubicSelect.locator('option').evaluateAll(
          opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
        )
        if (vals.length > 0) await ubicSelect.selectOption(vals[0])
      }

      // La línea NECESITA un Estado real (no "Sin estado"): el filtro de venta en modo avanzado
      // hace `.in('estado_id', estadosDisponiblesParaVenta)` incluso con el grupo "Todos" — un
      // estado_id NULL nunca matchea `IN(...)`, así que la línea queda invisible en el POS.
      const estadoSelect = page.locator('xpath=//label[contains(.,"Estado")]/following::select[1]')
      if (await estadoSelect.isVisible().catch(() => false)) {
        await estadoSelect.selectOption({ label: 'Disponible' }).catch(() => {})
      }

      await page.locator('input[type="number"][placeholder="0"]').first().fill(String(cantidad))

      const colorSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Agregar nuevo valor/i }) }).first()
      await expect(colorSelect).toBeVisible({ timeout: 5000 })
      await colorSelect.selectOption({ label: '+ Agregar nuevo valor…' })
      const nuevoValorInput = page.getByPlaceholder('Ej: Rojo')
      await expect(nuevoValorInput).toBeVisible({ timeout: 3000 })
      await nuevoValorInput.fill(color)
      await nuevoValorInput.blur()
      // Esperar el VALOR real del select (guardarNuevo() es async) — no un timeout fijo.
      await expect(colorSelect).toHaveValue(color, { timeout: 6000 })

      await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
      await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })
    }

    await ingresar(5, 'Rojo-E2E')
    await ingresar(3, 'Azul-E2E')

    // 2) POS: agregar el producto al carrito
    await goto(page, '/ventas')
    await waitForApp(page)
    // El buscador filtra por el grupo de estados activo (default "Disponible ★"); las líneas
    // recién ingresadas quedaron con estado_id NULL ("Sin estado") → no matchean ese filtro.
    // "Todos" saca el filtro de grupo (ver wiki/features/ventas-pos.md).
    const todosBtn = page.getByRole('button', { name: /^Todos$/ }).first()
    if (await todosBtn.isVisible().catch(() => false)) await todosBtn.click()
    const buscadorPos = page.getByPlaceholder(/buscar por nombre/i).first()
    await expect(buscadorPos).toBeVisible({ timeout: 8000 })
    await buscadorPos.fill(nombreProducto)
    await page.waitForTimeout(900)
    const prodBtn = page.locator('div.absolute.top-full button, div.grid > button').filter({ hasText: nombreProducto }).first()
    await expect(prodBtn).toBeVisible({ timeout: 6000 })
    await prodBtn.click()
    await page.waitForTimeout(600)
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible({ timeout: 5000 })

    // Caja, si hay varias abiertas
    const cajaSelect = page.locator('label:has-text("Registrar en caja") + select')
    if (await cajaSelect.isVisible().catch(() => false)) {
      const values = await cajaSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (values.length > 0) await cajaSelect.selectOption(values[0])
    }

    // Efectivo cubriendo de sobra (vuelto permitido)
    const tipoSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /^Efectivo$/ }) }).first()
    await tipoSelect.selectOption('Efectivo')
    const montoInput = page.getByPlaceholder(/^Monto$/i).first()
    await montoInput.fill('10000')
    await montoInput.blur()
    await page.waitForTimeout(300)

    const finalizar = page.locator('button', { hasText: /^Venta directa$/ }).last()
    await expect(finalizar).toBeEnabled({ timeout: 5000 })

    // 3) NEGATIVO — cobrar SIN elegir color debe rechazar con el mensaje exacto y NO vender
    await finalizar.click()
    await expect(page.getByText(new RegExp(`Elegí el color de "${nombreProducto}"`, 'i'))).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/\d+\s+producto/).first()).toBeVisible() // el carrito NO se limpió

    // 4) Abrir el picker (badge ámbar "⚠ Elegí color") y elegir la línea "Rojo-E2E"
    await page.getByText(/⚠ Elegí color/i).first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Rojo-E2E/i }).first().click()
    await page.waitForTimeout(400)

    // 5) POSITIVO — cobrar de nuevo debe completar la venta (el carrito se limpia)
    await finalizar.click()
    await expect(page.getByText(/\d+\s+producto/).first()).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/stock insuficiente|no se pudo registrar/i)).not.toBeVisible()

    // 6) POSITIVO — verificar por REST: venta_item_despachos snapshoteó el color, y SOLO
    //    la línea "Rojo-E2E" se redujo (la de "Azul-E2E" quedó intacta — nunca "cualquiera").
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[96] no se encontró el producto recién creado por REST').toBeTruthy()

    const despachosRes = await request.get(
      `${SUPABASE_URL}/rest/v1/venta_item_despachos?producto_id=eq.${prod.id}&select=color,cantidad`,
      { headers },
    )
    const despachos = (await despachosRes.json()) as Array<{ color: string; cantidad: number }>
    expect(despachos.length, '[96] debería haberse registrado 1 fila de despacho para esta venta').toBe(1)
    expect(despachos[0].color, '[96] el despacho debería snapshotear el color consumido (Rojo-E2E)').toBe('Rojo-E2E')
    expect(despachos[0].cantidad, '[96] la venta fue de 1 unidad').toBe(1)

    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&select=color,cantidad`,
      { headers },
    )
    const lineas = (await lineasRes.json()) as Array<{ color: string; cantidad: number }>
    const roja = lineas.find(l => l.color === 'Rojo-E2E')
    const azul = lineas.find(l => l.color === 'Azul-E2E')
    expect(roja, '[96] debería seguir existiendo la línea Rojo-E2E').toBeTruthy()
    expect(roja!.cantidad, '[96] la línea Rojo-E2E debería haberse reducido de 5 a 4 (venta de 1)').toBe(4)
    expect(azul, '[96] debería seguir existiendo la línea Azul-E2E').toBeTruthy()
    expect(azul!.cantidad, '[96] la línea Azul-E2E NO debería tocarse (no era la variante elegida)').toBe(3)
  })
})
