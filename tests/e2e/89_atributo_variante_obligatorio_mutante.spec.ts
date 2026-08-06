/**
 * 89_atributo_variante_obligatorio_mutante.spec.ts
 * E2E MUTANTE — Atributos de variante (talle/color/etc.) son OBLIGATORIOS al ingresar
 * stock cuando el producto los tiene activados (REGLA #0).
 *
 * Reproduce el bug real reportado por GO (2026-07-18, tenant Almacén Jorgito): un producto
 * con "Talle" activado dejaba ingresar stock SIN pedir el talle, quedando la línea con
 * `talle: null`. Genera su propia precondición (crea un producto nuevo con nombre único, no
 * depende de fixtures compartidos): activa "Talle", intenta un ingreso SIN talle (debe
 * rechazarlo con el toast exacto), y luego CON talle (debe aceptarlo).
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { visible } from './helpers/fixtures'

test.describe('Atributo de variante obligatorio al ingresar stock (mutante)', () => {
  test('producto con Talle activado exige el talle al confirmar el ingreso', async ({ page }) => {
    const nombreProducto = `E2E Talle ${Date.now()}`

    // 1) Crear un producto nuevo con "Talle" activado
    await goto(page, '/productos/nuevo')
    await waitForApp(page)

    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)

    // Activar el toggle "Talle / Talla" — desde v1.136 es el <Toggle> estándar
    // (button role="switch" con aria-label), ya no un input checkbox
    const talleToggle = page.getByRole('switch', { name: 'tiene_talle' })
    await expect(talleToggle).toBeAttached({ timeout: 8000 })
    const yaActivo = (await talleToggle.getAttribute('aria-checked')) === 'true'
    if (!yaActivo) await talleToggle.click({ force: true })

    const guardar = page.getByRole('button', { name: /Crear producto/i })
    await expect(guardar).toBeVisible({ timeout: 5000 })
    await guardar.click()

    // Confirma la creación por la navegación de vuelta a /productos (o toast de éxito)
    await expect(page).toHaveURL(/\/productos$/, { timeout: 15000 }).catch(async () => {
      await expect(page.getByText(/Producto creado|creado correctamente/i)).toBeVisible({ timeout: 10000 })
    })

    // 2) Ir a Inventario → Agregar stock → Ingreso y buscar el producto recién creado
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()

    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    test.skip(!(await ingresoBtn.isEnabled()), 'Ingreso deshabilitado (límite de plan alcanzado)')
    await ingresoBtn.click()

    const buscador = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscador).toBeVisible({ timeout: 6000 })
    await buscador.fill(nombreProducto)

    const modal = page.locator('div.fixed.inset-0').filter({ has: buscador }).first()
    const resultado = modal.getByText(nombreProducto).first()
    await expect(resultado).toBeVisible({ timeout: 6000 })
    await resultado.click()

    // Sucursal destino, si aparece
    const sucSelect = page.locator('xpath=//label[contains(.,"Sucursal destino")]/following::select[1]')
    if (await visible(sucSelect, 2000)) {
      const vals = await sucSelect.locator('option').evaluateAll(
        opts => (opts as HTMLOptionElement[]).map(o => o.value).filter(v => v)
      )
      if (vals.length > 0) await sucSelect.selectOption(vals[0])
    }

    const cantidad = page.locator('input[type="number"][placeholder="0"]').first()
    await expect(cantidad).toBeVisible({ timeout: 5000 })
    await cantidad.fill('1')

    // 3) NEGATIVO — confirmar SIN talle debe rechazar con el mensaje exacto
    const confirmar = page.getByRole('button', { name: /Confirmar ingreso/ }).first()
    await expect(confirmar).toBeEnabled({ timeout: 5000 })
    await confirmar.click()
    await expect(page.getByText(/requiere talle/i)).toBeVisible({ timeout: 8000 })

    // 4) POSITIVO — completar el talle y confirmar de nuevo debe aceptar
    const talleSelect = page.locator('select').filter({ has: page.locator('option', { hasText: /Agregar nuevo valor/i }) }).first()
    await expect(talleSelect).toBeVisible({ timeout: 5000 })
    await talleSelect.selectOption({ index: 1 }).catch(async () => {
      // Catálogo vacío para este tenant → usar "+ Agregar nuevo valor…" inline
      await talleSelect.selectOption({ label: '+ Agregar nuevo valor…' })
      const nuevoValorInput = page.locator('input[placeholder="Nuevo valor"]').first()
      await expect(nuevoValorInput).toBeVisible({ timeout: 3000 })
      await nuevoValorInput.fill('M-E2E')
      await nuevoValorInput.blur()
      // guardarNuevo() es async — esperar el VALOR real del select, no un timeout fijo (mismo
      // patrón que el spec 95: sin esto, "Confirmar" podía salir antes de que el estado terminara).
      await expect(talleSelect).toHaveValue('M-E2E', { timeout: 6000 })
    })

    await confirmar.click()
    await expect(page.getByText(/Ingreso registrado/i)).toBeVisible({ timeout: 12000 })
  })
})
