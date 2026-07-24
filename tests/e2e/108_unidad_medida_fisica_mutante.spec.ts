/**
 * 108_unidad_medida_fisica_mutante.spec.ts
 * E2E MUTANTE — Fase 1 del rediseño UoM/Empaque/Variantes (mig 303): el selector "Unidad de
 * medida" de ProductoFormPage usa el catálogo de unidades FÍSICAS (familias con conversión
 * universal) y persiste `productos.unidad_medida_base_id` (FK), manteniendo el texto legacy
 * `unidad_medida` en sincronía.
 *
 * Aserción POSITIVA + verificación en DB: se crea un producto, se edita eligiendo "Kilogramo"
 * (familia Peso), se guarda, y se verifica que la FK apunta a Kilogramo y el texto legacy quedó
 * "Kilogramo". Genera su propia precondición (nombre único). Corre con OWNER (chromium) contra DEV.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'
import { tokenDesdeBrowser, restHeaders, SUPABASE_URL } from './helpers/fixtures'

test.describe('Unidad de Medida física persiste al guardar (mutante)', () => {
  test('elegir "Kilogramo" (familia Peso) en la ficha y guardar persiste unidad_medida_base_id', async ({ page, request }) => {
    const nombreProducto = `E2E UdMFisica ${Date.now()}`

    await goto(page, '/dashboard')
    await waitForApp(page)
    const token = await tokenDesdeBrowser(page)
    const headers = restHeaders(token)

    // Precondición: el tenant tiene el catálogo de UdM físicas sembrado (mig 303).
    const sucRes = await request.get(`${SUPABASE_URL}/rest/v1/sucursales?select=tenant_id&limit=1`, { headers })
    const [suc] = (await sucRes.json()) as Array<{ tenant_id: string }>
    const tenantId = suc.tenant_id
    const umfRes = await request.get(
      `${SUPABASE_URL}/rest/v1/unidades_medida_fisicas?tenant_id=eq.${tenantId}&select=id,nombre,familia`, { headers },
    )
    const umf = (await umfRes.json()) as Array<{ id: string; nombre: string; familia: string }>
    const kilo = umf.find(u => u.nombre === 'Kilogramo')
    expect(kilo, '[108] falta el seed de unidades_medida_fisicas (mig 303) — Kilogramo no está').toBeTruthy()
    expect(umf.some(u => u.familia === 'peso'), '[108] la familia peso debe estar sembrada').toBe(true)

    // 1) Crear un producto nuevo
    await goto(page, '/productos/nuevo')
    await waitForApp(page)
    const nombreInput = page.getByPlaceholder(/Tornillo hexagonal/i)
    await expect(nombreInput).toBeVisible({ timeout: 8000 })
    await nombreInput.fill(nombreProducto)
    const crear = page.getByRole('button', { name: /^Crear producto$/ })
    await expect(crear).toBeVisible({ timeout: 5000 })
    await crear.click()
    await expect(page.getByText(/Producto creado/i)).toBeVisible({ timeout: 10000 })
    await expect(page).toHaveURL(/\/productos$/, { timeout: 8000 })

    // 2) Buscar el id real por REST
    const buscar = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?nombre=eq.${encodeURIComponent(nombreProducto)}&select=id,unidad_medida,unidad_medida_base_id`, { headers },
    )
    const [creado] = (await buscar.json()) as Array<{ id: string; unidad_medida: string; unidad_medida_base_id: string | null }>
    expect(creado, `[108] el producto "${nombreProducto}" no aparece por REST tras crearlo`).toBeTruthy()

    // 3) Editar → elegir "Kilogramo" en el selector de Unidad de medida (familia Peso)
    await goto(page, `/productos/${creado.id}/editar`)
    await waitForApp(page)
    await expect(page.getByRole('heading', { name: /Editar producto/i })).toBeVisible({ timeout: 8000 })

    const udmSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Kilogramo' }) }).first()
    await expect(udmSelect).toBeVisible({ timeout: 8000 })
    await udmSelect.selectOption(kilo!.id)

    const guardar = page.getByRole('button', { name: /^Guardar cambios$/ })
    await expect(guardar).toBeVisible({ timeout: 5000 })
    await guardar.click()
    await expect(page.getByText(/Producto actualizado/i)).toBeVisible({ timeout: 10000 })

    // 4) POSITIVO — la FK apunta a Kilogramo y el texto legacy quedó en sincronía
    const verif = await request.get(
      `${SUPABASE_URL}/rest/v1/productos?id=eq.${creado.id}&select=unidad_medida,unidad_medida_base_id`, { headers },
    )
    const [tras] = (await verif.json()) as Array<{ unidad_medida: string; unidad_medida_base_id: string | null }>
    expect(tras.unidad_medida_base_id, '[108] "Guardar cambios" no persistió la FK de unidad física').toBe(kilo!.id)
    expect(tras.unidad_medida, '[108] el texto legacy unidad_medida debe quedar en sincronía con la unidad elegida').toBe('Kilogramo')

    // 5) Recargar y confirmar que el select vuelve a mostrar Kilogramo
    await goto(page, `/productos/${creado.id}/editar`)
    await waitForApp(page)
    await expect(udmSelect).toHaveValue(kilo!.id, { timeout: 8000 })

    // Limpieza
    await request.delete(`${SUPABASE_URL}/rest/v1/productos?id=eq.${creado.id}`, { headers })
  })
})
