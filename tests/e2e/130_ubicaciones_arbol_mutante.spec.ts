/**
 * 130_ubicaciones_arbol_mutante.spec.ts
 * E2E MUTANTE — Rediseño de Ubicaciones en árbol (Fases U1-U4, migs 334/335, v1.157.0):
 * `ubicaciones` pasa de tabla plana a árbol vía `padre_ubicacion_id`, con `tipo_logico`
 * asignable SOLO en un nodo sin hijos y `codigo` autogenerado jerárquico.
 *
 * Cubre lo que la prueba manual de GO todavía no había ejercitado (ver wiki
 * `project_pendientes.md` — "sin prueba manual en el navegador todavía"):
 *  1. Crear un hijo bajo un padre — código autogenerado con sufijo jerárquico.
 *  2. Guard: no se puede asignar tipo_logico a un padre que YA tiene hijos.
 *  3. Guard: no se puede borrar un padre que tiene niveles adentro.
 *  4. tipo_logico SÍ se puede asignar a una hoja (nodo sin hijos).
 *  5. El breadcrumb padre→hijo aparece en un selector de ubicación operativo (Inventario).
 *
 * Genera su propia precondición: 2 ubicaciones nuevas (raíz + hijo) con nombres únicos.
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant de prueba DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp, uniqueName } from './helpers/navigation'

test.describe('Ubicaciones en árbol — tipo lógico y guards (mutante)', () => {
  test('crea raíz + hijo, código jerárquico, guards de tipo_logico/borrado, breadcrumb operativo', async ({ page }) => {
    test.setTimeout(90000)
    const nombreRaiz = uniqueName('E2ERaiz')
    const nombreHijo = uniqueName('E2EHijo')

    await goto(page, '/configuracion')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Inventario', exact: true }).click()
    await page.getByRole('button', { name: 'Ubicaciones', exact: true }).click()

    const nombreInput = page.getByPlaceholder('Nombre de la ubicación')
    await expect(nombreInput).toBeVisible({ timeout: 8000 })

    // 1) Crear la RAÍZ (sin padre)
    await nombreInput.fill(nombreRaiz)
    await page.getByRole('button', { name: /^Agregar$/ }).click()
    const filaRaiz = page.locator(`xpath=//span[normalize-space(text())="${nombreRaiz}"]/ancestor::div[contains(@class,"rounded-lg")][1]`)
    await expect(filaRaiz).toBeVisible({ timeout: 8000 })
    const codigoRaiz = (await filaRaiz.getByTitle('Código').textContent())?.trim()
    expect(codigoRaiz, '[130] la raíz debería tener un código autogenerado').toBeTruthy()

    // 2) Crear el HIJO bajo la raíz — el select de padre lista por breadcrumb (acá, el nombre solo)
    await nombreInput.fill(nombreHijo)
    const padreSelect = page.locator('select[title*="Árbol de ubicaciones"]').first()
    await padreSelect.selectOption({ label: nombreRaiz })
    await page.getByRole('button', { name: /^Agregar$/ }).click()
    const filaHijo = page.locator(`xpath=//span[normalize-space(text())="${nombreHijo}"]/ancestor::div[contains(@class,"rounded-lg")][1]`)
    await expect(filaHijo).toBeVisible({ timeout: 8000 })

    // POSITIVO: indentado (└) y código jerárquico = código del padre + sufijo
    await expect(filaHijo.getByText('└')).toBeVisible()
    const codigoHijo = (await filaHijo.getByTitle('Código').textContent())?.trim()
    expect(codigoHijo, '[130] el hijo debería tener código autogenerado').toBeTruthy()
    expect(
      codigoHijo!.startsWith(`${codigoRaiz}-`),
      `[130] código del hijo ("${codigoHijo}") debería empezar con el código del padre ("${codigoRaiz}-")`,
    ).toBe(true)

    // Nota: en modo edición, nombre/código pasan a ser <input> — el span de texto que ancla
    // `filaRaiz`/`filaHijo` desaparece. Mientras se edita, solo puede haber UNA fila en ese
    // estado (editUbicId es singular) y es la única con el botón de guardar (✓) — se re-ancla
    // por ahí (el form de "Agregar nueva" no tiene ese ícono, tiene "Agregar").
    const filaEnEdicion = () => page.locator('button:has(svg.lucide-check)').locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')

    // 3) NEGATIVO — asignar tipo_logico a la RAÍZ (que ya tiene un hijo) debe rechazarse
    await filaRaiz.locator('button').nth(-2).click() // Pencil (editar) — últimos 2 botones son Pencil/Trash2
    let editando = filaEnEdicion()
    await editando.getByRole('button', { name: /Tipo lógico y dimensiones/i }).click()
    const tipoLogicoSelect = editando.locator('select').filter({ has: page.locator('option', { hasText: 'Sin clasificar' }) }).first()
    await expect(tipoLogicoSelect).toBeVisible({ timeout: 5000 })
    await tipoLogicoSelect.selectOption({ label: 'Exhibición (góndola — autoservicio)' })
    await editando.locator('button:has(svg.lucide-check)').click()
    await expect(page.getByText(/tiene niveles hijos/i)).toBeVisible({ timeout: 8000 })
    // El guard rechazó — el form de edición sigue abierto (saveUbicacion no cierra en error). Cancelar.
    await editando.locator('button:has(svg.lucide-x)').first().click()

    // 4) POSITIVO — la misma clasificación SÍ se puede asignar al HIJO (es una hoja, sin hijos)
    await filaHijo.locator('button').nth(-2).click() // Pencil
    editando = filaEnEdicion()
    await editando.getByRole('button', { name: /Tipo lógico y dimensiones/i }).click()
    const tipoLogicoSelectHijo = editando.locator('select').filter({ has: page.locator('option', { hasText: 'Sin clasificar' }) }).first()
    await tipoLogicoSelectHijo.selectOption({ label: 'Exhibición (góndola — autoservicio)' })
    await editando.locator('button:has(svg.lucide-check)').click()
    await expect(page.getByText(/^Actualizada$/i)).toBeVisible({ timeout: 8000 })
    await expect(filaHijo.getByText('Exhibición')).toBeVisible({ timeout: 5000 })

    // 5) NEGATIVO — borrar la raíz (que todavía tiene el hijo adentro) debe rechazarse
    await filaRaiz.locator('button').last().click() // Trash2 — último botón de la fila en modo vista
    await expect(page.getByText(/tiene niveles adentro/i)).toBeVisible({ timeout: 8000 })
    await expect(filaRaiz).toBeVisible() // sigue existiendo — no se borró

    // 6) Breadcrumb padre→hijo en un selector operativo (Inventario → Agregar stock → Ingreso)
    await goto(page, '/inventario')
    await waitForApp(page)
    await page.getByRole('button', { name: 'Agregar stock' }).first().click()
    const ingresoBtn = page.getByRole('button', { name: /^Ingreso$/ }).first()
    await expect(ingresoBtn).toBeVisible({ timeout: 8000 })
    await ingresoBtn.click()
    // El select de Ubicación solo aparece tras elegir un producto en el buscador del modal.
    const buscadorModal = page.getByPlaceholder(/Buscar por nombre, SKU/i).first()
    await expect(buscadorModal).toBeVisible({ timeout: 6000 })
    await buscadorModal.fill('a')
    const modal = page.locator('div.fixed.inset-0').filter({ has: buscadorModal }).first()
    await modal.locator('button').filter({ hasText: /./ }).first().click()
    const ubicSelect = page.locator('xpath=//label[contains(.,"Ubicación")]/following::select[1]')
    await expect(ubicSelect).toBeVisible({ timeout: 6000 })
    await expect(ubicSelect.getByText(`${nombreRaiz} › ${nombreHijo}`)).toBeAttached({ timeout: 5000 })
  })
})
