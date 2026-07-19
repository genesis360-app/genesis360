/**
 * 97_lpn_editar_atributo_obligatorio_mutante.spec.ts
 * E2E MUTANTE — `LpnAccionesModal` → tab "Editar" exige el atributo de variante (color) si el
 * producto lo tiene activado, igual que ya exige lote/vencimiento — nunca deja guardar una línea
 * con el atributo vacío (REGLA #0).
 *
 * Cierra el gap de cobertura documentado en `uat-modo-basico.md` §33 ítem #7 (antes solo código +
 * revisión, sin click-through real).
 *
 * Genera su propia precondición: producto nuevo con "Color" activado + 1 ingreso real con color
 * "Verde-E2E". Abre "Acciones sobre este LPN" → Editar (tab default), vacía el select de color,
 * confirma que "Guardar cambios" rechaza con el mensaje exacto, y que al re-elegir el valor y
 * guardar de nuevo persiste en la base (verificado por REST).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('LpnAccionesModal → Editar exige atributo de variante obligatorio (mutante)', () => {
  test('vaciar el color y guardar rechaza; re-elegirlo y guardar persiste', async ({ page, request }) => {
    const nombreProducto = `E2E LpnEditar ${Date.now()}`

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

    // 2) Ingreso manual de 1 unidad con color "Verde-E2E"
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
    const modalIngreso = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
    await modalIngreso.getByText(nombreProducto).first().click()
    await page.waitForTimeout(500)

    const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await sucSelect.isVisible().catch(() => false)) {
      const vals = await sucSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (vals.length > 0) await sucSelect.selectOption(vals[0])
    }

    await page.locator('input[type="number"][placeholder="0"]').first().fill('1')

    const colorSelectIngreso = page.locator('select').filter({ has: page.locator('option', { hasText: /Agregar nuevo valor/i }) }).first()
    await expect(colorSelectIngreso).toBeVisible({ timeout: 5000 })
    await colorSelectIngreso.selectOption({ label: '+ Agregar nuevo valor…' })
    const nuevoValorInput = page.getByPlaceholder('Ej: Rojo')
    await expect(nuevoValorInput).toBeVisible({ timeout: 3000 })
    await nuevoValorInput.fill('Verde-E2E')
    await nuevoValorInput.blur()
    await expect(colorSelectIngreso).toHaveValue('Verde-E2E', { timeout: 6000 })

    await page.getByRole('button', { name: /Confirmar ingreso/ }).first().click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })

    // 3) Abrir el producto en el listado de Inventario y sus acciones de LPN
    await goto(page, '/inventario')
    await waitForApp(page)
    const buscadorInv = page.getByPlaceholder(/Buscar por nombre, SKU, código, ubicación o LPN/i).first()
    await expect(buscadorInv).toBeVisible({ timeout: 8000 })
    await buscadorInv.fill(nombreProducto)
    await page.waitForTimeout(700)
    await page.getByText(nombreProducto, { exact: true }).first().click()
    await page.waitForTimeout(400)

    const accionesBtn = page.getByTitle('Acciones sobre este LPN').first()
    await expect(accionesBtn).toBeVisible({ timeout: 8000 })
    await accionesBtn.click()

    // 4) Tab "Editar" (default) — el color viene pre-cargado con "Verde-E2E"
    const colorSelectEditar = page.locator('xpath=//label[contains(.,"Color")]/following::select[1]')
    await expect(colorSelectEditar).toBeVisible({ timeout: 5000 })
    await expect(colorSelectEditar).toHaveValue('Verde-E2E', { timeout: 5000 })

    // 5) NEGATIVO — vaciar el color y guardar debe rechazar con el mensaje exacto
    await colorSelectEditar.selectOption('')
    const guardarBtn = page.getByRole('button', { name: /Guardar cambios/i })
    await expect(guardarBtn).toBeVisible({ timeout: 5000 })
    await guardarBtn.click()
    await expect(page.getByText(/Este producto requiere color/i)).toBeVisible({ timeout: 8000 })

    // 6) POSITIVO — re-elegir "Verde-E2E" y guardar debe aceptar
    await colorSelectEditar.selectOption({ label: 'Verde-E2E' })
    await guardarBtn.click()
    await expect(page.getByText(/LPN actualizado/i)).toBeVisible({ timeout: 10000 })

    // 7) POSITIVO — verificar por REST que el color quedó persistido (no se guardó vacío)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)
    const prodRes = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id`,
      { headers },
    )
    const [prod] = (await prodRes.json()) as Array<{ id: string }>
    expect(prod, '[97] no se encontró el producto recién creado por REST').toBeTruthy()

    const lineasRes = await request.get(
      `${SUPABASE_URL}/rest/v1/inventario_lineas?producto_id=eq.${prod.id}&select=color`,
      { headers },
    )
    const [linea] = (await lineasRes.json()) as Array<{ color: string | null }>
    expect(linea, '[97] no se encontró la línea de inventario por REST').toBeTruthy()
    expect(linea.color, '[97] el color debería haber quedado persistido como "Verde-E2E" (no vacío)').toBe('Verde-E2E')
  })
})
