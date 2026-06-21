/**
 * 42_nc_fiscal_mutante.spec.ts
 * E2E MUTANTE — Nota de Crédito electrónica AFIP (REGLA #0 fiscal).
 *
 * Valida el flujo "Devolver → Emitir NC" en su pieza fiscal: a partir de una venta
 * FACTURADA con CAE que tiene una devolución registrada, emite la NC electrónica
 * (Edge Function `emitir-factura` con `devolucion_id`), que arma el CbtesAsoc
 * referenciando la factura original (AFIP 10197 si falta) y guarda `nc_cae` en
 * `devoluciones`. Aserción POSITIVA (toast "NC-C emitida — CAE:"); el `nc_cae` en
 * DB se verifica aparte con execute_sql.
 *
 * La devolución es PREREQUISITO (su happy-path monetario — medios que cuadran al
 * centavo + caja con saldo — es frágil y ya está cubierto por reachability en el
 * spec 22), así que se siembra como fixture en DEV (igual que la OC #14 del spec 35):
 * una devolución `origen='facturada'` sin `nc_cae` sobre la venta #239 (Factura C #31).
 * Lo que este spec ejercita de verdad es la EMISIÓN FISCAL de la NC, que es lo que
 * faltaba validar por e2e (#6 del backlog).
 *
 * EMITE una NC de homologación por corrida (sin valor fiscal) — intencional (mutante),
 * como spec 21. La llamada a AFIP homologación puede ser lenta → timeout generoso.
 * Se auto-omite si no hay una devolución pendiente de NC (ya emitida / fixture ausente)
 * o si el tenant no tiene facturación habilitada.
 *
 * Corre con el usuario OWNER (proyecto chromium) contra el tenant DEV (Almacén Jorgito).
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

const VENTA_NUMERO = '239' // Factura C #31 con CAE + devolución fixture sin nc_cae

test.describe('Nota de Crédito electrónica (mutante)', () => {
  test('devolución de venta facturada → emite NC-C → CAE de AFIP homologación', async ({ page }) => {
    await goto(page, '/ventas')
    await waitForApp(page)

    // 1) Tab Historial + buscar la venta facturada por número
    await page.getByRole('button', { name: /^Historial$/ }).first().click()
    await page.waitForTimeout(500)
    await page.getByPlaceholder(/Buscar por N° o cliente/i).fill(VENTA_NUMERO)
    await page.waitForTimeout(600)

    // 2) Abrir el detalle de la venta (primera fila filtrada). El query de historial puede
    //    tardar en cargar → esperar a que la fila exista antes de clickear.
    const fila = page.locator('div.divide-y > div').filter({ hasText: /\$/ }).first()
    const hayFila = await fila.isVisible({ timeout: 8000 }).catch(() => false)
    test.skip(!hayFila, `No se encontró la venta #${VENTA_NUMERO} en el historial`)
    await fila.click()
    await page.waitForTimeout(1500) // el detalle dispara la query de devoluciones (async)

    // 3) El detalle muestra el colapsable "Devoluciones (N)" → expandir
    const devolucionesToggle = page.getByRole('button', { name: /Devoluciones \(\d+\)/ }).first()
    const hayDevoluciones = await devolucionesToggle.isVisible({ timeout: 8000 }).catch(() => false)
    test.skip(!hayDevoluciones, 'La venta no tiene devoluciones registradas (falta la fixture)')
    await devolucionesToggle.click()
    await page.waitForTimeout(400)

    // 4) Botón "Emitir NC" (solo aparece si origen=facturada + venta con CAE + sin nc_cae)
    const emitirNcBtn = page.getByRole('button', { name: /^Emitir NC$/ }).first()
    const puedeEmitir = await emitirNcBtn.isVisible({ timeout: 4000 }).catch(() => false)
    expect(puedeEmitir, 'No hay devolución pendiente de NC (ya emitida o facturación no habilitada)').toBeTruthy()
    await emitirNcBtn.click()

    // 5) Modal "Emitir Nota de Crédito" → confirmar emisión (la letra la fija la factura: NC-C)
    await expect(page.getByRole('heading', { name: /Emitir Nota de Crédito/ })).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Emitir NC-C/ }).click()

    // 6) CAE real de AFIP homologación (la llamada externa tarda — timeout generoso)
    await expect(page.getByText(/NC-C emitida.*CAE:/)).toBeVisible({ timeout: 45000 })
    await expect(page.getByText(/Error al emitir NC/i)).not.toBeVisible()
  })
})
