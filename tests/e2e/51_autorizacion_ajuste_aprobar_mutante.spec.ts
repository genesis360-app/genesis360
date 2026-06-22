/**
 * 51_autorizacion_ajuste_aprobar_mutante.spec.ts
 * E2E MUTANTE — Aprobación de ajuste de inventario por 2 actores (REGLA #0, stock).
 *
 * Complementa la spec 47 (un rol ≠ DUEÑO SOLICITA → `autorizaciones_inventario` pendiente, sin mutar).
 * Acá se valida el OTRO actor: el DUEÑO APRUEBA la solicitud → recién entonces se MUTA el stock
 * (`aprobarAutorizacion`, tipo `ajuste_conteo`, mig 228): reconcilia por delta, actualiza
 * `inventario_lineas.cantidad` e inserta `movimientos_stock` (ajuste_ingreso/rebaje).
 *
 * Fixture SQL (DEV, tenant Almacén Jorgito): una autorización PENDIENTE `ajuste_conteo` sobre el
 * LPN "LPN-MNB85SGE" de "Coca Cola 1.5L Original" (esperado 126 → contado 127, +1), solicitada por
 * "Supervisor Test" (2º actor). El DUEÑO (OWNER/chromium) la aprueba.
 *
 * También valida el fix de UI 2026-06-22: antes la lista de Autorizaciones rotulaba `ajuste_conteo`
 * (y `bulk_edit`) como "Eliminar LPN" (el `tipoLabel` no los cubría) → engañoso. Ahora muestra
 * "Diferencia de conteo" + el detalle esperado→contado.
 *
 * Aserción POSITIVA (label correcto + toast "Autorización aprobada y ejecutada"); el efecto en
 * `inventario_lineas.cantidad` (126→127), el `movimientos_stock` ajuste_ingreso y `estado='aprobada'`
 * se verifican aparte con execute_sql. El botón Aprobar dispara un `confirm()` nativo → se acepta.
 *
 * Re-ejecutable: re-sembrar el fixture (autorización pendiente) antes de cada corrida; skip-guard si ausente.
 */
import { test, expect } from '@playwright/test'
import { goto, waitForApp } from './helpers/navigation'

test.describe('Aprobación de ajuste de inventario — 2 actores (mutante)', () => {
  test('DUEÑO aprueba una diferencia de conteo pendiente → muta el stock', async ({ page }) => {
    // Aceptar el confirm() nativo del botón Aprobar
    page.on('dialog', (dialog) => dialog.accept().catch(() => {}))

    await goto(page, '/inventario')
    await waitForApp(page)

    // Tab Autorizaciones (solo avanzado + DUEÑO/SUPERVISOR/ADMIN; esperar render — cold-load lento)
    const tabAut = page.getByRole('button', { name: 'Autorizaciones' })
    await expect(tabAut).toBeVisible({ timeout: 20000 })
    await tabAut.click()
    await page.waitForTimeout(800)

    // La fila del fixture (Coca Cola) debe estar pendiente. Si no, el fixture no fue sembrado.
    const fila = page.locator('div.rounded-xl.shadow-sm').filter({ hasText: 'Coca Cola 1.5L Original' }).first()
    if (!(await fila.isVisible().catch(() => false))) {
      test.skip(true, 'Fixture de autorización pendiente no sembrado (re-correr el SQL de fixture).')
    }
    await expect(fila).toBeVisible({ timeout: 10000 })

    // FIX UI 2026-06-22: rótulo correcto + detalle esperado→contado (antes decía "Eliminar LPN")
    await expect(fila.getByText('Diferencia de conteo')).toBeVisible()
    await expect(fila.getByText(/esperado.*126/i)).toBeVisible()
    await expect(fila.getByText(/contado.*127/i)).toBeVisible()

    // Aprobar (2º actor = DUEÑO)
    await fila.getByRole('button', { name: /Aprobar/i }).click()

    // POSITIVO: toast de éxito
    await expect(page.getByText(/Autorización aprobada y ejecutada/i)).toBeVisible({ timeout: 12000 })
  })
})
